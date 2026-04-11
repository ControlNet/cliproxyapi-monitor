import { and, desc, eq, isNotNull } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { authFileMappings, usageRecords } from "@/lib/db/schema";
import type { UserSession } from "@/lib/user-session";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const GEMINI_CLI_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GEMINI_CLI_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";

const CLAUDE_WINDOW_LABELS = [
  { key: "five_hour", label: "5 小时窗口" },
  { key: "seven_day", label: "7 天窗口" },
  { key: "seven_day_oauth_apps", label: "7 天 OAuth Apps" },
  { key: "seven_day_opus", label: "7 天 Opus" },
  { key: "seven_day_sonnet", label: "7 天 Sonnet" },
  { key: "seven_day_cowork", label: "7 天 Cowork" },
  { key: "iguana_necktie", label: "Iguana Necktie" }
] as const;

const CODEX_FIVE_HOUR_SECONDS = 18_000;
const CODEX_WEEK_SECONDS = 604_800;
const GEMINI_CLI_G1_CREDIT_TYPE = "GOOGLE_ONE_AI";
const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  "free-tier": "免费层级",
  "legacy-tier": "Legacy 层级",
  "standard-tier": "标准层级",
  "g1-pro-tier": "Pro 层级",
  "g1-ultra-tier": "Ultra 层级"
};

export type UserQuotaStatusTone = "neutral" | "ok" | "warning" | "error";

export type UserQuotaItem = {
  id: string;
  label: string;
  remainingRatio: number | null;
  remainingLabel: string | null;
  usedLabel: string | null;
  resetLabel: string | null;
};

export type UserQuotaAccountWindow = {
  id: string;
  label: string;
  remainingRatio: number | null;
  remainingLabel: string | null;
  resetLabel: string | null;
};

export type UserQuotaAccount = {
  id: string;
  planLabel: string | null;
  windows: UserQuotaAccountWindow[];
};

export type UserQuotaResponse = {
  enabled: true;
  available: boolean;
  providerLabel: string | null;
  groupLabel: string | null;
  planLabel: string | null;
  creditSummary: string | null;
  items: UserQuotaItem[];
  status: {
    tone: UserQuotaStatusTone;
    title: string;
    description: string | null;
  };
  accounts: UserQuotaAccount[];
  refreshedAt: string;
};

type RawAuthFileItem = Record<string, unknown> & {
  auth_index?: unknown;
  authIndex?: unknown;
  index?: unknown;
  id?: unknown;
  provider?: unknown;
  type?: unknown;
  account?: unknown;
  metadata?: unknown;
  attributes?: unknown;
  id_token?: unknown;
  plan_type?: unknown;
  planType?: unknown;
  disabled?: unknown;
  runtime_only?: unknown;
  runtimeOnly?: unknown;
};

type ApiCallEnvelope = {
  statusCode: number;
  body: unknown;
  bodyText: string;
};

type UserAuthContext = {
  authIndex: string;
  provider: string | null;
};

type CodexUsageWindow = {
  used_percent?: unknown;
  usedPercent?: unknown;
  limit_window_seconds?: unknown;
  limitWindowSeconds?: unknown;
  reset_after_seconds?: unknown;
  resetAfterSeconds?: unknown;
  reset_at?: unknown;
  resetAt?: unknown;
};

type CodexRateLimitInfo = {
  allowed?: unknown;
  limit_reached?: unknown;
  limitReached?: unknown;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "y"].includes(trimmed)) return true;
    if (["0", "false", "no", "off", "n"].includes(trimmed)) return false;
  }
  return null;
}

function normalizeAuthIndex(value: unknown): string | null {
  return normalizeString(value);
}

