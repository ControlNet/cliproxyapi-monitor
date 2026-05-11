import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageRecords } from "@/lib/db/schema";
import { insertUsageRows } from "@/lib/db/usage-records";

type UsageRow = typeof usageRecords.$inferInsert;

const { insertMock, valuesMock, onConflictDoNothingMock, returningMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  onConflictDoNothingMock: vi.fn(),
  returningMock: vi.fn()
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    insert: insertMock
  }
}));

function createUsageRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    syncedAt: new Date("2026-01-01T00:05:00.000Z"),
    route: "/v1/chat/completions",
    source: "",
    authIndex: null,
    requestId: null,
    model: "gpt-4.1",
    totalTokens: 10,
    inputTokens: 6,
    outputTokens: 4,
    reasoningTokens: 0,
    cachedTokens: 0,
    isError: false,
    raw: "{}",
    ...overrides
  };
}

describe("lib/db/usage-records", () => {
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockImplementation(() => ({ values: valuesMock }));
    valuesMock.mockImplementation(() => ({ onConflictDoNothing: onConflictDoNothingMock }));
    onConflictDoNothingMock.mockImplementation(() => ({ returning: returningMock }));
  });

  afterEach(() => {
    consoleWarnSpy.mockClear();
  });

  it("uses targetless conflict handling so duplicate request IDs can be ignored safely", async () => {
    const rows = [
      createUsageRow({ requestId: "req-123" }),
      createUsageRow({
        occurredAt: new Date("2026-01-01T00:00:01.000Z"),
        requestId: "req-123"
      })
    ];

    returningMock.mockResolvedValueOnce([{ id: 1 }]);

    await expect(insertUsageRows(rows, 100)).resolves.toBe(1);

    expect(valuesMock).toHaveBeenCalledWith(rows);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    expect(onConflictDoNothingMock).toHaveBeenCalledWith();
  });

  it("keeps the bind-error batch retry behavior after request ID dedupe changes", async () => {
    const bindError = Object.assign(new Error("bind message has 65535 parameters"), { code: "08P01" });
    const rows = [
      createUsageRow({ requestId: "req-left" }),
      createUsageRow({
        occurredAt: new Date("2026-01-01T00:00:02.000Z"),
        requestId: "req-right"
      })
    ];

    returningMock
      .mockRejectedValueOnce(bindError)
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);

    await expect(insertUsageRows(rows, 100)).resolves.toBe(2);

    expect(returningMock).toHaveBeenCalledTimes(3);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(3);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});
