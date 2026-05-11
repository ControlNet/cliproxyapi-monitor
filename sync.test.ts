import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv: Record<string, string | undefined> = { ...process.env };
const BASE_ENV: Record<string, string | undefined> = {
  CLIPROXY_API_BASE_URL: "http://cliproxy.example/v0/management",
  CLIPROXY_SECRET_KEY: "proxy-key",
  CLIPROXY_MANAGEMENT_KEY: "management-key",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/cliproxy",
  PASSWORD: "dashboard-password"
};

const {
  fetchRespMock,
  fetchHttpMock,
  executeMock,
  selectMock,
  fromMock,
  groupByMock,
  insertUsageRowsMock,
  toAuthFileMappingsMock
} = vi.hoisted(() => ({
  fetchRespMock: vi.fn(),
  fetchHttpMock: vi.fn(),
  executeMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  groupByMock: vi.fn(),
  insertUsageRowsMock: vi.fn(),
  toAuthFileMappingsMock: vi.fn(() => [])
}));

vi.mock("@/lib/cliproxy-usage-queue", () => ({
  fetchCliproxyUsageQueueWithResp: fetchRespMock,
  fetchCliproxyUsageQueueWithHttp: fetchHttpMock
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    $client: {
      query: executeMock
    },
    select: selectMock
  }
}));

vi.mock("@/lib/db/usage-records", () => ({
  insertUsageRows: insertUsageRowsMock
}));

vi.mock("@/lib/auth-files", () => ({
  toAuthFileMappings: toAuthFileMappingsMock
}));

function replaceEnv(nextEnv: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function applyEnv(overrides: Record<string, string | undefined> = {}) {
  const nextEnv: Record<string, string | undefined> = {
    ...originalEnv,
    ...BASE_ENV,
    ...overrides
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete nextEnv[key];
    }
  }

  replaceEnv(nextEnv);
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  toAuthFileMappingsMock.mockReturnValue([]);
});

