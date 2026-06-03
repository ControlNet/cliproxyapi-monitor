import { getOverview, type OverviewMeta, type OverviewQueryOptions } from "@/lib/queries/overview";
import { getUsageRecords, type SortOrder, type UsageRecordRow, type UsageRecordsQueryInput } from "@/lib/queries/records";
import type { UsageOverview } from "@/lib/types";
import type { UserSession } from "@/lib/user-session";

export type UserOverviewView = "self" | "global";
export type UserOverviewFilters = { models: string[] };
export type UserOverviewModelCost = Pick<UsageOverview["models"][number], "model" | "cost">;
export type UserOverviewSummary = {
  totalTokens: number;
  totalRawInputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  estimatedCost: number;
  totalCost: number;
  avgTpm: number;
  requestCount: number;
  totalRequests: number;
};
export type UserOverviewTrends = Pick<UsageOverview, "byDay" | "byHour">;
export type UserOverviewQueryInput = Pick<OverviewQueryOptions, "model" | "page" | "pageSize" | "start" | "end" | "timezone"> & {
  view?: UserOverviewView;
};
export type UserOverviewResult = {
  view: UserOverviewView;
  overview: UsageOverview;
  summary: UserOverviewSummary;
  trends: UserOverviewTrends;
  models: UserOverviewModelCost[];
  totalTokens: number;
  totalRawInputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  estimatedCost: number;
  totalCost: number;
  avgTpm: number;
  requestCount: number;
  totalRequests: number;
  empty: boolean;
  days: number;
  meta: OverviewMeta;
  filters: UserOverviewFilters;
  timezone: string;
};

export type UserRecordsSortField = Exclude<UsageRecordsQueryInput["sortField"], "route" | "source" | undefined>;
export type UserRecordsSortKey = { field: UserRecordsSortField; order: SortOrder };
export type UserUsageRecord = Omit<UsageRecordRow, "route" | "source" | "credentialName" | "provider">;
export type UserRecordsQueryInput = {
  limit?: number;
  sortKeys?: UserRecordsSortKey[];
  sortField?: UserRecordsSortField;
  sortOrder?: SortOrder;
  cursor?: string | null;
  model?: string | null;
  start?: string | null;
  end?: string | null;
  includeFilters?: boolean;
};
export type UserRecordsResult = {
  items: UserUsageRecord[];
  nextCursor: string | null;
  filters?: UserOverviewFilters;
};

function toUserFilters(models: string[]): UserOverviewFilters {
  return { models };
}

function toUserUsageRecord(row: UsageRecordRow): UserUsageRecord {
  const { route: _route, source: _source, credentialName: _credentialName, provider: _provider, ...safeRow } = row;
  return safeRow;
}

function calculateActualTimeSpan(overview: UsageOverview, appliedDays: number) {
  if (!overview.byHour || overview.byHour.length === 0) {
    return { days: appliedDays, minutes: appliedDays * 24 * 60 };
  }

  let earliestTime: Date | null = null;
  for (const point of overview.byHour) {
    if (point.timestamp) {
      const timestamp = new Date(point.timestamp);
      if (Number.isFinite(timestamp.getTime())) {
        if (!earliestTime || timestamp < earliestTime) {
          earliestTime = timestamp;
        }
      }
    }
  }

  if (!earliestTime) {
    return { days: appliedDays, minutes: appliedDays * 24 * 60 };
  }

  const now = new Date();
  const diffMs = now.getTime() - earliestTime.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  const diffDays = Math.max(1, diffMinutes / (24 * 60));

  return { days: diffDays, minutes: diffMinutes };
}

function buildUserOverviewSummary(overview: UsageOverview, appliedDays: number): UserOverviewSummary {
  const actualTimeSpan = calculateActualTimeSpan(overview, appliedDays);
  const avgTpm = Number((overview.totalTokens / actualTimeSpan.minutes).toFixed(2));

  return {
    totalTokens: overview.totalTokens,
    totalRawInputTokens: overview.totalRawInputTokens,
    totalInputTokens: overview.totalInputTokens,
    totalOutputTokens: overview.totalOutputTokens,
    totalCachedTokens: overview.totalCachedTokens,
    estimatedCost: overview.totalCost,
    totalCost: overview.totalCost,
    avgTpm,
    requestCount: overview.totalRequests,
    totalRequests: overview.totalRequests
  };
}

function toUserModelCosts(models: UsageOverview["models"]): UserOverviewModelCost[] {
  return models.map((model) => ({ model: model.model, cost: model.cost }));
}

export async function getUserOverview(
  session: UserSession,
  daysInput?: number,
  input?: UserOverviewQueryInput
): Promise<UserOverviewResult> {
  const view = input?.view === "global" ? "global" : "self";
  const result = await getOverview(daysInput, {
    model: input?.model,
    route: view === "self" ? session.route : undefined,
    page: input?.page,
    pageSize: input?.pageSize,
    start: input?.start,
    end: input?.end,
    timezone: input?.timezone
  });

  const summary = buildUserOverviewSummary(result.overview, result.days);
  const models = toUserModelCosts(result.overview.models);

  return {
    view,
    overview: result.overview,
    summary,
    trends: {
      byDay: result.overview.byDay,
      byHour: result.overview.byHour
    },
    models,
    totalTokens: summary.totalTokens,
    totalRawInputTokens: summary.totalRawInputTokens,
    totalInputTokens: summary.totalInputTokens,
    totalOutputTokens: summary.totalOutputTokens,
    totalCachedTokens: summary.totalCachedTokens,
    estimatedCost: summary.estimatedCost,
    totalCost: summary.totalCost,
    avgTpm: summary.avgTpm,
    requestCount: summary.requestCount,
    totalRequests: summary.totalRequests,
    empty: result.empty,
    days: result.days,
    meta: result.meta,
    filters: toUserFilters(result.filters.models),
    timezone: result.timezone
  };
}

export async function getUserUsageRecords(session: UserSession, input: UserRecordsQueryInput = {}): Promise<UserRecordsResult> {
  const result = await getUsageRecords({
    limit: input.limit,
    sortKeys: input.sortKeys,
    sortField: input.sortField,
    sortOrder: input.sortOrder,
    cursor: input.cursor,
    model: input.model,
    route: session.route,
    start: input.start,
    end: input.end,
    includeFilters: input.includeFilters
  });

  return {
    items: result.items.map(toUserUsageRecord),
    nextCursor: result.nextCursor,
    filters: result.filters ? toUserFilters(result.filters.models) : undefined
  };
}
