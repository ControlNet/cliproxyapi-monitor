import { describe, expect, it } from "vitest";

import { parseUsageQueuePayload, redactUsageQueueRaw, toUsageRecordsFromQueueEvents } from "@/lib/usage";

describe("lib/usage queue parsing", () => {
  it("maps HTTP queue events into usage record rows with request ids and provided totals", () => {
    const apiKeyField = "api_key";
    const sampleApiKey = "sk-fixture-alpha";
    const pulledAt = new Date("2026-05-11T03:00:00.000Z");
    const parsed = parseUsageQueuePayload([
      {
        timestamp: "2026-05-10T12:34:56.000Z",
        endpoint: " /v1/chat/completions ",
        model: "gpt-4.1",
        source: " dashboard ",
        auth_index: 7,
        input_tokens: 10,
        output_tokens: 5,
        reasoning_tokens: 2,
        cached_tokens: 1,
        total_tokens: 99,
        failed: false,
        request_id: "req-123",
        [apiKeyField]: sampleApiKey
      }
    ]);

    expect(parsed.warnings).toEqual([]);

    const [row] = toUsageRecordsFromQueueEvents(parsed.events, pulledAt);
    expect(row).toMatchObject({
      syncedAt: pulledAt,
      route: sampleApiKey,
      model: "gpt-4.1",
      source: "dashboard",
      authIndex: "7",
      requestId: "req-123",
      totalTokens: 99,
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 2,
      cachedTokens: 1,
      isError: false
    });
    expect(row.occurredAt).toEqual(new Date("2026-05-10T12:34:56.000Z"));
    expect(row.raw).toContain('"api_key":"[REDACTED]"');
    expect(row.raw).not.toContain(sampleApiKey);
  });

  it("never stores endpoint in route when queue events do not include api_key", () => {
    const pulledAt = new Date("2026-05-11T03:00:00.000Z");
    const parsed = parseUsageQueuePayload([
      {
        timestamp: "2026-05-10T12:34:56.000Z",
        endpoint: " /v1/chat/completions ",
        model: "gpt-4.1",
        source: " dashboard "
      }
    ]);

    expect(parsed.warnings).toEqual([]);

    const [row] = toUsageRecordsFromQueueEvents(parsed.events, pulledAt);
    expect(row?.route).toBe("");
  });

  it("accepts RESP single strings and returns empty rows for empty queues", () => {
    const apiKeyField = "api_key";
    const sampleApiKey = "resp-fixture-alpha";
    const pulledAt = new Date("2026-05-11T03:00:00.000Z");

    expect(parseUsageQueuePayload([])).toEqual({ events: [], warnings: [] });
    expect(parseUsageQueuePayload(null)).toEqual({ events: [], warnings: [] });

    const parsed = parseUsageQueuePayload(JSON.stringify({
      alias: "claude-3.7-sonnet",
      tokens: { input_tokens: 4, output_tokens: 6 },
      [apiKeyField]: sampleApiKey
    }));

    expect(parsed.warnings).toEqual([]);
    expect(parsed.events).toHaveLength(1);

    const [row] = toUsageRecordsFromQueueEvents(parsed.events, pulledAt);
    expect(row).toMatchObject({
      route: sampleApiKey,
      model: "claude-3.7-sonnet",
      source: "",
      authIndex: null,
      requestId: null,
      totalTokens: 10,
      inputTokens: 4,
      outputTokens: 6,
      reasoningTokens: 0,
      cachedTokens: 0,
      isError: false,
      occurredAt: pulledAt,
      syncedAt: pulledAt
    });
    expect(row.raw).toContain('"api_key":"[REDACTED]"');
    expect(row.raw).not.toContain(sampleApiKey);
  });

  it("skips malformed JSON siblings without failing valid queue items", () => {
    const pulledAt = new Date("2026-05-11T03:00:00.000Z");
    const parsed = parseUsageQueuePayload([
      '{"endpoint":"/v1/messages","alias":"alias-model","tokens":{"input_tokens":8,"output_tokens":3,"reasoning_tokens":1},"request_id":"req-valid"}',
      '{"endpoint":"broken"',
      42
    ]);

    expect(parsed.events).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings[0]).toMatchObject({ index: 1, reason: "invalid-json" });
    expect(parsed.warnings[1]).toMatchObject({ index: 2, reason: "invalid-event" });

    const [row] = toUsageRecordsFromQueueEvents(parsed.events, pulledAt);
    expect(row).toMatchObject({
      route: "",
      model: "alias-model",
      requestId: "req-valid",
      totalTokens: 12,
      inputTokens: 8,
      outputTokens: 3,
      reasoningTokens: 1
    });
  });

  it("applies queue defaults for missing fields, invalid timestamps, and failures", () => {
    const pulledAt = new Date("2026-05-11T03:00:00.000Z");
    const parsed = parseUsageQueuePayload([
      {
        timestamp: "not-a-date",
        endpoint: "   ",
        source: undefined,
        auth_index: " auth-9 ",
        failed: true
      }
    ]);

    expect(parsed.warnings).toEqual([]);

    const [row] = toUsageRecordsFromQueueEvents(parsed.events, pulledAt);
    expect(row).toMatchObject({
      occurredAt: pulledAt,
      syncedAt: pulledAt,
      route: "",
      model: "unknown",
      source: "",
      authIndex: "auth-9",
      requestId: null,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      isError: true
    });
  });

  it("redacts nested api_key values before serializing raw payloads", () => {
    const apiKeyField = "api_key";
    const outerApiKey = "fixture-top-alpha";
    const nestedApiKey = "fixture-nested-alpha";
    const raw = redactUsageQueueRaw({
      [apiKeyField]: outerApiKey,
      nested: {
        [apiKeyField]: nestedApiKey,
        safe: true
      }
    });

    expect(raw).toContain('"api_key":"[REDACTED]"');
    expect(raw).not.toContain(outerApiKey);
    expect(raw).not.toContain(nestedApiKey);
  });

  it("redacts obvious bearer-like credential keys case-insensitively in nested objects and arrays", () => {
    const authorizationField = "Authorization";
    const accessTokenField = "access_token";
    const idTokenField = "id_token";
    const refreshTokenField = "refreshToken";
    const bearerValueField = "bearer_value";
    const authorizationValue = "Bearer fixture-top-alpha";
    const accessTokenValue = "access-fixture-alpha";
    const refreshTokenValue = "refresh-fixture-alpha";
    const idTokenValue = "id-fixture-alpha";
    const nestedBearerValue = "nested-bearer-alpha";
    const raw = redactUsageQueueRaw({
      [authorizationField]: authorizationValue,
      nested: {
        [accessTokenField]: accessTokenValue,
        [refreshTokenField]: refreshTokenValue,
        tokens: [
          { [idTokenField]: idTokenValue },
          { [bearerValueField]: nestedBearerValue }
        ]
      },
      safe: {
        auth_index: 7,
        source: "dashboard"
      }
    });

    expect(raw).toContain('"Authorization":"[REDACTED]"');
    expect(raw).toContain('"access_token":"[REDACTED]"');
    expect(raw).toContain('"refreshToken":"[REDACTED]"');
    expect(raw).toContain('"id_token":"[REDACTED]"');
    expect(raw).toContain('"bearer_value":"[REDACTED]"');
    expect(raw).toContain('"auth_index":7');
    expect(raw).toContain('"source":"dashboard"');
    expect(raw).not.toContain(authorizationValue);
    expect(raw).not.toContain(accessTokenValue);
    expect(raw).not.toContain(refreshTokenValue);
    expect(raw).not.toContain(idTokenValue);
    expect(raw).not.toContain(nestedBearerValue);
  });
});