function parseJsonValue<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "object") {
    return value as T;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  const directKeys = ["files", "auth_files", "authFiles", "items", "list", "records"];

  for (const key of directKeys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }

  const nestedKeys = ["data", "result", "payload"];
  for (const nestedKey of nestedKeys) {
    const nested = obj[nestedKey];
    if (Array.isArray(nested)) return nested;
    if (!nested || typeof nested !== "object") continue;
    const nestedObj = nested as Record<string, unknown>;
    for (const key of directKeys) {
      const value = nestedObj[key];
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

function parseApiCallEnvelope(payload: unknown): ApiCallEnvelope {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const statusCode = normalizeNumber(obj.status_code ?? obj.statusCode) ?? 500;
  const bodyValue = obj.body ?? null;
  const bodyText = typeof obj.bodyText === "string"
    ? obj.bodyText
    : typeof bodyValue === "string"
      ? bodyValue
      : "";

  return {
    statusCode,
    body: bodyValue,
    bodyText
  };
}

function managementHeaders() {
  return {
    Authorization: `Bearer ${config.cliproxy.apiKey}`,
    "Content-Type": "application/json"
  };
}

function clampRatio(value: number | null) {
  if (value === null) return null;
  return Math.max(0, Math.min(1, value));
}

function formatPercentLabel(ratio: number | null) {
  if (ratio === null) return null;
  return `${Math.round(ratio * 100)}%`;
}

function formatCurrencyLabel(amount: number | null, digits = 2) {
  if (amount === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(amount);
}

function formatCountLabel(amount: number | null) {
  if (amount === null) return null;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(amount);
}

function formatDateLabel(value: Date) {
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  if (safeSeconds < 60) return `${safeSeconds} 秒后重置`;
  const totalMinutes = Math.floor(safeSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟后重置`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 48) return `${totalHours} 小时后重置`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays} 天后重置`;
}

function formatResetLabel(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 365 * 24 * 60 * 60) {
      return formatDurationLabel(value);
    }

    const epochMs = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(epochMs);
    return Number.isFinite(date.getTime()) ? formatDateLabel(date) : null;
  }

  const text = normalizeString(value);
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^\d+$/.test(text)) {
    return formatResetLabel(numeric);
  }

  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? formatDateLabel(date) : text;
}

function titleCaseProvider(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function toProviderKey(rawFile: RawAuthFileItem, fallbackProvider: string | null) {
  const value = normalizeString(rawFile.provider ?? rawFile.type ?? fallbackProvider);
  return value ? value.toLowerCase() : null;
}

function toProviderLabel(provider: string | null) {
  if (!provider) return null;
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  if (provider === "gemini-cli") return "Gemini CLI";
  if (provider === "kimi") return "Kimi";
  if (provider === "antigravity") return "Antigravity";
  return titleCaseProvider(provider);
}

function createQuotaResponse(input: Omit<UserQuotaResponse, "enabled" | "refreshedAt">): UserQuotaResponse {
  return {
    enabled: true,
    refreshedAt: nowIso(),
    ...input
  };
}

export function createUnavailableUserQuotaResponse(input: {
  providerLabel?: string | null;
  groupLabel?: string | null;
  title: string;
  description: string;
  tone?: UserQuotaStatusTone;
}): UserQuotaResponse {
  return createQuotaResponse({
    available: false,
    providerLabel: input.providerLabel ?? null,
    groupLabel: input.groupLabel ?? null,
    planLabel: null,
    creditSummary: null,
    items: [],
    accounts: [],
    status: {
      tone: input.tone ?? "neutral",
      title: input.title,
      description: input.description
    }
  });
}

function summarizeStatus(items: UserQuotaItem[]) {
  const ratios = items.map((item) => item.remainingRatio).filter((value): value is number => value !== null);
  if (ratios.length === 0) {
    return {
      tone: "neutral" as const,
      title: "已获取配额摘要",
      description: "当前提供商没有返回可展示的百分比窗口，仅展示可安全公开的摘要文本。"
    };
  }

  const lowest = Math.min(...ratios);
  if (lowest <= 0) {
    return {
      tone: "error" as const,
      title: "部分额度已耗尽",
      description: "至少一个可展示窗口已无剩余额度，请关注上游账户状态。"
    };
  }

  if (lowest <= 0.15) {
    return {
      tone: "warning" as const,
      title: "额度余量偏低",
      description: "部分窗口余量已接近阈值，建议尽快检查上游账户。"
    };
  }

  return {
    tone: "ok" as const,
    title: "配额状态正常",
    description: ""
  };
}

async function resolveUserAuthContext(route: string): Promise<UserAuthContext | null> {
  const rows = await db
    .select({
      authIndex: usageRecords.authIndex,
      provider: authFileMappings.provider
    })
    .from(usageRecords)
    .leftJoin(authFileMappings, eq(usageRecords.authIndex, authFileMappings.authId))
    .where(and(eq(usageRecords.route, route), isNotNull(usageRecords.authIndex)))
    .orderBy(desc(usageRecords.occurredAt), desc(usageRecords.id))
    .limit(1);

  const row = rows[0];
  const authIndex = normalizeAuthIndex(row?.authIndex);
  if (!authIndex) return null;

  return {
    authIndex,
    provider: normalizeString(row?.provider)
  };
}

function getRawAuthFileAuthIndex(rawAuthFile: RawAuthFileItem) {
  return normalizeAuthIndex(rawAuthFile.auth_index ?? rawAuthFile.authIndex ?? rawAuthFile.index ?? rawAuthFile.id);
}

async function fetchRawAuthFiles(): Promise<RawAuthFileItem[]> {
  const response = await fetch(`${config.cliproxy.baseUrl.replace(/\/$/, "")}/auth-files`, {
    headers: managementHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("无法获取上游 auth-files 元数据");
  }

  const json = await response.json();
  const items = pickArray(json);

  return items.filter((item): item is RawAuthFileItem => Boolean(item && typeof item === "object"));
}

async function callUpstreamQuota(input: {
  authIndex: string;
  method: "GET" | "POST";
  url: string;
  header?: Record<string, string>;
  data?: string;
}) {
  const response = await fetch(`${config.cliproxy.baseUrl.replace(/\/$/, "")}/api-call`, {
    method: "POST",
    headers: managementHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      auth_index: input.authIndex,
      method: input.method,
      url: input.url,
      header: input.header ?? {},
      ...(input.data ? { data: input.data } : {})
    })
  });

  if (!response.ok) {
    throw new Error("无法通过管理代理获取上游配额");
  }

  return parseApiCallEnvelope(await response.json());
}

function resolveCodexChatgptAccountId(file: RawAuthFileItem): string | null {
  const candidates = [
    file.id_token,
    file.metadata && typeof file.metadata === "object" ? (file.metadata as Record<string, unknown>).id_token : null,
    file.attributes && typeof file.attributes === "object" ? (file.attributes as Record<string, unknown>).id_token : null
  ];

  for (const candidate of candidates) {
    const payload = parseIdTokenPayload(candidate);
    const accountId = normalizeString(payload?.chatgpt_account_id ?? payload?.chatgptAccountId);
    if (accountId) return accountId;
  }

  return null;
}

function resolveCodexPlanType(file: RawAuthFileItem) {
  const candidates = [
    file.plan_type,
    file.planType,
    file.metadata && typeof file.metadata === "object" ? (file.metadata as Record<string, unknown>).plan_type : null,
    file.metadata && typeof file.metadata === "object" ? (file.metadata as Record<string, unknown>).planType : null
  ];

  for (const candidate of candidates) {
    const value = normalizeString(candidate);
    if (value) return value.toLowerCase();
  }

  return null;
}

function parseIdTokenPayload(value: unknown): Record<string, unknown> | null {
  const objectValue = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  if (objectValue) return objectValue;

  const raw = normalizeString(value);
  if (!raw) return null;

  const directJson = parseJsonValue<Record<string, unknown>>(raw);
  if (directJson) return directJson;

  const segments = raw.split(".");
  if (segments.length < 2) return null;
  const decoded = decodeBase64UrlText(segments[1]);
  return decoded ? parseJsonValue<Record<string, unknown>>(decoded) : null;
}

function decodeBase64UrlText(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(padded, "base64").toString("utf8");
    }
  } catch {
    return null;
  }

  return null;
}

