"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line } from "recharts";
import { ArrowRight, CalendarRange, Gauge, Globe2, LineChart as LineChartIcon, LoaderCircle, UserRound } from "lucide-react";
import type { UsageSeriesPoint } from "@/lib/types";
import { formatCompactNumber, formatCurrency, formatHourLabel, formatNumberWithCommas } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_RANGE_SELECTION_KEY = "userRangeSelection";
const PRESET_DAYS = [7, 14, 30] as const;
const USER_OVERVIEW_UNAVAILABLE_MESSAGE = "当前概览暂不可用，请稍后重试。";
const USER_QUOTA_UNAVAILABLE_MESSAGE = "当前配额摘要暂不可用，请稍后重试。";

type RangeMode = "preset" | "custom";
type DashboardViewMode = "self" | "global";
type TrendMode = "day" | "hour";

type SavedRangeSelection = {
  mode?: RangeMode;
  days?: number;
  start?: string;
  end?: string;
};

type OverviewSummary = {
  totalTokens: number;
  estimatedCost: number;
  avgTpm: number;
  requestCount: number;
};

type UserOverviewResponse = {
  view: DashboardViewMode;
  summary?: OverviewSummary;
  totalTokens: number;
  estimatedCost: number;
  totalCost: number;
  avgTpm: number;
  requestCount: number;
  totalRequests: number;
  empty: boolean;
  days: number;
  timezone?: string;
  trends: {
    byDay: UsageSeriesPoint[];
    byHour: UsageSeriesPoint[];
  };
};

type UserQuotaStatusTone = "neutral" | "ok" | "warning" | "error";

type UserQuotaItem = {
  id: string;
  label: string;
  remainingRatio: number | null;
  remainingLabel: string | null;
  usedLabel: string | null;
  resetLabel: string | null;
};

type UserQuotaResponse = {
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
  refreshedAt: string;
};

function formatDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败";
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }

  return response.statusText || "请求失败";
}

function buildQuotaFallback(message: string): UserQuotaResponse {
  return {
    enabled: true,
    available: false,
    providerLabel: null,
    groupLabel: null,
    planLabel: null,
    creditSummary: null,
    items: [],
    status: {
      tone: "error",
      title: "配额摘要暂不可用",
      description: message
    },
    refreshedAt: new Date().toISOString()
  };
}

function SummaryCard({
  label,
  value,
  caption,
  accent
}: {
  label: string;
  value: string;
  caption: string;
  accent: "slate" | "amber" | "emerald" | "blue";
}) {
  const accentStyles = {
    slate: {
      card: "border-slate-800 bg-slate-900/80",
      label: "text-slate-400",
      caption: "text-slate-500"
    },
    amber: {
      card: "border-amber-500/30 bg-amber-500/10",
      label: "text-amber-300",
      caption: "text-amber-200/70"
    },
    emerald: {
      card: "border-emerald-500/30 bg-emerald-500/10",
      label: "text-emerald-300",
      caption: "text-emerald-200/70"
    },
    blue: {
      card: "border-blue-500/30 bg-blue-500/10",
      label: "text-blue-300",
      caption: "text-blue-200/70"
    }
  } as const;

  const styles = accentStyles[accent];

  return (
    <article className={`rounded-2xl border p-5 shadow-lg shadow-slate-950/10 ${styles.card}`}>
      <p className={`text-sm uppercase tracking-[0.18em] ${styles.label}`}>{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
      <p className={`mt-2 text-sm ${styles.caption}`}>{caption}</p>
    </article>
  );
}

function SummaryCardSkeleton() {
  return <div className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />;
}

function getQuotaToneStyles(tone: UserQuotaStatusTone) {
  if (tone === "ok") {
    return {
      banner: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
      meta: "text-emerald-200/80"
    };
  }

  if (tone === "warning") {
    return {
      banner: "border-amber-500/30 bg-amber-500/10 text-amber-100",
      meta: "text-amber-200/80"
    };
  }

  if (tone === "error") {
    return {
      banner: "border-red-500/30 bg-red-500/10 text-red-100",
      meta: "text-red-200/80"
    };
  }

  return {
    banner: "border-slate-700 bg-slate-800/70 text-slate-100",
    meta: "text-slate-400"
  };
}

function QuotaMetricCard({ item }: { item: UserQuotaItem }) {
  const ratioPercent = item.remainingRatio === null ? null : Math.round(item.remainingRatio * 100);
  const barWidth = ratioPercent === null ? 0 : Math.max(6, Math.min(100, ratioPercent));
  const barColor = ratioPercent === null
    ? "bg-slate-700"
    : ratioPercent <= 10
      ? "bg-red-400"
      : ratioPercent <= 30
        ? "bg-amber-400"
        : "bg-emerald-400";

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-white">{item.label}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {item.usedLabel || item.resetLabel ? [item.usedLabel, item.resetLabel].filter(Boolean).join(" · ") : "仅展示用户安全摘要"}
          </p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200">
          {item.remainingLabel ?? "--"}
        </span>
      </div>

      <div className="mt-4 h-2 rounded-full bg-slate-800">
        {ratioPercent !== null ? <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} /> : null}
      </div>
    </article>
  );
}

