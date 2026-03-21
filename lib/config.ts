function normalizeBaseUrl(raw: string | undefined) {
  const value = (raw || "").trim();
  if (!value) return "";
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const trimmed = withProtocol.replace(/\/$/, "");
  return trimmed.endsWith("/v0/management") ? trimmed : `${trimmed}/v0/management`;
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
const password = process.env.PASSWORD || process.env.CLIPROXY_SECRET_KEY || "";
const cronSecret = process.env.CRON_SECRET || "";
const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const timezone = detectSystemTimezone();

export const config = {
  cliproxy: {
    baseUrl,
    apiKey: process.env.CLIPROXY_SECRET_KEY || ""
  },
  postgresUrl,
  password,
  cronSecret,
  timezone
};

export function assertEnv() {
  if (!config.cliproxy.apiKey) {
    throw new Error("CLIPROXY_SECRET_KEY is missing. Set env var or provide api-keys[0] in mounted config.yaml.");
  }
  if (!config.cliproxy.baseUrl) {
    throw new Error("CLIPROXY_API_BASE_URL is missing. Use an HTTP/HTTPS URL (for Docker: http://cli-proxy-api:8317).");
  }
  if (!config.postgresUrl) {
    throw new Error("DATABASE_URL is missing.");
  }
}