function resolveGeminiCliProjectId(file: RawAuthFileItem) {
  const metadata = file.metadata && typeof file.metadata === "object"
    ? (file.metadata as Record<string, unknown>)
    : null;
  const attributes = file.attributes && typeof file.attributes === "object"
    ? (file.attributes as Record<string, unknown>)
    : null;
  const candidates = [file.account, metadata?.account, attributes?.account];

  for (const candidate of candidates) {
    const raw = normalizeString(candidate);
    if (!raw) continue;
    const matches = Array.from(raw.matchAll(/\(([^()]+)\)/g));
    const projectId = matches.at(-1)?.[1]?.trim();
    if (projectId) return projectId;
  }

  return null;
}

function buildClaudeQuotaResponse(usagePayload: Record<string, unknown>, profilePayload: Record<string, unknown> | null) {
  const items: UserQuotaItem[] = [];

  for (const { key, label } of CLAUDE_WINDOW_LABELS) {
    const windowValue = usagePayload[key];
    const windowObj = windowValue && typeof windowValue === "object" && !Array.isArray(windowValue)
      ? (windowValue as Record<string, unknown>)
      : null;
    if (!windowObj) continue;

    const utilization = normalizeNumber(windowObj.utilization);
    const remainingRatio = utilization === null ? null : clampRatio(1 - utilization / 100);
    items.push({
      id: key,
      label,
      remainingRatio,
      remainingLabel: formatPercentLabel(remainingRatio),
      usedLabel: utilization === null ? null : `已用 ${Math.round(utilization)}%`,
      resetLabel: formatResetLabel(windowObj.resets_at)
    });
  }

  const account = profilePayload?.account && typeof profilePayload.account === "object"
    ? (profilePayload.account as Record<string, unknown>)
    : null;
  const planLabel = normalizeBoolean(account?.has_claude_max)
    ? "Claude Max"
    : normalizeBoolean(account?.has_claude_pro)
      ? "Claude Pro"
      : null;

  const extraUsage = usagePayload.extra_usage && typeof usagePayload.extra_usage === "object"
    ? (usagePayload.extra_usage as Record<string, unknown>)
    : null;
  const monthlyLimitCents = normalizeNumber(extraUsage?.monthly_limit);
  const usedCreditsCents = normalizeNumber(extraUsage?.used_credits);
  const creditSummary = monthlyLimitCents !== null && usedCreditsCents !== null
    ? `额外用量 ${formatCurrencyLabel(usedCreditsCents / 100)} / ${formatCurrencyLabel(monthlyLimitCents / 100)}`
    : null;

  return createQuotaResponse({
    available: items.length > 0 || Boolean(creditSummary) || Boolean(planLabel),
    providerLabel: "Claude",
    groupLabel: "使用窗口",
    planLabel,
    creditSummary,
    items,
    accounts: [],
    status: summarizeStatus(items)
  });
}

