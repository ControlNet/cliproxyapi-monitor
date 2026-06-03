import { describe, expect, it } from "vitest";
import { buildEstimatedCostStats, buildUserTokenStats } from "@/app/user/page";

describe("buildUserTokenStats", () => {
  it("formats regular input, cached input, output, and cache rate", () => {
    expect(buildUserTokenStats({
      totalRawInputTokens: 100,
      totalInputTokens: 60,
      totalCachedTokens: 40,
      totalOutputTokens: 50
    })).toEqual([
      { label: "Input", value: "60", tone: "input" },
      { label: "Cache Input", value: "40", tone: "cached" },
      { label: "Output", value: "50", tone: "output" },
      { label: "Cache Rate", value: "40.00%", tone: "rate" }
    ]);
  });

  it("uses 0.00% cache rate when raw input is zero", () => {
    const stats = buildUserTokenStats({
      totalRawInputTokens: 0,
      totalInputTokens: 0,
      totalCachedTokens: 0,
      totalOutputTokens: 0
    });

    expect(stats[3]).toEqual({ label: "Cache Rate", value: "0.00%", tone: "rate" });
  });
});

describe("buildEstimatedCostStats", () => {
  it("formats the top 4 models by cost", () => {
    expect(buildEstimatedCostStats([
      { model: "cheap-model", cost: 0.01 },
      { model: "top-model", cost: 0.45 },
      { model: "third-model", cost: 0.12 },
      { model: "fourth-model", cost: 0.08 },
      { model: "second-model", cost: 0.2 }
    ])).toEqual([
      { label: "top-model", value: "$0.45" },
      { label: "second-model", value: "$0.20" },
      { label: "third-model", value: "$0.12" },
      { label: "fourth-model", value: "$0.08" }
    ]);
  });

  it("returns only available cost models", () => {
    expect(buildEstimatedCostStats([{ model: "only-model", cost: 0 }])).toEqual([
      { label: "only-model", value: "$0.00" }
    ]);
  });
});
