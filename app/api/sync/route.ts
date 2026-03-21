import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { config, assertEnv } from "@/lib/config";
import { db } from "@/lib/db/client";
import { authFileMappings, usageRecords } from "@/lib/db/schema";
import { toAuthFileMappings } from "@/lib/auth-files";
import { parseUsagePayload, toUsageRecords } from "@/lib/usage";

export const runtime = "nodejs";

const PASSWORD = config.password;
const COOKIE_NAME = "dashboard_auth";
const AUTH_FILES_TIMEOUT_MS = 15_000;
const INCREMENTAL_LOOKBACK_MINUTES = 20;
const FULL_SYNC_QUERY_VALUES = new Set(["1", "true", "yes", "on"]);

function toPositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

const DEFAULT_USAGE_INSERT_BATCH_SIZE = Math.max(1, Math.floor(2_000 / 13));
const USAGE_TIMEOUT_MS = toPositiveInt(process.env.NEXT_PUBLIC_SYNC_TIMEOUT_MS, 60_000);
const AUTH_FILES_INSERT_CHUNK_SIZE = toPositiveInt(process.env.AUTH_FILES_INSERT_CHUNK_SIZE, 500);
const USAGE_INSERT_BATCH_SIZE = toPositiveInt(process.env.USAGE_INSERT_CHUNK_SIZE, DEFAULT_USAGE_INSERT_BATCH_SIZE);

type UsageRow = typeof usageRecords.$inferInsert;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function missingPassword() {
  return NextResponse.json({ error: "PASSWORD is missing" }, { status: 501 });
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isFullSyncRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const full = searchParams.get("full");
  if (!full) return false;
  return FULL_SYNC_QUERY_VALUES.has(full.trim().toLowerCase());
}

function usageKey(route: string, model: string, source: string) {
  return `${route}\u0001${model}\u0001${source}`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAuthorized(request: Request) {
  // 检查 Bearer token（用于 cron job 等外部调用）
  const allowed = [config.password, config.cronSecret].filter(Boolean).map((v) => `Bearer ${v}`);
  if (allowed.length > 0) {
    const auth = request.headers.get("authorization") || "";
    if (allowed.includes(auth)) return true;
  }
  
  // 检查用户的 dashboard cookie（用于前端调用）
  if (PASSWORD) {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(COOKIE_NAME);
    if (authCookie) {
      const expectedToken = await hashPassword(PASSWORD);
      if (authCookie.value === expectedToken) return true;
    }
  }
  
  return false;
}

async function syncAuthFileMappings(pulledAt: Date) {
  const authFilesUrl = `${config.cliproxy.baseUrl.replace(/\/$/, "")}/auth-files`;

  const response = await fetchWithTimeout(authFilesUrl, {
    headers: {
      Authorization: `Bearer ${config.cliproxy.apiKey}`,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  }, AUTH_FILES_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to fetch auth-files: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const rows = toAuthFileMappings(json, pulledAt);
  if (rows.length === 0) return 0;

  for (const chunk of chunkArray(rows, AUTH_FILES_INSERT_CHUNK_SIZE)) {
    await db
      .insert(authFileMappings)
      .values(chunk)
      .onConflictDoUpdate({
        target: authFileMappings.authId,
        set: {
          name: sql`coalesce(nullif(excluded.name, ''), ${authFileMappings.name})`,
          label: sql`coalesce(nullif(excluded.label, ''), ${authFileMappings.label})`,
          provider: sql`coalesce(nullif(excluded.provider, ''), ${authFileMappings.provider})`,
          source: sql`coalesce(nullif(excluded.source, ''), ${authFileMappings.source})`,
          email: sql`coalesce(nullif(excluded.email, ''), ${authFileMappings.email})`,
          updatedAt: sql`coalesce(excluded.updated_at, ${authFileMappings.updatedAt})`,
          syncedAt: pulledAt
        }
      });
  }

  return rows.length;
}

function isBindProtocolError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "08P01") return true;

  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.includes("bind message");
}

async function insertUsageRows(rows: UsageRow[]) {
  if (rows.length === 0) return 0;

  const insertBatch = async (batch: UsageRow[]) => {
    const insertedRows = await db
      .insert(usageRecords)
      .values(batch)
      .onConflictDoNothing({
        target: [usageRecords.occurredAt, usageRecords.route, usageRecords.model, usageRecords.source]
      })
      .returning({ id: usageRecords.id });
    return insertedRows.length;
  };

  const insertBatchWithRetry = async (batch: UsageRow[]): Promise<number> => {
    try {
      return await insertBatch(batch);
    } catch (error) {
      if (!isBindProtocolError(error) || batch.length <= 1) {
        throw error;
      }

      const middle = Math.ceil(batch.length / 2);
      const left = batch.slice(0, middle);
      const right = batch.slice(middle);

      console.warn("/api/sync usage insert hit bind protocol issue, retrying with smaller batch", {
        failedBatchSize: batch.length,
        leftBatchSize: left.length,
        rightBatchSize: right.length
      });

      const leftInserted = await insertBatchWithRetry(left);
      const rightInserted = await insertBatchWithRetry(right);
      return leftInserted + rightInserted;
    }
  };

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += USAGE_INSERT_BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + USAGE_INSERT_BATCH_SIZE);
    inserted += await insertBatchWithRetry(chunk);
  }

  return inserted;
}