function pickCodexWindows(limitInfo: CodexRateLimitInfo | null | undefined) {
  if (!limitInfo) {
    return { fiveHourWindow: null, weeklyWindow: null, limitReached: false, allowed: true };
  }

  const primaryWindow = limitInfo.primary_window ?? limitInfo.primaryWindow ?? null;
  const secondaryWindow = limitInfo.secondary_window ?? limitInfo.secondaryWindow ?? null;
  let fiveHourWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;

  for (const window of [primaryWindow, secondaryWindow]) {
    if (!window) continue;
    const seconds = normalizeNumber(window.limit_window_seconds ?? window.limitWindowSeconds);
    if (seconds === CODEX_FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
    } else if (seconds === CODEX_WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    }
  }

  if (!fiveHourWindow && primaryWindow && primaryWindow !== weeklyWindow) {
    fiveHourWindow = primaryWindow;
  }

  if (!weeklyWindow && secondaryWindow && secondaryWindow !== fiveHourWindow) {
    weeklyWindow = secondaryWindow;
  }

  return {
    fiveHourWindow,
    weeklyWindow,
    limitReached: normalizeBoolean(limitInfo.limit_reached ?? limitInfo.limitReached) ?? false,
    allowed: normalizeBoolean(limitInfo.allowed) ?? true
  };
}

function normalizeCodexPlanLabel(planType: string | null) {
  if (!planType) return null;
  if (planType === "team") return "team";
  if (planType === "plus") return "plus";
  if (planType === "free") return "free";
  if (planType === "pro") return "pro";
  return planType;
}

function createCodexAccountWindow(id: string, label: string, window: CodexUsageWindow | null, limitReached: boolean, allowed: boolean): UserQuotaAccountWindow {
  const usedPercent = normalizeNumber(window?.used_percent ?? window?.usedPercent);
  const usedRatio = usedPercent === null ? (limitReached || !allowed ? 1 : null) : clampRatio(usedPercent / 100);
  const remainingRatio = usedRatio === null ? null : clampRatio(1 - usedRatio);

  return {
    id,
    label,
    remainingRatio,
    remainingLabel: formatPercentLabel(remainingRatio),
    resetLabel: formatResetLabel(
      window?.reset_after_seconds ?? window?.resetAfterSeconds ?? window?.reset_at ?? window?.resetAt ?? null
    )
  };
}

function createUnavailableCodexAccount(index: number, rawAuthFile: RawAuthFileItem): UserQuotaAccount {
  return {
    id: `codex-account-${index + 1}`,
    planLabel: normalizeCodexPlanLabel(resolveCodexPlanType(rawAuthFile)),
    windows: [
      {
        id: "five-hour",
        label: "5h",
        remainingRatio: null,
        remainingLabel: null,
        resetLabel: null
      },
      {
        id: "weekly",
        label: "7d",
        remainingRatio: null,
        remainingLabel: null,
        resetLabel: null
      }
    ]
  };
}

function buildCodexAccountQuota(rawAuthFile: RawAuthFileItem, index: number, payload: Record<string, unknown>): UserQuotaAccount {
  const primary = pickCodexWindows((payload.rate_limit ?? payload.rateLimit ?? null) as CodexRateLimitInfo | null);

  return {
    id: `codex-account-${index + 1}`,
    planLabel: normalizeCodexPlanLabel(
      normalizeString(payload.plan_type ?? payload.planType)?.toLowerCase() ?? resolveCodexPlanType(rawAuthFile)
    ),
    windows: [
      createCodexAccountWindow("five-hour", "5h", primary.fiveHourWindow, primary.limitReached, primary.allowed),
      createCodexAccountWindow("weekly", "7d", primary.weeklyWindow, primary.limitReached, primary.allowed)
    ]
  };
}

