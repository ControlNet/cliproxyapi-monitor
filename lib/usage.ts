import { z } from "zod";
import { usageRecords } from "@/lib/db/schema";

// 上游 API 的 tokens 对象结构
const tokensSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  total_tokens: z.number().optional()
});

const detailSchema = z.object({
  timestamp: z.string().optional(),
  source: z.string().optional(),
  // 保留 auth_index 原值（字符串或数字），避免历史/异构格式被丢弃
  auth_index: z.union([z.string(), z.number()]).optional(),
  tokens: tokensSchema.optional(),
  failed: z.boolean().optional(),
  // 兼容旧格式
  total_tokens: z.number().optional(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  success: z.boolean().optional()
});

const modelSchema = z.object({
  total_tokens: z.number().optional(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  details: z.array(detailSchema).optional()
});

const apiSchema = z.object({
  total_tokens: z.number().optional(),
  models: z.record(z.string(), modelSchema).optional()
});

const usageSchema = z.object({
  total_tokens: z.number().optional(),
  requests_by_day: z.record(z.string(), z.number()).optional(),
  requests_by_hour: z.record(z.string(), z.number()).optional(),
  tokens_by_day: z.record(z.string(), z.number()).optional(),
  tokens_by_hour: z.record(z.string(), z.number()).optional(),
  apis: z.record(z.string(), apiSchema).optional()
});

const responseSchema = z.object({ usage: usageSchema.optional() });

const usageQueueTokensSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  total_tokens: z.number().optional()
});

const usageQueueEventSchema = z.object({
  timestamp: z.union([z.string(), z.number()]).optional(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  alias: z.string().optional(),
  source: z.string().optional(),
  auth_index: z.union([z.string(), z.number()]).optional(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  tokens: usageQueueTokensSchema.optional(),
  failed: z.boolean().optional(),
  request_id: z.string().optional(),
  api_key: z.string().optional()
}).passthrough();

export type UsageResponse = z.infer<typeof responseSchema>;
export type UsageRecordInsert = typeof usageRecords.$inferInsert;
type ApiParsed = z.infer<typeof apiSchema>;
type ModelParsed = z.infer<typeof modelSchema>;
export type UsageQueueEvent = z.infer<typeof usageQueueEventSchema>;
export type UsageQueueWarning = {
  index: number;
  reason: "invalid-json" | "invalid-event";
  message: string;
};
export type UsageQueueParseResult = {
  events: UsageQueueEvent[];
  warnings: UsageQueueWarning[];
};

function parseDetailTokens(detail: z.infer<typeof detailSchema>) {
  const tokens = detail.tokens;
  return {
    totalTokens: tokens?.total_tokens ?? detail.total_tokens ?? 0,
    inputTokens: tokens?.input_tokens ?? detail.input_tokens ?? 0,
    outputTokens: tokens?.output_tokens ?? detail.output_tokens ?? 0,
    reasoningTokens: tokens?.reasoning_tokens ?? 0,
    cachedTokens: tokens?.cached_tokens ?? detail.cached_tokens ?? 0
  };
}

function parseDetailTimestamp(detail: z.infer<typeof detailSchema>, fallback: Date) {
  if (!detail.timestamp) return fallback;
  const date = new Date(detail.timestamp);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function parseDetailSource(detail: z.infer<typeof detailSchema>) {
  return detail.source?.trim() ?? "";
}

function parseDetailAuthIndex(detail: z.infer<typeof detailSchema>) {
  if (detail.auth_index === undefined || detail.auth_index === null) return null;
  const value = String(detail.auth_index).trim();
  return value.length > 0 ? value : null;
}

function isDetailSuccess(detail: z.infer<typeof detailSchema>) {
  // failed=true 表示失败，success=false 表示失败，其余视为成功
  if (detail.failed === true) return false;
  if (detail.success === false) return false;
  return true;
}

function parseQueueTokenValue(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function parseQueueTokens(event: UsageQueueEvent) {
  const tokens = event.tokens;
  const inputTokens = parseQueueTokenValue(tokens?.input_tokens, event.input_tokens);
  const outputTokens = parseQueueTokenValue(tokens?.output_tokens, event.output_tokens);
  const reasoningTokens = parseQueueTokenValue(tokens?.reasoning_tokens, event.reasoning_tokens);
  const cachedTokens = parseQueueTokenValue(tokens?.cached_tokens, event.cached_tokens);
  const providedTotal = tokens?.total_tokens ?? event.total_tokens;

  return {
    totalTokens: typeof providedTotal === "number" && Number.isFinite(providedTotal)
      ? providedTotal
      : inputTokens + outputTokens + reasoningTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens
  };
}

function parseQueueTimestamp(event: UsageQueueEvent, fallback: Date) {
  if (event.timestamp === undefined || event.timestamp === null) return fallback;
  const date = new Date(event.timestamp);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function parseQueueRoute(event: UsageQueueEvent) {
  const apiKey = event.api_key?.trim();
  if (apiKey && apiKey.length > 0) {
    return apiKey;
  }

  return "";
}

function parseQueueModel(event: UsageQueueEvent) {
  const model = event.model?.trim();
  if (model && model.length > 0) return model;

  const alias = event.alias?.trim();
  return alias && alias.length > 0 ? alias : "unknown";
}

function parseQueueSource(event: UsageQueueEvent) {
  return event.source?.trim() ?? "";
}

function parseQueueAuthIndex(event: UsageQueueEvent) {
  if (event.auth_index === undefined || event.auth_index === null) return null;
  const value = String(event.auth_index).trim();
  return value.length > 0 ? value : null;
}

function parseQueueRequestId(event: UsageQueueEvent) {
  const value = event.request_id?.trim();
  return value && value.length > 0 ? value : null;
}

function isSensitiveUsageQueueKey(key: string) {
  const lowerKey = key.trim().toLowerCase();
  const normalizedKey = lowerKey.replace(/[^a-z0-9]/g, "");

  if (normalizedKey.includes("bearer")) {
    return true;
  }

  return new Set(["apikey", "authorization", "accesstoken", "refreshtoken", "idtoken", "bearer"]).has(normalizedKey);
}

function redactUsageQueueValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactUsageQueueValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveUsageQueueKey(key) ? "[REDACTED]" : redactUsageQueueValue(entry)
      ])
    );
  }

  return value;
}

