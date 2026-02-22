import { NextResponse } from "next/server";
import { gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authFileMappings, usageRecords } from "@/lib/db/schema";

export const runtime = "nodejs";

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");
    const since = parseDate(sinceParam);

    const [usageRows, authRows] = await Promise.all([
      db.select({ lastSyncAt: sql<Date | null>`max(${usageRecords.syncedAt})` }).from(usageRecords),
      db.select({ lastSyncAt: sql<Date | null>`max(${authFileMappings.syncedAt})` }).from(authFileMappings)
    ]);

    const usageLastSync = parseDate(usageRows[0]?.lastSyncAt ?? null);
    const authLastSync = parseDate(authRows[0]?.lastSyncAt ?? null);
    const lastSyncAt = usageLastSync && authLastSync
      ? (usageLastSync.getTime() >= authLastSync.getTime() ? usageLastSync : authLastSync)
      : usageLastSync ?? authLastSync;

    let pendingUsageRequests = 0;
    if (since) {
      const pendingRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(usageRecords)
        .where(gt(usageRecords.syncedAt, since));
      pendingUsageRequests = Number(pendingRows[0]?.count ?? 0);
    }

    return NextResponse.json({
      lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
      latestUsageSyncAt: usageLastSync ? usageLastSync.toISOString() : null,
      pendingUsageRequests
    });
  } catch (error) {
    console.error("/api/last-sync failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
