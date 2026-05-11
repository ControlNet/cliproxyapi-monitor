function normalizeBaseUrl(raw: string | undefined) {
  const value = (raw || "").trim();
  if (!value) return "";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const trimmed = withProtocol.replace(/\/$/, "");
  return trimmed.endsWith("/v0/management") ? trimmed : `${trimmed}/v0/management`;
}

function isEnabled(raw: string | undefined) {
  return /^(1|true|yes|on)$/i.test(raw ?? "");
}

function toPositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

export type CliproxyUsageQueueSource = "auto" | "resp" | "http" | "legacy";

function normalizeUsageQueueSource(raw: string | undefined): CliproxyUsageQueueSource {
  const value = raw?.trim().toLowerCase();
  if (value === "resp" || value === "http" || value === "legacy") {
    return value;
  }
  return "auto";
}

function toServiceBaseUrl(managementUrl: string) {
  return managementUrl.replace(/\/v0\/management\/?$/, "");
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function detectSystemTimezone(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "";
  if (resolved && isValidTimezone(resolved)) {
    return resolved;
  }
  return "Asia/Shanghai";
}

const baseUrl = normalizeBaseUrl(process.env.CLIPROXY_API_BASE_URL);
const serviceBaseUrl = baseUrl ? toServiceBaseUrl(baseUrl) : "";
const password = process.env.PASSWORD || process.env.CLIPROXY_SECRET_KEY || "";
const managementKey =
  process.env.CLIPROXY_MANAGEMENT_KEY || process.env.MANAGEMENT_PASSWORD || process.env.CLIPROXY_SECRET_KEY || "";
const defaultUsageQueueTimeoutMs = process.env.NEXT_PUBLIC_SYNC_TIMEOUT_MS
  ? toPositiveInt(process.env.NEXT_PUBLIC_SYNC_TIMEOUT_MS, 15_000)
  : 15_000;
const cronSecret = process.env.CRON_SECRET || "";
const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const timezone = detectSystemTimezone();

export const config = {
  cliproxy: {
    baseUrl,
    serviceBaseUrl,
    modelsUrl: serviceBaseUrl ? `${serviceBaseUrl}/v1/models` : "",
    apiKey: process.env.CLIPROXY_SECRET_KEY || "",
    managementKey,
    usageQueue: {
      batchSize: toPositiveInt(process.env.CLIPROXY_USAGE_QUEUE_BATCH_SIZE, 100),
      source: normalizeUsageQueueSource(process.env.CLIPROXY_USAGE_QUEUE_SOURCE),
      timeoutMs: toPositiveInt(process.env.CLIPROXY_USAGE_QUEUE_TIMEOUT_MS, defaultUsageQueueTimeoutMs)
    }
  },
  postgresUrl,
  password,
  cronSecret,
  timezone,
  allowUserSeeTotalUsage: isEnabled(process.env.ALLOW_USER_SEE_TOTAL_USAGE),
  allowUserSeeQuota: isEnabled(process.env.ALLOW_USER_SEE_QUOTA)
};

export function assertEnv(options?: { requireManagementKey?: boolean }) {
  if (options?.requireManagementKey && !config.cliproxy.managementKey) {
    throw new Error("CLIPROXY_MANAGEMENT_KEY is missing. Set env var, MANAGEMENT_PASSWORD, or keep CLIPROXY_SECRET_KEY for backward compatibility.");
  }
  if (!options?.requireManagementKey && !config.cliproxy.apiKey) {
    throw new Error("CLIPROXY_SECRET_KEY is missing. Set env var or provide api-keys[0] in mounted config.yaml.");
  }
  if (!config.cliproxy.baseUrl) {
    throw new Error("CLIPROXY_API_BASE_URL is missing. Use an HTTP/HTTPS URL (for Docker: http://cli-proxy-api:8317).");
  }
  if (!config.postgresUrl) {
    throw new Error("DATABASE_URL is missing.");
  }
}
