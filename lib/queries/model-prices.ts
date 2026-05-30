import { db } from "@/lib/db/client";
import { modelPrices } from "@/lib/db/schema";

type ModelPriceRow = typeof modelPrices.$inferSelect;

export type ModelPricePayload = {
  model: string;
  inputPricePer1M: number;
  cachedInputPricePer1M: number;
  outputPricePer1M: number;
};

const MODEL_PRICES_CACHE_TTL_MS = 30_000;

let modelPricesCache: { expiresAt: number; value: ModelPricePayload[] } | null = null;
let modelPricesInFlight: Promise<ModelPricePayload[]> | null = null;

function normalizeRows(rows: ModelPriceRow[]): ModelPricePayload[] {
  return rows.map((row) => ({
    model: row.model,
    inputPricePer1M: Number(row.inputPricePer1M),
    cachedInputPricePer1M: Number(row.cachedInputPricePer1M),
    outputPricePer1M: Number(row.outputPricePer1M)
  }));
}

export function invalidateModelPricesCache() {
  modelPricesCache = null;
}

export async function getModelPrices(): Promise<ModelPricePayload[]> {
  if (modelPricesCache && Date.now() < modelPricesCache.expiresAt) {
    return modelPricesCache.value;
  }

  if (modelPricesInFlight) {
    return modelPricesInFlight;
  }

  const requestPromise = db
    .select()
    .from(modelPrices)
    .orderBy(modelPrices.model)
    .then((rows) => {
      const value = normalizeRows(rows);
      modelPricesCache = { expiresAt: Date.now() + MODEL_PRICES_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      if (modelPricesInFlight === requestPromise) {
        modelPricesInFlight = null;
      }
    });

  modelPricesInFlight = requestPromise;
  return requestPromise;
}
