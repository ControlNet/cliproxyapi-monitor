import { describe, expect, it, vi } from "vitest";
import type { UsageOverview } from "@/lib/types";

vi.mock("@/lib/queries/overview", () => ({
  getOverview: vi.fn(async () => ({
    overview: {
      totalRequests: 2,
      totalTokens: 150,
      totalRawInputTokens: 100,
      totalInputTokens: 60,
      totalOutputTokens: 50,
      totalReasoningTokens: 0,
      totalCachedTokens: 40,
      successCount: 2,
      failureCount: 0,
      successRate: 1,
      totalCost: 0.001,
      models: [
        { model: "expensive", requests: 1, tokens: 100, inputTokens: 60, outputTokens: 40, cost: 0.2 },
        { model: "cheap", requests: 1, tokens: 50, inputTokens: 0, outputTokens: 10, cost: 0.01 }
      ],
      byDay: [],
      byHour: []
    } satisfies UsageOverview,
    empty: false,
    days: 7,
    meta: { page: 1, pageSize: 10, totalModels: 0, totalPages: 0 },
    filters: { models: [], routes: [], sources: [], names: [] },
    timezone: "Asia/Shanghai"
  }))
}));

describe("getUserOverview", () => {
  it("exposes admin-compatible token breakdown with regular input semantics", async () => {
    const { getUserOverview } = await import("@/lib/queries/user-safe");

    const result = await getUserOverview({ route: "sk-user" }, 7);

    expect(result.totalTokens).toBe(150);
    expect(result.totalRawInputTokens).toBe(100);
    expect(result.totalInputTokens).toBe(60);
    expect(result.totalCachedTokens).toBe(40);
    expect(result.totalOutputTokens).toBe(50);
  });

  it("exposes model cost aggregates for user dashboard cost breakdown", async () => {
    const { getUserOverview } = await import("@/lib/queries/user-safe");

    const result = await getUserOverview({ route: "sk-user" }, 7);

    expect(result.models).toEqual([
      { model: "expensive", cost: 0.2 },
      { model: "cheap", cost: 0.01 }
    ]);
  });
});
