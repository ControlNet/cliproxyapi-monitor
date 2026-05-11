import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv: Record<string, string | undefined> = { ...process.env };
const BASE_ENV: Record<string, string | undefined> = {
  CLIPROXY_API_BASE_URL: "http://cliproxy.example/v0/management",
  CLIPROXY_SECRET_KEY: "proxy-key",
  CLIPROXY_MANAGEMENT_KEY: "management-key",
  CLIPROXY_USAGE_QUEUE_SOURCE: "legacy",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/cliproxy",
  PASSWORD: "dashboard-password"
};

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

afterEach(() => {
  replaceEnv(originalEnv);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("@/lib/admin-auth");
  vi.unmock("@/lib/auth-files");
  vi.unmock("@/lib/usage");
  vi.unmock("@/lib/db/client");
});

describe("management credential boundaries", () => {
  it("uses the management key for /api/logs upstream fetches", async () => {
    applyEnv();

    vi.doMock("@/lib/admin-auth", () => ({
      requireAdminRequest: vi.fn(async () => null)
    }));

    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/logs/route");
    const response = await GET(new Request("http://localhost/api/logs?after=cursor-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cliproxy.example/v0/management/logs?after=cursor-1",
      expect.objectContaining({
        headers: { Authorization: "Bearer management-key" },
        cache: "no-store"
      })
    );
  });

  it("returns a management-key error before calling upstream management routes", async () => {
    applyEnv({
      CLIPROXY_SECRET_KEY: undefined,
      CLIPROXY_MANAGEMENT_KEY: undefined,
      MANAGEMENT_PASSWORD: undefined
    });

    vi.doMock("@/lib/admin-auth", () => ({
      requireAdminRequest: vi.fn(async () => null)
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/logs/route");
    const response = await GET(new Request("http://localhost/api/logs"));
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      error: "CLIPROXY_MANAGEMENT_KEY is missing. Set env var, MANAGEMENT_PASSWORD, or keep CLIPROXY_SECRET_KEY for backward compatibility."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the management key for sync usage and auth-files fetches", async () => {
    applyEnv();

    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });

    vi.doMock("@/lib/db/client", () => ({
      db: {
        $client: {
          query: execute
        },
        select: vi.fn()
      }
    }));

    vi.doMock("@/lib/auth-files", () => ({
      toAuthFileMappings: vi.fn(() => [])
    }));
    vi.doMock("@/lib/usage", () => ({
      parseUsagePayload: vi.fn((payload: unknown) => payload),
      toUsageRecords: vi.fn(() => [])
    }));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/usage")) {
        return jsonResponse({ apis: [] });
      }

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
      source: "legacy-usage",
      inserted: 0,
      authFilesSynced: 0,
      warnings: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("uses the management key for quota auth-files and api-call helpers", async () => {
    applyEnv();

    const limit = vi.fn(async () => [{ authIndex: "auth-1", provider: "kimi" }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ leftJoin }));
    const select = vi.fn(() => ({ from }));

    vi.doMock("@/lib/db/client", () => ({
      db: { select }
    }));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth-files")) {
        return jsonResponse([{ auth_index: "auth-1", provider: "kimi" }]);
      }

      if (url.endsWith("/api-call")) {
        return jsonResponse({
          status_code: 200,
          body: { limits: [] }
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getUserQuota } = await import("@/lib/user-quota");
    const result = await getUserQuota({ route: "route-a" } as never);

    expect(result.enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      "http://cliproxy.example/v0/management/api-call",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer management-key",
          "Content-Type": "application/json"
        },
        cache: "no-store"
      })
    );
  });

  it("keeps /v1/models validation on the provided bearer token", async () => {
    applyEnv({ PASSWORD: "admin-password" });

    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/verify/route");
    const authorization = `Basic ${Buffer.from("user:user-route-token").toString("base64")}`;
    const response = await POST(new NextRequest("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { authorization }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, role: "user", redirectTo: "/user" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cliproxy.example/v1/models",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer user-route-token",
          Accept: "application/json"
        },
        cache: "no-store"
      })
    );
  });
});