export function parseUsagePayload(json: unknown): UsageResponse {
  return responseSchema.parse(json);
}

export function parseUsageQueuePayload(payload: unknown): UsageQueueParseResult {
  const items = payload === null || payload === undefined
    ? []
    : Array.isArray(payload)
      ? payload
      : [payload];

  const events: UsageQueueEvent[] = [];
  const warnings: UsageQueueWarning[] = [];

  items.forEach((item, index) => {
    let candidate = item;

    if (typeof item === "string") {
      try {
        candidate = JSON.parse(item);
      } catch (error) {
        warnings.push({
          index,
          reason: "invalid-json",
          message: error instanceof Error ? error.message : "Invalid JSON queue item"
        });
        return;
      }
    }

    const parsed = usageQueueEventSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push({
        index,
        reason: "invalid-event",
        message: parsed.error.issues.map((issue) => issue.message).join("; ") || "Invalid usage queue event"
      });
      return;
    }

    events.push(parsed.data);
  });

  return { events, warnings };
}

export function redactUsageQueueRaw(payload: unknown) {
  return JSON.stringify(redactUsageQueueValue(payload));
}

export function toUsageRecordsFromQueueEvents(events: UsageQueueEvent[], pulledAt: Date = new Date()): UsageRecordInsert[] {
  return events.map((event) => {
    const tokenSlice = parseQueueTokens(event);

    return {
      occurredAt: parseQueueTimestamp(event, pulledAt),
      syncedAt: pulledAt,
      route: parseQueueRoute(event),
      source: parseQueueSource(event),
      authIndex: parseQueueAuthIndex(event),
      requestId: parseQueueRequestId(event),
      model: parseQueueModel(event),
      totalTokens: tokenSlice.totalTokens,
      inputTokens: tokenSlice.inputTokens,
      outputTokens: tokenSlice.outputTokens,
      reasoningTokens: tokenSlice.reasoningTokens,
      cachedTokens: tokenSlice.cachedTokens,
      isError: event.failed === true,
      raw: redactUsageQueueRaw(event)
    };
  });
}