function buildCodexItem(id: string, label: string, window: CodexUsageWindow | null, limitReached: boolean, allowed: boolean): UserQuotaItem | null {
  if (!window) return null;
  const usedPercent = normalizeNumber(window.used_percent ?? window.usedPercent);
  const usedRatio = usedPercent === null ? (limitReached || !allowed ? 1 : null) : clampRatio(usedPercent / 100);
  const remainingRatio = usedRatio === null ? null : clampRatio(1 - usedRatio);
  return {
    id,
    label,
    remainingRatio,
    remainingLabel: formatPercentLabel(remainingRatio),
    usedLabel: usedPercent === null ? null : `已用 ${Math.round(usedPercent)}%`,
    resetLabel: formatResetLabel(
      window.reset_after_seconds ?? window.resetAfterSeconds ?? window.reset_at ?? window.resetAt
    )
  };
}

function buildCodexQuotaResponse(payload: Record<string, unknown>, fallbackPlanType: string | null) {
  const items: UserQuotaItem[] = [];
  const primary = pickCodexWindows((payload.rate_limit ?? payload.rateLimit ?? null) as CodexRateLimitInfo | null);
  const review = pickCodexWindows(
    (payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? null) as CodexRateLimitInfo | null
  );

  for (const item of [
    buildCodexItem("five-hour", "主窗口（5 小时）", primary.fiveHourWindow, primary.limitReached, primary.allowed),
    buildCodexItem("weekly", "主窗口（7 天）", primary.weeklyWindow, primary.limitReached, primary.allowed),
    buildCodexItem("review-five-hour", "Code Review（5 小时）", review.fiveHourWindow, review.limitReached, review.allowed),
    buildCodexItem("review-weekly", "Code Review（7 天）", review.weeklyWindow, review.limitReached, review.allowed)
  ]) {
    if (item) items.push(item);
  }

  const planType = normalizeString(payload.plan_type ?? payload.planType)?.toLowerCase() ?? fallbackPlanType;
  const planLabel = planType === "pro"
    ? "Codex Pro"
    : planType === "plus"
      ? "Codex Plus"
      : planType === "team"
        ? "Codex Team"
        : planType === "free"
          ? "Codex Free"
          : planType;

  return createQuotaResponse({
    available: items.length > 0 || Boolean(planLabel),
    providerLabel: "Codex",
    groupLabel: "用量窗口",
    planLabel: planLabel ?? null,
    creditSummary: null,
    items,
    accounts: [],
    status: summarizeStatus(items)
  });
}

async function getAllCodexQuota(rawAuthFiles: RawAuthFileItem[]) {
  const orderedCodexFiles = rawAuthFiles.filter((rawAuthFile) => toProviderKey(rawAuthFile, null) === "codex");

  if (!orderedCodexFiles.length) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Codex",
      title: "Codex 额度暂不可用",
      description: "上游当前没有可用的 Codex 账号列表。"
    });
  }

  const accounts = await Promise.all(
    orderedCodexFiles.map(async (rawAuthFile, index) => {
      const authIndex = getRawAuthFileAuthIndex(rawAuthFile);
      if (!authIndex || normalizeBoolean(rawAuthFile.disabled) === true) {
        return createUnavailableCodexAccount(index, rawAuthFile);
      }

      const accountId = resolveCodexChatgptAccountId(rawAuthFile);
      if (!accountId) {
        return createUnavailableCodexAccount(index, rawAuthFile);
      }

      const result = await callUpstreamQuota({
        authIndex,
        method: "GET",
        url: CODEX_USAGE_URL,
        header: {
          Authorization: "Bearer $TOKEN$",
          "Content-Type": "application/json",
          "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
          "Chatgpt-Account-Id": accountId
        }
      }).catch(() => null);

      if (!result || result.statusCode < 200 || result.statusCode >= 300) {
        return createUnavailableCodexAccount(index, rawAuthFile);
      }

      const payload = parseJsonValue<Record<string, unknown>>(result.body ?? result.bodyText);
      if (!payload) {
        return createUnavailableCodexAccount(index, rawAuthFile);
      }

      return buildCodexAccountQuota(rawAuthFile, index, payload);
    })
  );

  return createQuotaResponse({
    available: accounts.length > 0,
    providerLabel: "Codex",
    groupLabel: null,
    planLabel: null,
    creditSummary: null,
    items: [],
    accounts,
    status: {
      tone: "neutral",
      title: "已获取 Codex 额度摘要",
      description: null
    }
  });
}