function QuotaPanel({ quota }: { quota: UserQuotaResponse }) {
  const toneStyles = getQuotaToneStyles(quota.status.tone);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-slate-950/20">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-slate-500">
            <Gauge className="h-4 w-4" />
            配额摘要
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">当前用户额度</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200 lg:justify-end">
          {quota.providerLabel ? <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5">{quota.providerLabel}</span> : null}
          {quota.groupLabel ? <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5">{quota.groupLabel}</span> : null}
          {quota.planLabel ? <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-indigo-100">{quota.planLabel}</span> : null}
        </div>
      </div>

      {quota.creditSummary ||
      (quota.status.description && quota.status.description.trim()) ||
      quota.status.tone === "error" ||
      quota.status.tone === "warning" ? (
        <div className={`mt-5 rounded-2xl border px-4 py-3 ${toneStyles.banner}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <span className="text-sm font-semibold">{quota.status.title}</span>
            {quota.creditSummary ? <span className={`text-xs ${toneStyles.meta}`}>{quota.creditSummary}</span> : null}
          </div>
          {quota.status.description ? <p className={`mt-2 text-sm ${toneStyles.meta}`}>{quota.status.description}</p> : null}
        </div>
      ) : null}

      {quota.available && quota.items.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {quota.items.map((item) => <QuotaMetricCard key={item.id} item={item} />)}
        </div>
      ) : null}
    </section>
  );
}

export default function UserDashboardPage() {
  const defaultEnd = new Date();
  const defaultStart = new Date(defaultEnd.getTime() - 13 * DAY_MS);
  const fallbackRange = {
    mode: "preset" as const,
    days: 14,
    start: formatDateInputValue(defaultStart),
    end: formatDateInputValue(defaultEnd)
  };

  const [rangeMode, setRangeMode] = useState<RangeMode>(fallbackRange.mode);
  const [rangeDays, setRangeDays] = useState(fallbackRange.days);
  const [customStart, setCustomStart] = useState(fallbackRange.start);
  const [customEnd, setCustomEnd] = useState(fallbackRange.end);
  const [customDraftStart, setCustomDraftStart] = useState(fallbackRange.start);
  const [customDraftEnd, setCustomDraftEnd] = useState(fallbackRange.end);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [appliedDays, setAppliedDays] = useState(fallbackRange.days);
  const [viewMode, setViewMode] = useState<DashboardViewMode>("self");
  const [canViewGlobal, setCanViewGlobal] = useState(false);
  const [trendMode, setTrendMode] = useState<TrendMode>("day");
  const [overview, setOverview] = useState<UserOverviewResponse | null>(null);
  const [quota, setQuota] = useState<UserQuotaResponse | null>(null);
  const [quotaVisibility, setQuotaVisibility] = useState<"idle" | "hidden" | "ready">("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const customPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(USER_RANGE_SELECTION_KEY);
    if (!saved) {
      setReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved) as SavedRangeSelection;
      if (parsed.mode === "preset" || parsed.mode === "custom") {
        setRangeMode(parsed.mode);
      }
      if (Number.isFinite(parsed.days)) {
        const nextDays = Math.max(1, Number(parsed.days));
        setRangeDays(nextDays);
        setAppliedDays(nextDays);
      }
      if (typeof parsed.start === "string" && parsed.start) {
        setCustomStart(parsed.start);
        setCustomDraftStart(parsed.start);
      }
      if (typeof parsed.end === "string" && parsed.end) {
        setCustomEnd(parsed.end);
        setCustomDraftEnd(parsed.end);
      }
    } catch {
      window.localStorage.removeItem(USER_RANGE_SELECTION_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(
      USER_RANGE_SELECTION_KEY,
      JSON.stringify({ mode: rangeMode, days: rangeDays, start: customStart, end: customEnd })
    );
  }, [customEnd, customStart, rangeDays, rangeMode, ready]);

  useEffect(() => {
    if (!customPickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (customPickerRef.current && !customPickerRef.current.contains(target)) {
        setCustomPickerOpen(false);
        setCustomError(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [customPickerOpen]);

  useEffect(() => {
    if (!ready) return;
    if (rangeMode === "custom" && (!customStart || !customEnd)) return;

    const controller = new AbortController();
    let active = true;

    const buildParams = (requestedView: DashboardViewMode) => {
      const params = new URLSearchParams();
      if (rangeMode === "custom") {
        params.set("start", customStart);
        params.set("end", customEnd);
      } else {
        params.set("days", String(rangeDays));
      }
      if (requestedView === "global") {
        params.set("view", "global");
      }
      return params;
    };

    const fetchOverview = async (requestedView: DashboardViewMode) => {
      const response = await fetch(`/api/user/overview?${buildParams(requestedView).toString()}`, {
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false as const,
          status: response.status,
          error: await readErrorMessage(response)
        };
      }

      return {
        ok: true as const,
        status: response.status,
        data: (await response.json()) as UserOverviewResponse
      };
    };

    const loadOverview = async () => {
      setLoading(true);
      setError(null);

      try {
        let resolved: UserOverviewResponse | null = null;
        const primary = await fetchOverview(viewMode);
        if (!active) return;

        if (primary.ok) {
          resolved = primary.data;
          if (viewMode === "global") {
            setCanViewGlobal(true);
          }
        } else if (viewMode === "global" && primary.status === 403) {
          setCanViewGlobal(false);
          setViewMode("self");

          const fallback = await fetchOverview("self");
          if (!active) return;
          if (!fallback.ok) {
            setOverview(null);
            setError(`无法加载用户概览：${fallback.error}`);
            return;
          }

          resolved = fallback.data;
        } else {
          setOverview(null);
          setError(`无法加载用户概览：${primary.error}`);
          return;
        }

        setOverview(resolved);
        setAppliedDays(resolved.days || rangeDays);

        if (viewMode === "self") {
          const probe = await fetchOverview("global");
          if (!active) return;
          if (probe.ok) {
            setCanViewGlobal(true);
          } else if (probe.status === 403) {
            setCanViewGlobal(false);
          }
        }
      } catch (requestError) {
        if (!active) return;
        const message = getErrorMessage(requestError);
        if (message === "This operation was aborted") return;
        setOverview(null);
        setError(`无法加载用户概览：${message}`);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [customEnd, customStart, rangeDays, rangeMode, ready, viewMode]);

  useEffect(() => {
    if (!ready) return;

    const controller = new AbortController();
    let active = true;

    const loadQuota = async () => {
      try {
        const response = await fetch("/api/user/quota", {
          cache: "no-store",
          signal: controller.signal
        });

        if (!active) return;

        if (response.status === 404) {
          setQuota(null);
          setQuotaVisibility("hidden");
          return;
        }

        let payload: UserQuotaResponse | null = null;
        try {
          payload = (await response.json()) as UserQuotaResponse;
        } catch {
          payload = null;
        }

        if (!response.ok || !payload) {
          const message = payload?.status?.description || (response.status === 401 ? "登录状态已失效，请重新登录。" : USER_QUOTA_UNAVAILABLE_MESSAGE);
          setQuota(buildQuotaFallback(`无法加载配额摘要：${message}`));
          setQuotaVisibility("ready");
          return;
        }

        setQuota(payload);
        setQuotaVisibility("ready");
      } catch (requestError) {
        if (!active) return;
        const message = getErrorMessage(requestError);
        if (message === "This operation was aborted") return;
        setQuota(buildQuotaFallback(`无法加载配额摘要：${USER_QUOTA_UNAVAILABLE_MESSAGE}`));
        setQuotaVisibility("ready");
      }
    };

    void loadQuota();

    return () => {
      active = false;
      controller.abort();
    };
  }, [ready]);

  const rangeSubtitle = useMemo(() => {
    if (rangeMode === "custom" && customStart && customEnd) {
      return `${customStart} ~ ${customEnd}（共 ${appliedDays} 天）`;
    }
    return `最近 ${appliedDays} 天`;
  }, [appliedDays, customEnd, customStart, rangeMode]);

  const summary = overview?.summary;
  const totalTokens = summary?.totalTokens ?? overview?.totalTokens ?? 0;
  const estimatedCost = summary?.estimatedCost ?? overview?.estimatedCost ?? overview?.totalCost ?? 0;
  const avgTpm = summary?.avgTpm ?? overview?.avgTpm ?? 0;
  const requestCount = summary?.requestCount ?? overview?.requestCount ?? overview?.totalRequests ?? 0;

  const chartData = useMemo(() => {
    if (!overview) return [] as UsageSeriesPoint[];
    return trendMode === "day" ? overview.trends.byDay : overview.trends.byHour;
  }, [overview, trendMode]);

  const chartSubtitle = trendMode === "day"
    ? rangeSubtitle
    : overview?.timezone
      ? `按服务端时区 ${overview.timezone} 的小时桶展示`
      : "按每小时桶展示";

  const chartEmpty = !chartData.length;
  const isGlobalMode = viewMode === "global";

  return (
    <main className="min-h-screen px-6 py-8 text-slate-100 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">User Area</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-white">用户仪表盘</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-400">
                这里仅展示当前登录身份可见的安全聚合概览。即使开启“全站聚合”，也只会切换首页卡片与趋势图，不会改变“我的记录”的访问边界。
              </p>
            </div>
          </div>

          <Link
            href="/user/records"
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
          >
            前往我的记录
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/20">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm uppercase tracking-[0.18em] text-slate-500">时间范围</span>
                {PRESET_DAYS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setRangeMode("preset");
                      setRangeDays(days);
                      setCustomPickerOpen(false);
                      setCustomError(null);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      rangeMode === "preset" && rangeDays === days
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    最近 {days} 天
                  </button>
                ))}

                <div className="relative" ref={customPickerRef}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setCustomPickerOpen((open) => !open);
                      setCustomDraftStart(customStart);
                      setCustomDraftEnd(customEnd);
                      setCustomError(null);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      rangeMode === "custom"
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    自定义
                  </button>

                  {customPickerOpen ? (
                    <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl shadow-slate-950/30">
                      <div className="grid gap-3 text-sm text-slate-300">
                        <label className="grid gap-1.5">
                          <span>开始日期</span>
                          <input
                            type="date"
                            value={customDraftStart}
                            max={customDraftEnd || undefined}
                            onChange={(event) => setCustomDraftStart(event.target.value)}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none transition focus:border-indigo-500"
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span>结束日期</span>
                          <input
                            type="date"
                            value={customDraftEnd}
                            min={customDraftStart || undefined}
                            onChange={(event) => setCustomDraftEnd(event.target.value)}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none transition focus:border-indigo-500"
                          />
                        </label>
                        {customError ? <p className="text-xs text-red-400">{customError}</p> : null}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCustomPickerOpen(false);
                              setCustomDraftStart(customStart);
                              setCustomDraftEnd(customEnd);
                              setCustomError(null);
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!customDraftStart || !customDraftEnd) {
                                setCustomError("请选择开始和结束日期");
                                return;
                              }

                              const startDate = new Date(customDraftStart);
                              const endDate = new Date(customDraftEnd);
                              if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
                                setCustomError("日期无效");
                                return;
                              }
                              if (endDate < startDate) {
                                setCustomError("结束日期需不早于开始日期");
                                return;
                              }

                              setCustomStart(customDraftStart);
                              setCustomEnd(customDraftEnd);
                              setRangeMode("custom");
                              setCustomError(null);
                              setCustomPickerOpen(false);
                            }}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
                          >
                            应用
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {rangeMode === "custom" ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">
                    <CalendarRange className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="whitespace-nowrap">{rangeSubtitle}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
                <span>当前范围：{rangeSubtitle}</span>
                {loading ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载概览
                  </span>
                ) : null}
              </div>
            </div>

            {canViewGlobal ? (
              <div className="flex flex-col gap-2 xl:items-end">
                <span className="text-sm uppercase tracking-[0.18em] text-slate-500">统计视角</span>
                <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-700 bg-slate-800/80 p-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setViewMode("self")}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      viewMode === "self" ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <UserRound className="h-4 w-4" />
                    我的使用
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setViewMode("global")}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      viewMode === "global" ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <Globe2 className="h-4 w-4" />
                    全站聚合
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {isGlobalMode && canViewGlobal ? (
            <div className="mt-5 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
              当前展示的是全站聚合统计，仅影响本页摘要卡与趋势图。<span className="font-medium text-white">“我的记录”仍只会显示当前登录身份对应的明细</span>，不会扩大可见范围。
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {loading && !overview ? (
            <>
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
            </>
          ) : (
            <>
              <SummaryCard
                label="Tokens"
                value={formatNumberWithCommas(totalTokens)}
                caption={isGlobalMode ? "全站聚合 token 总量" : "当前身份的 token 总量"}
                accent="slate"
              />
              <SummaryCard
                label="Estimated Cost"
                value={formatCurrency(estimatedCost)}
                caption="基于服务端概览直接返回的估算费用"
                accent="amber"
              />
              <SummaryCard
                label="平均 TPM"
                value={formatDecimal(avgTpm)}
                caption="使用服务端 summary.avgTpm，不在客户端重算"
                accent="emerald"
              />
              <SummaryCard
                label="Request Count"
                value={formatNumberWithCommas(requestCount)}
                caption={rangeSubtitle}
                accent="blue"
              />
            </>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-slate-950/20">
          <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-slate-500">
                <LineChartIcon className="h-4 w-4" />
                趋势图
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">{trendMode === "day" ? "按日用量趋势" : "按小时用量趋势"}</h2>
                <p className="mt-1 text-sm text-slate-400">{chartSubtitle}</p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1 self-start rounded-2xl border border-slate-700 bg-slate-800/80 p-1">
              <button
                type="button"
                onClick={() => setTrendMode("day")}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  trendMode === "day" ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                按日
              </button>
              <button
                type="button"
                onClick={() => setTrendMode("hour")}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  trendMode === "hour" ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                按小时
              </button>
            </div>
          </div>

          <div className="mt-6 h-[360px]">
            {loading && !overview ? (
              <div className="h-full animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
            ) : chartEmpty ? (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 text-center">
                <p className="text-base text-slate-300">当前范围内暂无趋势数据</p>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  你可以切换时间范围后重新查看。无论是否处于“全站聚合”，这里只显示聚合结果，不提供任何其他用户的明细入口。
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={12}
                    minTickGap={24}
                    tickFormatter={(label) => trendMode === "hour" ? formatHourLabel(String(label)) : String(label)}
                  />
                  <YAxis
                    yAxisId="requests"
                    stroke="#60a5fa"
                    fontSize={12}
                    tickFormatter={(value) => formatCompactNumber(Number(value))}
                  />
                  <YAxis
                    yAxisId="tokens"
                    orientation="right"
                    stroke="#4ade80"
                    fontSize={12}
                    tickFormatter={(value) => formatCompactNumber(Number(value))}
                  />
                  <YAxis yAxisId="cost" hide width={0} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "16px",
                      border: "1px solid rgba(148, 163, 184, 0.35)",
                      backgroundColor: "rgba(15, 23, 42, 0.92)",
                      boxShadow: "0 16px 40px rgba(2, 6, 23, 0.45)",
                      color: "#f8fafc"
                    }}
                    labelStyle={{ color: "#e2e8f0", marginBottom: "6px" }}
                    labelFormatter={(label) => trendMode === "hour" ? formatHourLabel(String(label)) : String(label)}
                    formatter={(value, name) => {
                      const numeric = typeof value === "number" ? value : Number(value ?? 0);
                      if (name === "预估费用") {
                        return [formatCurrency(numeric), name];
                      }
                      return [formatNumberWithCommas(numeric), name];
                    }}
                  />
                  <Bar
                    yAxisId="requests"
                    dataKey="requests"
                    name="请求数"
                    fill="#60a5fa"
                    fillOpacity={0.2}
                    stroke="#60a5fa"
                    strokeOpacity={0.5}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={22}
                  />
                  <Line
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="tokens"
                    name="Tokens"
                    stroke="#4ade80"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 5, fill: "#4ade80", stroke: "#0f172a", strokeWidth: 2 }}
                  />
                  <Line
                    yAxisId="cost"
                    type="monotone"
                    dataKey="cost"
                    name="预估费用"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: "#fbbf24", stroke: "#0f172a", strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {quotaVisibility === "ready" && quota ? <QuotaPanel quota={quota} /> : null}
      </div>
    </main>
  );
}
