import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "ALLOW_USER_SEE_QUOTA",
  "ALLOW_USER_SEE_TOTAL_USAGE",
  "CLIPROXY_API_BASE_URL",
  "CLIPROXY_USAGE_QUEUE_BATCH_SIZE",
  "CLIPROXY_MANAGEMENT_KEY",
  "CLIPROXY_USAGE_QUEUE_SOURCE",
  "CLIPROXY_USAGE_QUEUE_TIMEOUT_MS",
  "CLIPROXY_SECRET_KEY",
  "CRON_SECRET",
  "DATABASE_URL",
  "MANAGEMENT_PASSWORD",
  "NEXT_PUBLIC_SYNC_TIMEOUT_MS",
  "PASSWORD",
  "POSTGRES_URL"
] as const;

function resetEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

async function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  resetEnv();
  Object.assign(process.env, env);
  vi.resetModules();
  return import("./config");
}

afterEach(() => {
  resetEnv();
  vi.resetModules();
});

describe("lib/config", () => {
  it("prefers explicit management env vars over the legacy fallback", async () => {
    const { config, assertEnv } = await loadConfig({
      CLIPROXY_API_BASE_URL: "https://api.example.com/",
      CLIPROXY_MANAGEMENT_KEY: "mgmt-explicit",
      CLIPROXY_USAGE_QUEUE_BATCH_SIZE: "250",
      CLIPROXY_USAGE_QUEUE_SOURCE: "resp",
      CLIPROXY_USAGE_QUEUE_TIMEOUT_MS: "12345",
      MANAGEMENT_PASSWORD: "mgmt-env",
      CLIPROXY_SECRET_KEY: "proxy-secret",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app"
    });

    expect(config.cliproxy.managementKey).toBe("mgmt-explicit");
    expect(config.cliproxy.apiKey).toBe("proxy-secret");
    expect(config.cliproxy.baseUrl).toBe("https://api.example.com/v0/management");
    expect(config.cliproxy.serviceBaseUrl).toBe("https://api.example.com");
    expect(config.cliproxy.modelsUrl).toBe("https://api.example.com/v1/models");
    expect(config.cliproxy.usageQueue).toEqual({
      batchSize: 250,
      source: "resp",
      timeoutMs: 12345
    });
    expect(() => assertEnv({ requireManagementKey: true })).not.toThrow();
  });

  it("falls back to MANAGEMENT_PASSWORD before CLIPROXY_SECRET_KEY", async () => {
    const { config, assertEnv } = await loadConfig({
      CLIPROXY_API_BASE_URL: "http://api.example.com",
      MANAGEMENT_PASSWORD: "mgmt-env",
      CLIPROXY_SECRET_KEY: "proxy-secret",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app"
    });

    expect(config.cliproxy.managementKey).toBe("mgmt-env");
    expect(config.cliproxy.apiKey).toBe("proxy-secret");
    expect(() => assertEnv({ requireManagementKey: true })).not.toThrow();
  });

  it("keeps the legacy proxy key as the last management fallback", async () => {
    const { config } = await loadConfig({
      CLIPROXY_API_BASE_URL: "http://api.example.com",
      CLIPROXY_SECRET_KEY: "proxy-secret",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app"
    });

    expect(config.cliproxy.managementKey).toBe("proxy-secret");
  });

  it("defaults queue env tunables safely and derives timeout from sync timeout when set", async () => {
    const { config: explicitSyncTimeout } = await loadConfig({
      CLIPROXY_API_BASE_URL: "http://api.example.com",
      CLIPROXY_SECRET_KEY: "proxy-secret",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app",
      NEXT_PUBLIC_SYNC_TIMEOUT_MS: "45000"
    });

    expect(explicitSyncTimeout.cliproxy.usageQueue).toEqual({
      batchSize: 100,
      source: "auto",
      timeoutMs: 45000
    });

    const { config: defaults } = await loadConfig({
      CLIPROXY_API_BASE_URL: "http://api.example.com",
      CLIPROXY_SECRET_KEY: "proxy-secret",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app",
      CLIPROXY_USAGE_QUEUE_BATCH_SIZE: "0",
      CLIPROXY_USAGE_QUEUE_SOURCE: "invalid",
      CLIPROXY_USAGE_QUEUE_TIMEOUT_MS: "-1"
    });

    expect(defaults.cliproxy.usageQueue).toEqual({
      batchSize: 100,
      source: "auto",
      timeoutMs: 15000
    });
  });
});

describe("scripts/start-dashboard.sh", () => {
  it("only propagates an explicit management password and does not parse hashed YAML secrets", () => {
    const script = readFileSync(new URL("../scripts/start-dashboard.sh", import.meta.url), "utf8");

    expect(script).toContain('export CLIPROXY_MANAGEMENT_KEY="$MANAGEMENT_PASSWORD"');
    expect(script).not.toContain("remote-management.secret-key");
    expect(script).not.toMatch(/CLIPROXY_MANAGEMENT_KEY.*extract_/);
  });
});