function buildGeminiCliQuotaResponse(
  quotaPayload: Record<string, unknown>,
  codeAssistPayload: Record<string, unknown> | null
) {
  const buckets = Array.isArray(quotaPayload.buckets) ? quotaPayload.buckets : [];
  const items: UserQuotaItem[] = [];

  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    const bucketObj = bucket as Record<string, unknown>;
    const modelId = normalizeString(bucketObj.modelId ?? bucketObj.model_id);
    if (!modelId) continue;

    const tokenType = normalizeString(bucketObj.tokenType ?? bucketObj.token_type);
    const remainingFraction = clampRatio(
      normalizeNumber(bucketObj.remainingFraction ?? bucketObj.remaining_fraction)
    );
    const remainingAmount = normalizeNumber(bucketObj.remainingAmount ?? bucketObj.remaining_amount);

    items.push({
      id: `${modelId}-${tokenType ?? "default"}`,
      label: tokenType ? `${modelId} · ${tokenType}` : modelId,
      remainingRatio: remainingFraction,
      remainingLabel: formatPercentLabel(remainingFraction),
      usedLabel: remainingAmount === null ? null : `剩余 ${formatCountLabel(remainingAmount)}`,
      resetLabel: formatResetLabel(bucketObj.resetTime ?? bucketObj.reset_time)
    });
  }

  const paidTier = codeAssistPayload?.paidTier && typeof codeAssistPayload.paidTier === "object"
    ? (codeAssistPayload.paidTier as Record<string, unknown>)
    : codeAssistPayload?.paid_tier && typeof codeAssistPayload.paid_tier === "object"
      ? (codeAssistPayload.paid_tier as Record<string, unknown>)
      : null;
  const currentTier = codeAssistPayload?.currentTier && typeof codeAssistPayload.currentTier === "object"
    ? (codeAssistPayload.currentTier as Record<string, unknown>)
    : codeAssistPayload?.current_tier && typeof codeAssistPayload.current_tier === "object"
      ? (codeAssistPayload.current_tier as Record<string, unknown>)
      : null;
  const tier = paidTier ?? currentTier;
  const tierId = normalizeString(tier?.id)?.toLowerCase() ?? null;
  const planLabel = tierId ? GEMINI_CLI_TIER_LABELS[tierId] ?? tierId : null;

  const availableCredits = Array.isArray(tier?.availableCredits)
    ? (tier?.availableCredits as unknown[])
    : Array.isArray(tier?.available_credits)
      ? (tier?.available_credits as unknown[])
      : [];
  let g1Credits = 0;
  let foundCredits = false;
  for (const credit of availableCredits) {
    if (!credit || typeof credit !== "object") continue;
    const creditObj = credit as Record<string, unknown>;
    const creditType = normalizeString(creditObj.creditType ?? creditObj.credit_type);
    if (creditType !== GEMINI_CLI_G1_CREDIT_TYPE) continue;
    const amount = normalizeNumber(creditObj.creditAmount ?? creditObj.credit_amount);
    if (amount !== null) {
      g1Credits += amount;
      foundCredits = true;
    }
  }

  return createQuotaResponse({
    available: items.length > 0 || Boolean(planLabel) || foundCredits,
    providerLabel: "Gemini CLI",
    groupLabel: "模型桶",
    planLabel,
    creditSummary: foundCredits ? `Google One AI Credits：${formatCountLabel(g1Credits)}` : null,
    items,
    accounts: [],
    status: summarizeStatus(items)
  });
}