async function performSync(request: Request) {
  if (!config.password && !config.cronSecret && !PASSWORD) return missingPassword();
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    assertEnv();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 501 });
  }

  const usageUrl = `${config.cliproxy.baseUrl.replace(/\/$/, "")}/usage`;
  const pulledAt = new Date();

  let response: Response;
  try {
    response = await fetchWithTimeout(usageUrl, {
      headers: {
        Authorization: `Bearer ${config.cliproxy.apiKey}`,
        "Content-Type": "application/json"
      },
      cache: "no-store"
    }, USAGE_TIMEOUT_MS);
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    console.warn("[sync] usage fetch failed", {
      reason: isTimeout ? "timeout" : "error",
      isTimeout,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      {
        error: isTimeout ? "Upstream usage request timed out" : "Failed to fetch usage"
      },
      { status: isTimeout ? 504 : 502 }
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to fetch usage", statusText: response.statusText },
      { status: response.status }
    );
  }

  let payload: ReturnType<typeof parseUsagePayload>;
  try {
    const json = await response.json();
    payload = parseUsagePayload(json);
  } catch (parseError) {
    console.error("/api/sync parse upstream usage failed:", parseError);
    return NextResponse.json(
      { error: "Bad Gateway" },
      { status: 502 }
    );
  }

  const rows = toUsageRecords(payload, pulledAt);

  const fullSync = isFullSyncRequest(request);
  let rowsForInsert = rows;
  if (!fullSync && rows.length > 0) {
    const latestOccurredRows = await db
      .select({
        route: usageRecords.route,
        model: usageRecords.model,
        source: usageRecords.source,
        latestOccurredAt: sql<Date | null>`max(${usageRecords.occurredAt})`
      })
      .from(usageRecords)
      .groupBy(usageRecords.route, usageRecords.model, usageRecords.source);

    const latestByKey = new Map<string, Date>();
    for (const row of latestOccurredRows) {
      const latestOccurredAt = parseDate(row.latestOccurredAt);
      if (!latestOccurredAt) continue;
      latestByKey.set(usageKey(row.route, row.model, row.source), latestOccurredAt);
    }

    rowsForInsert = rows.filter((row) => {
      const occurredAt = parseDate(row.occurredAt);
      if (!occurredAt) return true;

      const key = usageKey(row.route, row.model, row.source ?? "");
      const latestOccurredAt = latestByKey.get(key);
      if (!latestOccurredAt) return true;

      const windowStart = new Date(
        latestOccurredAt.getTime() - INCREMENTAL_LOOKBACK_MINUTES * 60_000
      );
      return occurredAt > windowStart;
    });
  }

  const filteredOut = rows.length - rowsForInsert.length;

  let authFilesSynced = 0;
  let authFilesWarning: string | undefined;
  try {
    authFilesSynced = await syncAuthFileMappings(pulledAt);
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    authFilesWarning = isTimeout ? "auth-files sync timed out" : "auth-files sync failed";
    console.warn("/api/sync auth-files sync failed:", error);
  }

  if (rows.length === 0) {
    return NextResponse.json({
      status: "ok",
      inserted: 0,
      message: "No usage data",
      authFilesSynced,
      attempted: 0,
      insertAttempted: 0,
      filteredOut: 0,
      fullSync,
      ...(authFilesWarning ? { authFilesWarning } : {})
    });
  }

  if (rowsForInsert.length === 0) {
    return NextResponse.json({
      status: "ok",
      inserted: 0,
      message: "No new usage data after incremental filter",
      authFilesSynced,
      attempted: rows.length,
      insertAttempted: 0,
      filteredOut,
      fullSync,
      lookbackMinutes: INCREMENTAL_LOOKBACK_MINUTES,
      ...(authFilesWarning ? { authFilesWarning } : {})
    });
  }

  let inserted = 0;
  try {
    inserted = await insertUsageRows(rowsForInsert);
  } catch (dbError) {
    console.error("/api/sync database insert failed:", dbError);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }

  // Vercel Postgres may return an empty array even when rows are inserted with RETURNING + ON CONFLICT DO NOTHING.
  // Fall back to counting rows synced in this run (identified by the shared pulledAt timestamp) to avoid reporting 0.
  if (inserted === 0 && rowsForInsert.length > 0) {
    const fallback = await db
      .select({ count: sql<number>`count(*)` })
      .from(usageRecords)
      .where(eq(usageRecords.syncedAt, pulledAt));
    inserted = Number(fallback?.[0]?.count ?? 0);
  }

  return NextResponse.json({
    status: "ok",
    inserted,
    attempted: rows.length,
    insertAttempted: rowsForInsert.length,
    filteredOut,
    fullSync,
    lookbackMinutes: INCREMENTAL_LOOKBACK_MINUTES,
    authFilesSynced,
    ...(authFilesWarning ? { authFilesWarning } : {})
  });
}

export async function POST(request: Request) {
  return performSync(request);
}

export async function GET(request: Request) {
  return performSync(request);
}
