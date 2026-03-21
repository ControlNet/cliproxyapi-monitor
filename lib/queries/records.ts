import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authFileMappings, modelPrices, usageRecords } from "@/lib/db/schema";

export type UsageRecordRow = {
  id: number;
  occurredAt: Date;
  route: string;
  source: string;
  credentialName: string;
  provider: string | null;
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  isError: boolean;
  cost: number;
};

export type UsageRecordCursor = {
  lastValues: Array<string | number>;
  lastId: number;
};

export type SortField =
  | "occurredAt"
  | "model"
  | "route"
  | "source"
  | "totalTokens"
  | "inputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "cachedTokens"
  | "cost"
  | "isError";
export type SortOrder = "asc" | "desc";
export type SortKey = { field: SortField; order: SortOrder };

// 注意：必须使用 sql.raw() 来引用外部表字段，否则 Drizzle 会丢失表名前缀
// 反斜杠需要双重转义：JS 字符串转义 + PostgreSQL E'' 字符串转义
const COST_EXPR = sql<number>`coalesce(
  -- 尝试精确匹配
  (select (
    (greatest(${sql.raw('"usage_records"."input_tokens"')} - ${sql.raw('"usage_records"."cached_tokens"')}, 0)::numeric / 1000000) * mp.input_price_per_1m
    + (${sql.raw('"usage_records"."cached_tokens"')}::numeric / 1000000) * mp.cached_input_price_per_1m
    + ((${sql.raw('"usage_records"."output_tokens"')} + ${sql.raw('"usage_records"."reasoning_tokens"')})::numeric / 1000000) * mp.output_price_per_1m
  )
  from model_prices mp
  where mp.model = ${sql.raw('"usage_records"."model"')}
  limit 1),
  -- 如果精确匹配失败，尝试通配符匹配（按非通配符字符数量降序选择最具体的）
  (select (
    (greatest(${sql.raw('"usage_records"."input_tokens"')} - ${sql.raw('"usage_records"."cached_tokens"')}, 0)::numeric / 1000000) * mp.input_price_per_1m
    + (${sql.raw('"usage_records"."cached_tokens"')}::numeric / 1000000) * mp.cached_input_price_per_1m
    + ((${sql.raw('"usage_records"."output_tokens"')} + ${sql.raw('"usage_records"."reasoning_tokens"')})::numeric / 1000000) * mp.output_price_per_1m
  )
  from model_prices mp
  where mp.model like '%*%'
    and ${sql.raw('"usage_records"."model"')} ~ (
      '^' ||
      regexp_replace(
        regexp_replace(
          mp.model,
          E'([.+?^$()\\\\[\\\\]{}|\\\\\\\\-])',
          E'\\\\\\\\\\\\1',
          'g'
        ),
        E'\\\\*',
        '.*',
        'g'
      )
      || '$'
    )
  order by length(replace(mp.model, '*', '')) desc, length(mp.model) desc
  limit 1),
  -- 如果都没匹配，返回 0
  0
)`;

const CREDENTIAL_NAME_EXPR = sql<string>`coalesce(nullif(${authFileMappings.name}, ''), nullif(${usageRecords.source}, ''), '-')`;

function getSortExpr(sortField: SortField): SQL {
  switch (sortField) {
    case "model":
      return sql`${usageRecords.model}`;
    case "route":
      return sql`${usageRecords.route}`;
    case "source":
      return CREDENTIAL_NAME_EXPR;
    case "totalTokens":
      return sql`${usageRecords.totalTokens}`;
    case "inputTokens":
      return sql`${usageRecords.inputTokens}`;
    case "outputTokens":
      return sql`${usageRecords.outputTokens}`;
    case "reasoningTokens":
      return sql`${usageRecords.reasoningTokens}`;
    case "cachedTokens":
      return sql`${usageRecords.cachedTokens}`;
    case "cost":
      return COST_EXPR;
    case "isError":
      return sql`${usageRecords.isError}`;
    case "occurredAt":
    default:
      return sql`${usageRecords.occurredAt}`;
  }
}