function buildKimiQuotaResponse(payload: Record<string, unknown>) {
  const items: UserQuotaItem[] = [];
  const limits = Array.isArray(payload.limits) ? payload.limits : [];

  for (const limit of limits) {
    if (!limit || typeof limit !== "object") continue;
    const limitObj = limit as Record<string, unknown>;
    const detail = limitObj.detail && typeof limitObj.detail === "object"
      ? (limitObj.detail as Record<string, unknown>)
      : limitObj;

    const label = normalizeString(limitObj.title ?? limitObj.name ?? limitObj.scope ?? detail.title ?? detail.name);
    if (!label) continue;

    const used = normalizeNumber(detail.used ?? limitObj.used);
    const limitValue = normalizeNumber(detail.limit ?? limitObj.limit);
    const remaining = normalizeNumber(detail.remaining ?? limitObj.remaining);
    const remainingRatio = remaining !== null && limitValue !== null && limitValue > 0
      ? clampRatio(remaining / limitValue)
      : used !== null && limitValue !== null && limitValue > 0
        ? clampRatio(1 - used / limitValue)
        : null;

    items.push({
      id: normalizeString(limitObj.name) ?? label,
      label,
      remainingRatio,
      remainingLabel: formatPercentLabel(remainingRatio),
      usedLabel: used !== null && limitValue !== null
        ? `${formatCountLabel(used)} / ${formatCountLabel(limitValue)}`
        : remaining !== null
          ? `剩余 ${formatCountLabel(remaining)}`
          : null,
      resetLabel: formatResetLabel(detail.resetAt ?? detail.reset_at ?? detail.resetTime ?? detail.reset_time ?? detail.resetIn ?? detail.reset_in ?? detail.ttl)
    });
  }

  return createQuotaResponse({
    available: items.length > 0,
    providerLabel: "Kimi",
    groupLabel: "用量额度",
    planLabel: null,
    creditSummary: null,
    items,
    accounts: [],
    status: summarizeStatus(items)
  });
}

async function getClaudeQuota(authIndex: string) {
  const [usageResult, profileResult] = await Promise.allSettled([
    callUpstreamQuota({
      authIndex,
      method: "GET",
      url: CLAUDE_USAGE_URL,
      header: {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20"
      }
    }),
    callUpstreamQuota({
      authIndex,
      method: "GET",
      url: CLAUDE_PROFILE_URL,
      header: {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20"
      }
    })
  ]);

  if (usageResult.status === "rejected") {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Claude",
      groupLabel: "使用窗口",
      title: "Claude 配额暂不可用",
      description: "当前无法从上游获取 Claude 配额摘要，请稍后再试。",
      tone: "error"
    });
  }

  if (usageResult.value.statusCode < 200 || usageResult.value.statusCode >= 300) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Claude",
      groupLabel: "使用窗口",
      title: "Claude 配额暂不可用",
      description: "上游 Claude 配额接口未返回可用摘要。",
      tone: "error"
    });
  }

  const usagePayload = parseJsonValue<Record<string, unknown>>(usageResult.value.body ?? usageResult.value.bodyText);
  if (!usagePayload) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Claude",
      groupLabel: "使用窗口",
      title: "Claude 配额暂不可用",
      description: "Claude 配额响应为空或不可解析。",
      tone: "error"
    });
  }

  const profilePayload = profileResult.status === "fulfilled" && profileResult.value.statusCode >= 200 && profileResult.value.statusCode < 300
    ? parseJsonValue<Record<string, unknown>>(profileResult.value.body ?? profileResult.value.bodyText)
    : null;

  return buildClaudeQuotaResponse(usagePayload, profilePayload);
}

async function getCodexQuota(authIndex: string, rawAuthFile: RawAuthFileItem) {
  const accountId = resolveCodexChatgptAccountId(rawAuthFile);
  if (!accountId) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Codex",
      groupLabel: "用量窗口",
      title: "Codex 配额暂不可用",
      description: "当前凭据缺少可安全解析的 Codex account 信息。"
    });
  }

  const result = await callUpstreamQuota({
    authIndex,
    method: "GET",
    url: CODEX_USAGE_URL,
    header: {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json",
      "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
      "Chatgpt-Account-Id": accountId
    }
  }).catch(() => null);

  if (!result || result.statusCode < 200 || result.statusCode >= 300) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Codex",
      groupLabel: "用量窗口",
      title: "Codex 配额暂不可用",
      description: "上游 Codex 配额接口当前不可用。",
      tone: "error"
    });
  }

  const payload = parseJsonValue<Record<string, unknown>>(result.body ?? result.bodyText);
  if (!payload) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Codex",
      groupLabel: "用量窗口",
      title: "Codex 配额暂不可用",
      description: "Codex 配额响应为空或不可解析。",
      tone: "error"
    });
  }

  return buildCodexQuotaResponse(payload, resolveCodexPlanType(rawAuthFile));
}

