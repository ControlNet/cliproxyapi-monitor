import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { modelPrices } from "@/lib/db/schema";
import { getModelPrices, invalidateModelPricesCache } from "@/lib/queries/model-prices";

const priceSchema = z.object({
  model: z.string().min(1),
  inputPricePer1M: z.number().nonnegative(),
  cachedInputPricePer1M: z.number().nonnegative().optional().default(0),
  outputPricePer1M: z.number().nonnegative()
});

export const runtime = "nodejs";

function ensureDbEnv() {
  if (!config.postgresUrl) {
    throw new Error("DATABASE_URL is missing");
  }
}

export async function GET() {
  try {
    ensureDbEnv();
    const prices = await getModelPrices();
    return NextResponse.json(prices, { status: 200 });
  } catch (error) {
    console.error("/api/prices GET failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    ensureDbEnv();
    const body = await request.json();
    const parsed = priceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const data = parsed.data;
    await db
      .insert(modelPrices)
      .values({
        model: data.model,
        inputPricePer1M: String(data.inputPricePer1M),
        cachedInputPricePer1M: String(data.cachedInputPricePer1M ?? 0),
        outputPricePer1M: String(data.outputPricePer1M)
      })
      .onConflictDoUpdate({
        target: modelPrices.model,
        set: {
          inputPricePer1M: String(data.inputPricePer1M),
          cachedInputPricePer1M: String(data.cachedInputPricePer1M ?? 0),
          outputPricePer1M: String(data.outputPricePer1M)
        }
      });

    invalidateModelPricesCache();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("/api/prices POST failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

const deleteSchema = z.object({
  model: z.string().min(1)
});

export async function DELETE(request: Request) {
  try {
    ensureDbEnv();
    const body = await request.json();
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    await db.delete(modelPrices).where(eq(modelPrices.model, parsed.data.model));
    invalidateModelPricesCache();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("/api/prices DELETE failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
