import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authFileMappings, usageRecords } from "@/lib/db/schema";

export const runtime = "nodejs";

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function GET() {
  try {
    const [usageRows, authRows] = await Promise.all([
      db.select({ lastSyncAt: sql<Date | null>`max(${usageRecords.syncedAt})` }).from(usageRecords),
      db.select({ lastSyncAt: sql<Date | null>`max(${authFileMappings.syncedAt})` }).from(authFileMappings)
    ]);

    const usageLastSync = parseDate(usageRows[0]?.lastSyncAt ?? null);
    const authLastSync = parseDate(authRows[0]?.lastSyncAt ?? null);
    const lastSyncAt = usageLastSync && authLastSync
      ? (usageLastSync.getTime() >= authLastSync.getTime() ? usageLastSync : authLastSync)
      : usageLastSync ?? authLastSync;

    return NextResponse.json({
      lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null
    });
  } catch (error) {
    console.error("/api/last-sync failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