export function toUsageRecords(payload: UsageResponse, pulledAt: Date = new Date()): UsageRecordInsert[] {
  const apis = payload.usage?.apis as Record<string, ApiParsed> | undefined;
  if (!apis) return [];

  const rows: UsageRecordInsert[] = [];

  for (const [route, api] of Object.entries(apis)) {
    const models = (api as ApiParsed).models ?? {};
    for (const [model, stats] of Object.entries(models)) {
      const typed = stats as ModelParsed;
      const details = typed.details ?? [];

      if (details.length > 0) {
        for (const detail of details) {
          const tokenSlice = parseDetailTokens(detail);
          const occurredAt = parseDetailTimestamp(detail, pulledAt);
          const success = isDetailSuccess(detail);

          rows.push({
            occurredAt,
            syncedAt: pulledAt,
            route,
            source: parseDetailSource(detail),
            authIndex: parseDetailAuthIndex(detail),
            model,
            totalTokens: tokenSlice.totalTokens,
            inputTokens: tokenSlice.inputTokens,
            outputTokens: tokenSlice.outputTokens,
            reasoningTokens: tokenSlice.reasoningTokens,
            cachedTokens: tokenSlice.cachedTokens,
            isError: !success,
            raw: JSON.stringify({ route, model, detail })
          });
        }
        continue;
      }
    }
  }

  return rows;
}

type PriceEntry = { model: string; inputPricePer1M: number; cachedInputPricePer1M: number; outputPricePer1M: number };
type PriceInfo = { in: number; cachedIn: number; out: number };

export function priceMap(prices: PriceEntry[]) {
  // 分离精确匹配和通配符模式
  const exact: Record<string, PriceInfo> = {};
  const patterns: { regex: RegExp; price: PriceInfo; original: string }[] = [];
  
  for (const cur of prices) {
    const price: PriceInfo = { in: cur.inputPricePer1M, cachedIn: cur.cachedInputPricePer1M, out: cur.outputPricePer1M };
    if (cur.model.includes("*")) {
      // 转换通配符为正则：* -> .* 
      const regexStr = "^" + cur.model.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
      patterns.push({ regex: new RegExp(regexStr), price, original: cur.model });
    } else {
      exact[cur.model] = price;
    }
  }
  
  // 按非通配符字符数量降序排序，优先匹配更具体的模式（与 SQL 逻辑保持一致）
  patterns.sort((a, b) => {
    const aSpecificity = a.original.replace(/\*/g, "").length;
    const bSpecificity = b.original.replace(/\*/g, "").length;
    return bSpecificity - aSpecificity || b.original.length - a.original.length;
  });
  
  return { exact, patterns };
}

export function findPrice(model: string, prices: ReturnType<typeof priceMap>): PriceInfo | undefined {
  // 精确匹配优先
  if (prices.exact[model]) return prices.exact[model];
  // 尝试通配符匹配
  for (const { regex, price } of prices.patterns) {
    if (regex.test(model)) return price;
  }
  return undefined;
}

export function estimateCost(
  tokens: { inputTokens: number; cachedTokens?: number; outputTokens: number; reasoningTokens?: number },
  model: string,
  prices: ReturnType<typeof priceMap>
) {
  const priceInfo = findPrice(model, prices);
  if (!priceInfo) return 0;
  // 价格单位是 $/M tokens，所以除以 1_000_000
  const cachedTokens = tokens.cachedTokens ?? 0;
  const reasoningTokens = tokens.reasoningTokens ?? 0;
  const regularInputTokens = Math.max(0, tokens.inputTokens - cachedTokens);
  const inputCost = (regularInputTokens / 1_000_000) * priceInfo.in;
  const cachedCost = (cachedTokens / 1_000_000) * priceInfo.cachedIn;
  const outputCost = ((tokens.outputTokens + reasoningTokens) / 1_000_000) * priceInfo.out;
  return Number((inputCost + cachedCost + outputCost).toFixed(6));
}
