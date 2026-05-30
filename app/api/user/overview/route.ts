import { NextRequest, NextResponse } from "next/server";
import { assertEnv, config } from "@/lib/config";
import { getUserOverview, type UserOverviewResult, type UserOverviewView } from "@/lib/queries/user-safe";
import { userDataUnavailableResponse, userUnauthorizedResponse, USER_API_CACHE_CONTROL_HEADER } from "@/lib/user-api";
import { getUserSessionFromRequest } from "@/lib/user-session";

export const runtime = "nodejs";

type CachedOverview = {
  expiresAt: number;
  value: UserOverviewResult;
};

const OVERVIEW_CACHE_TTL_MS = 30_000;
const OVERVIEW_CACHE_MAX_ENTRIES = 100;
const CACHE_CONTROL_HEADER = USER_API_CACHE_CONTROL_HEADER;
const overviewCache = new Map<string, CachedOverview>();
const overviewInFlight = new Map<string, Promise<CachedOverview["value"]>>();

function makeCacheKey(input: {
  sessionRoute: string;
  view: UserOverviewView;
  days?: number;
  model?: string | null;
  page?: number;
  pageSize?: number;
  start?: string | null;
  end?: string | null;
}) {
  return JSON.stringify({
    sessionRoute: input.sessionRoute,
    view: input.view,
    days: input.days ?? null,
    model: input.model ?? null,
    page: input.page ?? null,
    pageSize: input.pageSize ?? null,
    start: input.start ?? null,
    end: input.end ?? null
  });
}

function getCached(key: string) {
  const entry = overviewCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    overviewCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: CachedOverview["value"]) {
  if (overviewCache.size >= OVERVIEW_CACHE_MAX_ENTRIES) {
    const oldestKey = overviewCache.keys().next().value as string | undefined;
    if (oldestKey) overviewCache.delete(oldestKey);
  }
  overviewCache.set(key, { expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS, value });
}

export async function GET(request: NextRequest) {
  try {
    assertEnv();
  } catch {
    return userDataUnavailableResponse(CACHE_CONTROL_HEADER);
  }

  const session = await getUserSessionFromRequest(request);
  if (!session) {
    return userUnauthorizedResponse(CACHE_CONTROL_HEADER);
  }

  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");
    const view = searchParams.get("view") === "global" ? "global" : "self";
    const days = daysParam ? Number.parseInt(daysParam, 10) : undefined;
    const model = searchParams.get("model");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const page = pageParam ? Number.parseInt(pageParam, 10) : undefined;
    const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : undefined;

    if (view === "global" && !config.allowUserSeeTotalUsage) {
      return NextResponse.json({ error: "Global overview is not available" }, { status: 403, headers: CACHE_CONTROL_HEADER });
    }

    const skipCacheParam = searchParams.get("skipCache");
    const skipCache = skipCacheParam === "1" || skipCacheParam === "true";
    const cacheKey = makeCacheKey({
      sessionRoute: session.route,
      view,
      days,
      model,
      page,
      pageSize,
      start,
      end
    });

    if (!skipCache) {
      const cached = getCached(cacheKey);
      if (cached) {
        return NextResponse.json(cached, { status: 200, headers: CACHE_CONTROL_HEADER });
      }
    }

    const inFlightKey = `${cacheKey}:skip=${skipCache}`;
    const pending = overviewInFlight.get(inFlightKey);
    if (pending) {
      const payload = await pending;
      return NextResponse.json(payload, { status: 200, headers: CACHE_CONTROL_HEADER });
    }

    const requestPromise = getUserOverview(session, days, {
      view,
      model: model || undefined,
      page,
      pageSize,
      start,
      end,
      timezone: config.timezone
    }).then((payload) => {
      setCached(cacheKey, payload);
      return payload;
    }).finally(() => {
      if (overviewInFlight.get(inFlightKey) === requestPromise) {
        overviewInFlight.delete(inFlightKey);
      }
    });

    overviewInFlight.set(inFlightKey, requestPromise);
    const payload = await requestPromise;
    return NextResponse.json(payload, { status: 200, headers: CACHE_CONTROL_HEADER });
  } catch (error) {
    console.error("/api/user/overview failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CACHE_CONTROL_HEADER });
  }
}