async function getGeminiCliQuota(authIndex: string, rawAuthFile: RawAuthFileItem) {
  const projectId = resolveGeminiCliProjectId(rawAuthFile);
  if (!projectId) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Gemini CLI",
      groupLabel: "模型桶",
      title: "Gemini CLI 配额暂不可用",
      description: "当前凭据缺少可安全解析的项目上下文。"
    });
  }

  const quotaResult = await callUpstreamQuota({
    authIndex,
    method: "POST",
    url: GEMINI_CLI_QUOTA_URL,
    header: {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json"
    },
    data: JSON.stringify({ project: projectId })
  }).catch(() => null);

  if (!quotaResult || quotaResult.statusCode < 200 || quotaResult.statusCode >= 300) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Gemini CLI",
      groupLabel: "模型桶",
      title: "Gemini CLI 配额暂不可用",
      description: "上游 Gemini CLI 配额接口当前不可用。",
      tone: "error"
    });
  }

  const quotaPayload = parseJsonValue<Record<string, unknown>>(quotaResult.body ?? quotaResult.bodyText);
  if (!quotaPayload) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Gemini CLI",
      groupLabel: "模型桶",
      title: "Gemini CLI 配额暂不可用",
      description: "Gemini CLI 配额响应为空或不可解析。",
      tone: "error"
    });
  }

  const codeAssistResult = await callUpstreamQuota({
    authIndex,
    method: "POST",
    url: GEMINI_CLI_CODE_ASSIST_URL,
    header: {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      cloudaicompanionProject: projectId,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: projectId
      }
    })
  }).catch(() => null);

  const codeAssistPayload = codeAssistResult && codeAssistResult.statusCode >= 200 && codeAssistResult.statusCode < 300
    ? parseJsonValue<Record<string, unknown>>(codeAssistResult.body ?? codeAssistResult.bodyText)
    : null;

  return buildGeminiCliQuotaResponse(quotaPayload, codeAssistPayload);
}

async function getKimiQuota(authIndex: string) {
  const result = await callUpstreamQuota({
    authIndex,
    method: "GET",
    url: KIMI_USAGE_URL,
    header: {
      Authorization: "Bearer $TOKEN$"
    }
  }).catch(() => null);

  if (!result || result.statusCode < 200 || result.statusCode >= 300) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Kimi",
      groupLabel: "用量额度",
      title: "Kimi 配额暂不可用",
      description: "上游 Kimi 配额接口当前不可用。",
      tone: "error"
    });
  }

  const payload = parseJsonValue<Record<string, unknown>>(result.body ?? result.bodyText);
  if (!payload) {
    return createUnavailableUserQuotaResponse({
      providerLabel: "Kimi",
      groupLabel: "用量额度",
      title: "Kimi 配额暂不可用",
      description: "Kimi 配额响应为空或不可解析。",
      tone: "error"
    });
  }

  return buildKimiQuotaResponse(payload);
}

export async function getUserQuota(session: UserSession): Promise<UserQuotaResponse> {
  const authContext = await resolveUserAuthContext(session.route);
  if (!authContext) {
    return createUnavailableUserQuotaResponse({
      title: "暂时无法定位当前用户配额",
      description: "当前登录 route 还没有可用的本地 auth-index 映射，暂时无法安全拉取额度摘要。"
    });
  }

  const rawAuthFiles = await fetchRawAuthFiles().catch(() => null);
  if (!rawAuthFiles) {
    return createUnavailableUserQuotaResponse({
      title: "暂时无法定位当前用户配额",
      description: "当前无法读取上游 auth-files，因此暂时无法拉取额度摘要。"
    });
  }

  const rawAuthFile = rawAuthFiles.find((candidate) => getRawAuthFileAuthIndex(candidate) === authContext.authIndex) ?? null;
  if (!rawAuthFile) {
    return createUnavailableUserQuotaResponse({
      title: "暂时无法定位当前用户配额",
      description: "本地已解析到可用 auth-index，但上游 auth-files 中没有找到对应凭据。"
    });
  }

  const provider = toProviderKey(rawAuthFile, authContext.provider);

  if (provider === "codex") {
    return getAllCodexQuota(rawAuthFiles);
  }

  if (normalizeBoolean(rawAuthFile.disabled) === true) {
    return createUnavailableUserQuotaResponse({
      providerLabel: toProviderLabel(provider),
      title: "当前凭据未启用配额摘要",
      description: "上游凭据当前处于禁用状态，因此不会继续拉取配额摘要。"
    });
  }

  if (provider === "claude") {
    return getClaudeQuota(authContext.authIndex);
  }

  if (provider === "codex") {
    return getCodexQuota(authContext.authIndex, rawAuthFile);
  }

  if (provider === "gemini-cli") {
    return getGeminiCliQuota(authContext.authIndex, rawAuthFile);
  }

  if (provider === "kimi") {
    return getKimiQuota(authContext.authIndex);
  }

  return createUnavailableUserQuotaResponse({
    providerLabel: toProviderLabel(provider),
    title: "当前提供商暂未开放用户侧配额摘要",
    description: "这个用户路由对应的上游提供商目前不在 v1 支持列表中，因此只返回安全不可用状态。"
  });
}
