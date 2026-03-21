import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const PG_SSL_QUERY_KEYS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslaccept",
  "uselibpqcompat"
];

function parseIntEnv(name: string, fallback: number, min = 0) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min) return fallback;
  return value;
}

function normalizeEnvMultiline(value: string) {
  let normalized = value.trim();
  if (
    (normalized.startsWith("\"") && normalized.endsWith("\"")) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\\n/g, "\n");
}

function stripPgSslParams(urlString: string) {
  try {
    const url = new URL(urlString);
    for (const key of PG_SSL_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

function getSslOptions() {
  const ca = process.env.DATABASE_CA;
  if (!ca) return undefined;

  const normalized = normalizeEnvMultiline(ca);
  if (normalized.includes("-----BEGIN CERTIFICATE-----")) {
    return { ca: normalized, rejectUnauthorized: true as const };
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  const pem = normalizeEnvMultiline(decoded);
  return { ca: pem, rejectUnauthorized: true as const };
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sslOptions = getSslOptions();
const pgConnectionString = sslOptions
  ? stripPgSslParams(connectionString)
  : connectionString;

const pool = new Pool({
  connectionString: pgConnectionString,
  ssl: sslOptions,
  max: parseIntEnv("DATABASE_POOL_MAX", 5, 1),
  idleTimeoutMillis: parseIntEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 10_000, 0),
  connectionTimeoutMillis: parseIntEnv("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 5_000, 0),
  maxUses: parseIntEnv("DATABASE_POOL_MAX_USES", 7_500, 0)
});

export const db = drizzle(pool);
