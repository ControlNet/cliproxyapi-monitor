import { db } from "@/lib/db/client";
import { usageRecords } from "@/lib/db/schema";

type UsageRow = typeof usageRecords.$inferInsert;

function isBindProtocolError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "08P01") return true;

  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.includes("bind message");
}

export async function insertUsageRows(rows: UsageRow[], batchSize: number) {
  if (rows.length === 0) return 0;

  const insertBatch = async (batch: UsageRow[]) => {
    const insertedRows = await db
      .insert(usageRecords)
      .values(batch)
      .onConflictDoNothing()
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
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    inserted += await insertBatchWithRetry(chunk);
  }

  return inserted;
}