afterEach(() => {
  replaceEnv(originalEnv);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("app/api/sync queue orchestration", () => {
  it("falls back from RESP to HTTP queue to legacy usage in auto mode", async () => {
    applyEnv({ CLIPROXY_USAGE_QUEUE_SOURCE: "auto" });

    fetchRespMock.mockResolvedValueOnce({
      ok: false,
      source: "resp",
      records: [],
      warnings: [
        {
          source: "resp",
          kind: "timeout",
          code: "resp-timeout",
          message: "RESP usage queue request timed out"
        }
      ]
    });
    fetchHttpMock.mockResolvedValueOnce({
      ok: false,
      source: "http-usage-queue",
      records: [],
      warnings: [
        {
          source: "http-usage-queue",
          kind: "unsupported",
          code: "http-unsupported",
          message: "HTTP usage queue endpoint is unsupported",
          status: 404
        }
      ]
    });

    executeMock
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    selectMock.mockReturnValueOnce({ from: fromMock });
    fromMock.mockReturnValueOnce({ groupBy: groupByMock });
    groupByMock.mockResolvedValueOnce([
      {
        route: "/v1/chat/completions",
        model: "gpt-4.1",
        source: "dashboard",
        latestOccurredAt: new Date("2026-05-10T12:20:00.000Z")
      }
    ]);
    insertUsageRowsMock.mockResolvedValueOnce(1);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth-files")) {
        return jsonResponse([]);
      }

      if (url.endsWith("/usage")) {
        return jsonResponse({
          usage: {
            apis: {
              "/v1/chat/completions": {
                models: {
                  "gpt-4.1": {
                    details: [
                      {
                        timestamp: "2026-05-10T12:00:00.000Z",
                        source: "dashboard",
                        total_tokens: 10,
                        input_tokens: 6,
                        output_tokens: 4
                      },
                      {
                        timestamp: "2026-05-10T12:25:00.000Z",
                        source: "dashboard",
                        total_tokens: 12,
                        input_tokens: 7,
                        output_tokens: 5
                      }
                    ]
                  }
                }
              }
            }
          }
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(new Request("http://localhost/api/sync", {
      headers: { authorization: "Bearer dashboard-password" }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      source: "legacy-usage",
      attempted: 2,
      insertAttempted: 1,
      inserted: 1,
      filteredOut: 1,
      authFilesSynced: 0,
      fullSync: false,
      lookbackMinutes: 20
    });
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "resp", code: "resp-timeout" }),
        expect.objectContaining({ source: "http-usage-queue", code: "http-unsupported" })
      ])
    );
    expect(fetchRespMock).toHaveBeenCalledTimes(1);
    expect(fetchHttpMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://cliproxy.example/v0/management/auth-files",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer management-key",
          "Content-Type": "application/json"
        },
        cache: "no-store"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://cliproxy.example/v0/management/usage",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer management-key",
          "Content-Type": "application/json"
        },
        cache: "no-store"
      })
    );
  });

  it("falls back from RESP to HTTP queue and stops before legacy usage when HTTP succeeds", async () => {
    const apiKeyField = "api_key";
    const queueApiKey = "sk-fixture-http";
    applyEnv({ CLIPROXY_USAGE_QUEUE_SOURCE: "auto" });

    fetchRespMock.mockResolvedValueOnce({
      ok: false,
      source: "resp",
      records: [],
      warnings: [
        {
          source: "resp",
          kind: "timeout",
          code: "resp-timeout",
          message: "RESP usage queue request timed out"
        }
      ]
    });
    fetchHttpMock.mockResolvedValueOnce({
      ok: true,
      source: "http-usage-queue",
      records: [
        {
          timestamp: "2026-05-10T12:30:00.000Z",
          endpoint: "/v1/responses",
          model: "gpt-4.1-mini",
          source: "dashboard",
          input_tokens: 7,
          output_tokens: 5,
          total_tokens: 12,
          request_id: "req-http-1",
          [apiKeyField]: queueApiKey
        }
      ],
      warnings: []
    });

    executeMock
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    insertUsageRowsMock.mockResolvedValueOnce(1);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth-files")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(new Request("http://localhost/api/sync", {
      headers: { authorization: "Bearer dashboard-password" }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      source: "http-usage-queue",
      attempted: 1,
      insertAttempted: 1,
      inserted: 1,
      filteredOut: 0,
      authFilesSynced: 0,
      fullSync: false
    });
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "resp", code: "resp-timeout" })
    ]));
    expect(fetchRespMock).toHaveBeenCalledTimes(1);
    expect(fetchHttpMock).toHaveBeenCalledTimes(1);
    expect(insertUsageRowsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        route: queueApiKey,
        model: "gpt-4.1-mini",
        source: "dashboard",
        requestId: "req-http-1",
        totalTokens: 12,
        inputTokens: 7,
        outputTokens: 5,
        isError: false,
        raw: expect.stringContaining('"api_key":"[REDACTED]"')
      })
    ], 153);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cliproxy.example/v0/management/auth-files",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer management-key",
          "Content-Type": "application/json"
        },
        cache: "no-store"
      })
    );
  });

  it("returns 409 before any queue pop when the advisory lock is already held", async () => {
    applyEnv({ CLIPROXY_USAGE_QUEUE_SOURCE: "auto" });

    executeMock.mockResolvedValueOnce({ rows: [{ locked: false }] });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(new Request("http://localhost/api/sync", {
      headers: { authorization: "Bearer dashboard-password" }
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "sync already running" });
    expect(fetchRespMock).not.toHaveBeenCalled();
    expect(fetchHttpMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fall back to HTTP queue or legacy usage when RESP mode fails explicitly", async () => {
    applyEnv({ CLIPROXY_USAGE_QUEUE_SOURCE: "resp" });

    fetchRespMock.mockResolvedValueOnce({
      ok: false,
      source: "resp",
      records: [],
      warnings: [
        {
          source: "resp",
          kind: "protocol",
          code: "resp-connection-error",
          message: "RESP usage queue connection failed"
        }
      ]
    });
    executeMock
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth-files")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(new Request("http://localhost/api/sync", {
      headers: { authorization: "Bearer dashboard-password" }
    }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Failed to fetch usage queue",
      source: "resp",
      attempted: 0,
      insertAttempted: 0,
      inserted: 0,
      filteredOut: 0,
      authFilesSynced: 0,
      fullSync: false
    });
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "resp", code: "resp-connection-error" })
    ]));
    expect(fetchRespMock).toHaveBeenCalledTimes(1);
    expect(fetchHttpMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats empty queue reads as successful no-data syncs with the selected source", async () => {
    applyEnv({ CLIPROXY_USAGE_QUEUE_SOURCE: "resp" });

    fetchRespMock.mockResolvedValueOnce({
      ok: true,
      source: "resp",
      records: [],
      warnings: []
    });
    executeMock
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth-files")) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sync/route");
    const response = await GET(new Request("http://localhost/api/sync", {
      headers: { authorization: "Bearer dashboard-password" }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      source: "resp",
      inserted: 0,
      message: "No usage data",
      authFilesSynced: 0,
      attempted: 0,
      insertAttempted: 0,
      filteredOut: 0,
      warnings: [],
      fullSync: false
    });
    expect(fetchRespMock).toHaveBeenCalledTimes(1);
    expect(fetchHttpMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
