import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { config, assertEnv } from "@/lib/config";
import {
  fetchCliproxyUsageQueueWithHttp,
  fetchCliproxyUsageQueueWithResp,
  type CliproxyUsageQueueResultSource,
  type CliproxyUsageQueueWarning
} from "@/lib/cliproxy-usage-queue";
import { db } from "@/lib/db/client";
import { authFileMappings, usageRecords } from "@/lib/db/schema";
import { insertUsageRows } from "@/lib/db/usage-records";
import { toAuthFileMappings } from "@/lib/auth-files";
import {
  parseUsagePayload,
  toUsageRecords,
  toUsageRecordsFromQueueEvents,
  type UsageRecordInsert
} from "@/lib/usage";

export const runtime = "nodejs";

const PASSWORD = config.password;
const COOKIE_NAME = "dashboard_auth";
const AUTH_FILES_TIMEOUT_MS = 15_000;
const INCREMENTAL_LOOKBACK_MINUTES = 20;
const FULL_SYNC_QUERY_VALUES = new Set(["1", "true", "yes", "on"]);
const SYNC_LOCK_NAMESPACE = 4_151;
const SYNC_LOCK_KEY = 5;

type SyncSource = CliproxyUsageQueueResultSource | "legacy-usage";
type AuthFilesWarning = {
  source: "auth-files";
  kind: "timeout" | "upstream";
  code: string;
  message: string;
  status?: number;
};
type SyncWarning = CliproxyUsageQueueWarning | AuthFilesWarning;
type UsageFetchSuccess = {
  ok: true;
  source: SyncSource;
  rows: UsageRecordInsert[];
  warnings: SyncWarning[];
  legacy: boolean;
};
type UsageFetchFailure = {
  ok: false;
  source: SyncSource;
  error: string;
  status: number;
  warnings: SyncWarning[];
};

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
      Authorization: `Bearer ${config.cliproxy.managementKey}`,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  }, AUTH_FILES_TIMEOUT_MS);

  if (!response.ok) {
    const error = new Error(`Failed to fetch auth-files: ${response.status} ${response.statusText}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
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

function buildFailureResponse(params: {
  status: number;
  error: string;
  source: SyncSource;
  authFilesSynced: number;
  warnings: SyncWarning[];
  fullSync: boolean;
}) {
  return NextResponse.json(
    {
      error: params.error,
      source: params.source,
      attempted: 0,
      insertAttempted: 0,
      inserted: 0,
      filteredOut: 0,
      authFilesSynced: params.authFilesSynced,
      warnings: params.warnings,
      fullSync: params.fullSync
    },
    { status: params.status }
  );
}

function toAuthFilesWarning(error: unknown): AuthFilesWarning {
  const isTimeout = error instanceof Error && error.name === "AbortError";
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;

  return {
    source: "auth-files",
    kind: isTimeout ? "timeout" : "upstream",
    code: isTimeout ? "auth-files-timeout" : "auth-files-sync-failed",
    message: isTimeout ? "auth-files sync timed out" : "auth-files sync failed",
    ...(status !== undefined ? { status } : {})
  };
}

async function tryAcquireSyncLock() {
  const result = await db.$client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1, $2) as locked",
    [SYNC_LOCK_NAMESPACE, SYNC_LOCK_KEY]
  );
  return result.rows[0]?.locked === true;
}

async function releaseSyncLock() {
  await db.$client.query(
    "select pg_advisory_unlock($1, $2) as unlocked",
    [SYNC_LOCK_NAMESPACE, SYNC_LOCK_KEY]
  );
}

function queueFetchSuccess(
  source: CliproxyUsageQueueResultSource,
  rows: UsageRecordInsert[],
  warnings: CliproxyUsageQueueWarning[]
): UsageFetchSuccess {
  return {
    ok: true,
    source,
    rows,
    warnings,
    legacy: false
  };
}

function queueFetchFailure(
  source: CliproxyUsageQueueResultSource,
  warnings: CliproxyUsageQueueWarning[]
): UsageFetchFailure {
  return {
    ok: false,
    source,
    error: "Failed to fetch usage queue",
    status: 502,
    warnings
  };
}

async function fetchRespQueueUsage(pulledAt: Date): Promise<UsageFetchSuccess | UsageFetchFailure> {
  const result = await fetchCliproxyUsageQueueWithResp();
  if (!result.ok) {
    return queueFetchFailure(result.source, result.warnings);
  }

  return queueFetchSuccess(result.source, toUsageRecordsFromQueueEvents(result.records, pulledAt), result.warnings);
}

async function fetchHttpQueueUsage(pulledAt: Date): Promise<UsageFetchSuccess | UsageFetchFailure> {
  const result = await fetchCliproxyUsageQueueWithHttp();
  if (!result.ok) {
    return queueFetchFailure(result.source, result.warnings);
  }

  return queueFetchSuccess(result.source, toUsageRecordsFromQueueEvents(result.records, pulledAt), result.warnings);
}

async function fetchLegacyUsage(pulledAt: Date): Promise<UsageFetchSuccess | UsageFetchFailure> {
  const usageUrl = `${config.cliproxy.baseUrl.replace(/\/$/, "")}/usage`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      usageUrl,
      {
        headers: {
          Authorization: `Bearer ${config.cliproxy.managementKey}`,
          "Content-Type": "application/json"
        },
        cache: "no-store"
      },
      USAGE_TIMEOUT_MS
    );
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    console.warn("[sync] legacy usage fetch failed", {
      reason: isTimeout ? "timeout" : "error",
      isTimeout,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      source: "legacy-usage",
      error: isTimeout ? "Upstream usage request timed out" : "Failed to fetch usage",
      status: isTimeout ? 504 : 502,
      warnings: []
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      source: "legacy-usage",
      error: "Failed to fetch usage",
      status: response.status,
      warnings: []
    };
  }

  let payload: ReturnType<typeof parseUsagePayload>;
  try {
    const json = await response.json();
    payload = parseUsagePayload(json);
  } catch (parseError) {
    console.error("/api/sync parse upstream usage failed:", parseError);
    return {
      ok: false,
      source: "legacy-usage",
      error: "Bad Gateway",
      status: 502,
      warnings: []
    };
  }

  return {
    ok: true,
    source: "legacy-usage",
    rows: toUsageRecords(payload, pulledAt),
    warnings: [],
    legacy: true
  };
}

async function resolveUsageSource(pulledAt: Date): Promise<UsageFetchSuccess | UsageFetchFailure> {
  const requestedSource = config.cliproxy.usageQueue.source;

  if (requestedSource === "resp") {
    return fetchRespQueueUsage(pulledAt);
  }

  if (requestedSource === "http") {
    return fetchHttpQueueUsage(pulledAt);
  }

  if (requestedSource === "legacy") {
    return fetchLegacyUsage(pulledAt);
  }

  const warnings: SyncWarning[] = [];

  const respResult = await fetchRespQueueUsage(pulledAt);
  if (respResult.ok) {
    return { ...respResult, warnings: [...warnings, ...respResult.warnings] };
  }
  warnings.push(...respResult.warnings);

  const httpResult = await fetchHttpQueueUsage(pulledAt);
  if (httpResult.ok) {
    return { ...httpResult, warnings: [...warnings, ...httpResult.warnings] };
  }
  warnings.push(...httpResult.warnings);

  const legacyResult = await fetchLegacyUsage(pulledAt);
  if (legacyResult.ok) {
    return { ...legacyResult, warnings: [...warnings, ...legacyResult.warnings] };
  }

  return {
    ...legacyResult,
    warnings: [...warnings, ...legacyResult.warnings]
  };
}

async function applyLegacyIncrementalFilter(rows: UsageRecordInsert[], fullSync: boolean) {
  if (fullSync || rows.length === 0) {
    return { rowsForInsert: rows, filteredOut: 0 };
  }

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

  const rowsForInsert = rows.filter((row) => {
    const occurredAt = parseDate(row.occurredAt);
    if (!occurredAt) return true;

    const key = usageKey(row.route, row.model, row.source ?? "");
    const latestOccurredAt = latestByKey.get(key);
    if (!latestOccurredAt) return true;

    const windowStart = new Date(latestOccurredAt.getTime() - INCREMENTAL_LOOKBACK_MINUTES * 60_000);
    return occurredAt > windowStart;
  });

  return {
    rowsForInsert,
    filteredOut: rows.length - rowsForInsert.length
  };
}

async function performSync(request: Request) {
  if (!config.password && !config.cronSecret && !PASSWORD) return missingPassword();
  if (!(await isAuthorized(request))) return unauthorized();

  const fullSync = isFullSyncRequest(request);

  try {
    assertEnv({ requireManagementKey: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 501 });
  }

  const pulledAt = new Date();
  let lockAcquired = false;

  try {

    lockAcquired = await tryAcquireSyncLock();
    if (!lockAcquired) {
      return NextResponse.json({ error: "sync already running" }, { status: 409 });
    }

    let authFilesSynced = 0;
    const warnings: SyncWarning[] = [];
    try {
      authFilesSynced = await syncAuthFileMappings(pulledAt);
    } catch (error) {
      warnings.push(toAuthFilesWarning(error));
      console.warn("/api/sync auth-files sync failed:", error);
    }

    const usageResult = await resolveUsageSource(pulledAt);
    warnings.push(...usageResult.warnings);
    if (!usageResult.ok) {
      return buildFailureResponse({
        status: usageResult.status,
        error: usageResult.error,
        source: usageResult.source,
        authFilesSynced,
        warnings,
        fullSync
      });
    }

    const attempted = usageResult.rows.length;
    const { rowsForInsert, filteredOut } = usageResult.legacy
      ? await applyLegacyIncrementalFilter(usageResult.rows, fullSync)
      : { rowsForInsert: usageResult.rows, filteredOut: 0 };

    if (attempted === 0) {
      return NextResponse.json({
        status: "ok",
        source: usageResult.source,
        inserted: 0,
        message: "No usage data",
        authFilesSynced,
        attempted,
        insertAttempted: 0,
        filteredOut,
        warnings,
        fullSync
      });
    }

    if (rowsForInsert.length === 0) {
      return NextResponse.json({
        status: "ok",
        source: usageResult.source,
        inserted: 0,
        message: "No new usage data after incremental filter",
        authFilesSynced,
        attempted,
        insertAttempted: 0,
        filteredOut,
        warnings,
        fullSync,
        ...(usageResult.legacy ? { lookbackMinutes: INCREMENTAL_LOOKBACK_MINUTES } : {})
      });
    }

    let inserted = 0;
    try {
      inserted = await insertUsageRows(rowsForInsert, USAGE_INSERT_BATCH_SIZE);
    } catch (dbError) {
      console.error("/api/sync database insert failed:", dbError);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
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
      source: usageResult.source,
      inserted,
      attempted,
      insertAttempted: rowsForInsert.length,
      filteredOut,
      warnings,
      fullSync,
      authFilesSynced,
      ...(usageResult.legacy ? { lookbackMinutes: INCREMENTAL_LOOKBACK_MINUTES } : {})
    });
  } finally {
    if (lockAcquired) {
      try {
        await releaseSyncLock();
      } catch (error) {
        console.warn("/api/sync advisory lock release failed:", error);
      }
    }
  }
}

export async function POST(request: Request) {
  return performSync(request);
}

export async function GET(request: Request) {
  return performSync(request);
}