function parseCursor(input: string | null): UsageRecordCursor | null {
  if (!input) return null;
  try {
    const raw = Buffer.from(input, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as UsageRecordCursor;
    if (
      parsed &&
      typeof parsed.lastId === "number" &&
      Array.isArray(parsed.lastValues) &&
      parsed.lastValues.every((value) => typeof value === "string" || typeof value === "number")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getCursorValue(field: SortField, row: UsageRecordRow): string | number {
  switch (field) {
    case "model":
      return row.model;
    case "totalTokens":
      return row.totalTokens;
    case "cost":
      return Number(row.cost ?? 0);
    case "route":
      return row.route;
    case "source":
      return row.credentialName;
    case "inputTokens":
      return row.inputTokens;
    case "outputTokens":
      return row.outputTokens;
    case "reasoningTokens":
      return row.reasoningTokens;
    case "cachedTokens":
      return row.cachedTokens;
    case "isError":
      return row.isError ? 1 : 0;
    case "occurredAt":
      return row.occurredAt.toISOString();
  }
}

function toSqlCursorValue(field: SortField, value: string | number): string | number | Date | undefined {
  if (field !== "occurredAt") return value;
  const lastDate = new Date(String(value));
  if (!Number.isFinite(lastDate.getTime())) return undefined;
  return lastDate;
}

function buildCursorWhere(
  sortKeys: SortKey[],
  cursor: UsageRecordCursor | null,
  sortExprs: SQL[]
): SQL | undefined {
  if (!cursor || sortKeys.length === 0 || cursor.lastValues.length < sortKeys.length) return undefined;

  const clauses: SQL[] = [];

  for (let i = 0; i < sortKeys.length; i += 1) {
    const prefixEquals: SQL[] = [];
    let invalidValue = false;

    for (let j = 0; j < i; j += 1) {
      const previousValue = toSqlCursorValue(sortKeys[j].field, cursor.lastValues[j]);
      if (previousValue === undefined) {
        invalidValue = true;
        break;
      }
      prefixEquals.push(sql`${sortExprs[j]} = ${previousValue}`);
    }
    if (invalidValue) return undefined;

    const currentValue = toSqlCursorValue(sortKeys[i].field, cursor.lastValues[i]);
    if (currentValue === undefined) return undefined;
    const comparison = sortKeys[i].order === "asc"
      ? sql`${sortExprs[i]} > ${currentValue}`
      : sql`${sortExprs[i]} < ${currentValue}`;

    clauses.push(prefixEquals.length > 0 ? and(...prefixEquals, comparison)! : comparison);
  }

  const allEquals: SQL[] = [];
  for (let i = 0; i < sortKeys.length; i += 1) {
    const value = toSqlCursorValue(sortKeys[i].field, cursor.lastValues[i]);
    if (value === undefined) return undefined;
    allEquals.push(sql`${sortExprs[i]} = ${value}`);
  }

  const idComparison = sortKeys[0].order === "asc"
    ? sql`${usageRecords.id} > ${cursor.lastId}`
    : sql`${usageRecords.id} < ${cursor.lastId}`;

  clauses.push(and(...allEquals, idComparison)!);

  return or(...clauses)!;
}

export async function getUsageRecords(input: {
  limit?: number;
  sortKeys?: SortKey[];
  sortField?: SortField;
  sortOrder?: SortOrder;
  cursor?: string | null;
  model?: string | null;
  route?: string | null;
  source?: string | null;
  start?: string | null;
  end?: string | null;
  includeFilters?: boolean;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rawSortKeys: SortKey[] =
    input.sortKeys && input.sortKeys.length > 0
      ? input.sortKeys
      : [{ field: input.sortField ?? "occurredAt", order: input.sortOrder ?? "desc" }];
  const seenFields = new Set<SortField>();
  const sortKeys = rawSortKeys.filter((key) => {
    if (seenFields.has(key.field)) return false;
    seenFields.add(key.field);
    return true;
  });
  const primaryKey = sortKeys[0] ?? { field: "occurredAt" as const, order: "desc" as const };
  const cursor = parseCursor(input.cursor ?? null);

  const whereParts: SQL[] = [];

  if (input.start) {
    const startDate = new Date(input.start);
    if (Number.isFinite(startDate.getTime())) {
      whereParts.push(gte(usageRecords.occurredAt, startDate));
    }
  }

  if (input.end) {
    const endDate = new Date(input.end);
    if (Number.isFinite(endDate.getTime())) {
      whereParts.push(lte(usageRecords.occurredAt, endDate));
    }
  }

  if (input.model) {
    whereParts.push(eq(usageRecords.model, input.model));
  }

  if (input.route) {
    whereParts.push(eq(usageRecords.route, input.route));
  }

  if (input.source) {
    whereParts.push(sql`${CREDENTIAL_NAME_EXPR} = ${input.source}`);
  }

  const sortExprs = sortKeys.map((key) => getSortExpr(key.field));

  const cursorWhere = buildCursorWhere(sortKeys, cursor, sortExprs);
  if (cursorWhere) whereParts.push(cursorWhere);

  const where = whereParts.length ? and(...whereParts) : undefined;

  const query = db
    .select({
      id: usageRecords.id,
      occurredAt: usageRecords.occurredAt,
      route: usageRecords.route,
      source: usageRecords.source,
      credentialName: CREDENTIAL_NAME_EXPR,
      provider: authFileMappings.provider,
      model: usageRecords.model,
      totalTokens: usageRecords.totalTokens,
      inputTokens: usageRecords.inputTokens,
      outputTokens: usageRecords.outputTokens,
      reasoningTokens: usageRecords.reasoningTokens,
      cachedTokens: usageRecords.cachedTokens,
      isError: usageRecords.isError,
      cost: COST_EXPR
    })
    .from(usageRecords)
    .leftJoin(authFileMappings, eq(usageRecords.authIndex, authFileMappings.authId))
    .where(where)
    .orderBy(
      ...sortKeys.map((key, index) => (key.order === "asc" ? asc(sortExprs[index]) : desc(sortExprs[index]))),
      primaryKey.order === "asc" ? asc(usageRecords.id) : desc(usageRecords.id)
    )
    .limit(limit + 1);

  const rows = await query;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor = (() => {
    if (!hasMore) return null;
    const last = items[items.length - 1];
    if (!last) return null;
    const cursorPayload: UsageRecordCursor = {
      lastValues: sortKeys.map((key) => getCursorValue(key.field, last)),
      lastId: last.id
    };
    return Buffer.from(JSON.stringify(cursorPayload)).toString("base64");
  })();

  let filters: { models: string[]; routes: string[]; sources: string[] } | undefined;
  if (input.includeFilters) {
    const [modelRows, routeRows, sourceRows] = await Promise.all([
      db
        .select({ model: usageRecords.model })
        .from(usageRecords)
        .where(where)
        .groupBy(usageRecords.model)
        .orderBy(usageRecords.model)
        .limit(200),
      db
        .select({ route: usageRecords.route })
        .from(usageRecords)
        .where(where)
        .groupBy(usageRecords.route)
        .orderBy(usageRecords.route)
        .limit(200),
      db
        .select({ source: CREDENTIAL_NAME_EXPR })
        .from(usageRecords)
        .leftJoin(authFileMappings, eq(usageRecords.authIndex, authFileMappings.authId))
        .where(where)
        .groupBy(CREDENTIAL_NAME_EXPR)
        .orderBy(CREDENTIAL_NAME_EXPR)
        .limit(200),
    ]);
    filters = {
      models: modelRows.map((row) => row.model),
      routes: routeRows.map((row) => row.route),
      sources: sourceRows.map((row) => row.source).filter((name): name is string => Boolean(name) && name !== "-")
    };
  }

  return {
    items: items.map((row) => ({
      ...row,
      cost: Number(row.cost ?? 0)
    })),
    nextCursor,
    filters
  };
}
