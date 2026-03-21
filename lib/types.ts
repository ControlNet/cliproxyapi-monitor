export type ModelPrice = {
  model: string;
  inputPricePer1M: number;
  cachedInputPricePer1M: number;
  outputPricePer1M: number;
};

export type ModelUsage = {
  model: string;
  requests: number;
  tokens: number;
  /** Regular input tokens: net input minus cached, clamped to zero. */
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

export type UsageSeriesPoint = {
  label: string;
  requests: number;
  errors?: number;
  tokens: number;
  cost?: number;
  /** Regular input tokens (input minus cached, clamped). */
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  timestamp?: string;
};

export type UsageOverview = {
  totalRequests: number;
  totalTokens: number;
  totalRawInputTokens: number;
  /** Regular input tokens over the overview (input minus cached, clamped). */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCachedTokens: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  totalCost: number;
  models: ModelUsage[];
  byDay: UsageSeriesPoint[];
  byHour: UsageSeriesPoint[];
};
