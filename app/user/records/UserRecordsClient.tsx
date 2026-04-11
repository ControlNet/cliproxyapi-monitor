"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarRange, LoaderCircle } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { enUS, ja, ko, zhCN } from "date-fns/locale";
import { formatNumberWithCommas } from "@/lib/utils";

type UserUsageRecord = {
  id: number;
  occurredAt: string;
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  isError: boolean;
  cost: number;
};

type UserRecordsResponse = {
  items: UserUsageRecord[];
  nextCursor: string | null;
  filters?: { models: string[] };
};

type SortField =
  | "occurredAt"
  | "model"
  | "totalTokens"
  | "inputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "cachedTokens"
  | "cost"
  | "isError";

type SortOrder = "asc" | "desc";
type SortKey = { field: SortField; order: SortOrder };
type ColumnKey = SortField;

const PAGE_SIZE = 60;
const TOKEN_COLORS = {
  input: "#fb7185",
  output: "#4ade80",
  reasoning: "#fbbf24",
  cached: "#c084fc"
} as const;

const COLUMN_ORDER: ColumnKey[] = [
  "occurredAt",
  "model",
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cachedTokens",
  "cost",
  "isError"
];

const COLUMN_LABELS: Record<ColumnKey, string> = {
  occurredAt: "时间",
  model: "模型",
  totalTokens: "Tokens",
  inputTokens: "输入",
  outputTokens: "输出",
  reasoningTokens: "思考",
  cachedTokens: "缓存",
  cost: "费用",
  isError: "状态"
};

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  occurredAt: 156,
  model: 220,
  totalTokens: 120,
  inputTokens: 96,
  outputTokens: 96,
  reasoningTokens: 96,
  cachedTokens: 96,
  cost: 108,
  isError: 92
};

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }

  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleString("zh-CN", {
    year: includeYear ? "2-digit" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatCost(value: number) {
  if (value === 0) {
    return "$0";
  }

  return `$${value.toFixed(5)}`;
}

function formatDateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTimeDisplay(value: string) {
  if (!value) {
    return "-";
  }

  return value.replace("T", " ");
}

function parseDateTimeInput(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const time = value.includes("T") ? value.split("T")[1] ?? "00:00" : "00:00";
  return { date, time };
}

function SkeletonRow() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="h-3 w-1/3 rounded bg-slate-700/60" />
      <div className="mt-3 h-3 w-2/3 rounded bg-slate-700/60" />
    </div>
  );
}

function SortHeader({
  label,
  priority,
  order,
  showPriority,
  onClick
}: {
  label: string;
  priority?: number;
  order?: SortOrder;
  showPriority: boolean;
  onClick: () => void;
}) {
  const active = priority !== undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 font-semibold transition ${active ? "text-white" : "text-slate-300 hover:text-white"}`}
    >
      <span>{label}</span>
      {showPriority && priority !== undefined ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500/20 px-1 text-[10px] text-indigo-200 ring-1 ring-indigo-500/30">
          {priority}
        </span>
      ) : null}
      {active ? (order === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : null}
    </button>
  );
}

export default function UserRecordsClient() {
  const [records, setRecords] = useState<UserUsageRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [timeStart, setTimeStart] = useState("00:00");
  const [timeEnd, setTimeEnd] = useState("23:59");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: "occurredAt", order: "desc" }]);

  const rangePickerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const loadingEmpty = loading && records.length === 0;
  const isEmpty = !loading && records.length === 0;

  const buildParams = useCallback(
    (cursorValue?: string | null, includeFilters?: boolean) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set(
        "sort",
        sortKeys.map((key) => `${key.field}:${key.order}`).join(",")
      );

      if (cursorValue) {
        params.set("cursor", cursorValue);
      }
      if (selectedModel) {
        params.set("model", selectedModel);
      }
      if (startInput) {
        params.set("start", new Date(startInput).toISOString());
      }
      if (endInput) {
        params.set("end", new Date(endInput).toISOString());
      }
      if (includeFilters) {
        params.set("includeFilters", "1");
      }

      return params;
    },
    [endInput, selectedModel, sortKeys, startInput]
  );

  const fetchRecords = useCallback(
    async (options: { cursor?: string | null; append?: boolean; includeFilters?: boolean } = {}) => {
      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/user/records?${buildParams(options.cursor, options.includeFilters).toString()}`, {
          cache: "no-store"
        });

        let payload: UserRecordsResponse | null = null;
        try {
          payload = (await response.json()) as UserRecordsResponse;
        } catch {
          payload = null;
        }

        if (!response.ok || !payload) {
          if (response.status === 401) {
            throw new Error("登录状态已失效，请重新登录。");
          }
          throw new Error("无法加载我的记录，请稍后重试。");
        }

        setRecords((previous) => (options.append ? [...previous, ...payload.items] : payload.items));
        setCursor(payload.nextCursor ?? null);
        setHasMore(Boolean(payload.nextCursor));

        if (options.includeFilters) {
          setModels(payload.filters?.models ?? []);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "无法加载我的记录，请稍后重试。");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [buildParams]
  );

  const resetAndFetch = useCallback(() => {
    setRecords([]);
    setCursor(null);
    setHasMore(true);
    void fetchRecords({ cursor: null, append: false, includeFilters: true });
  }, [fetchRecords]);

  useEffect(() => {
    resetAndFetch();
  }, [resetAndFetch]);

  useEffect(() => {
    if (!rangePickerOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rangePickerRef.current && !rangePickerRef.current.contains(target)) {
        setRangePickerOpen(false);
        setRangeError(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [rangePickerOpen]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMore && cursor && !loadingRef.current) {
          void fetchRecords({ cursor, append: true, includeFilters: false });
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, fetchRecords, hasMore, loading]);

  const handleSort = useCallback((field: SortField) => {
    setSortKeys((previous) => {
      const index = previous.findIndex((key) => key.field === field);
      if (index !== -1) {
        const current = previous[index];
        if (current.order === "asc") {
          if (previous.length > 1 && field !== "occurredAt") {
            return previous.filter((_, currentIndex) => currentIndex !== index);
          }
          return previous.map((key, currentIndex) => (currentIndex === index ? { ...key, order: "desc" } : key));
        }

        return previous.map((key, currentIndex) => (currentIndex === index ? { ...key, order: "asc" } : key));
      }

      return [{ field, order: "desc" }, ...previous];
    });
  }, []);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedModel) {
      parts.push(`模型：${selectedModel}`);
    }
    if (startInput || endInput) {
      parts.push(`时间：${formatDateTimeDisplay(startInput)} ~ ${formatDateTimeDisplay(endInput)}`);
    }

    return parts.length > 0 ? parts.join(" / ") : "暂无筛选";
  }, [endInput, selectedModel, startInput]);

  const rangeLabel = useMemo(() => {
    if (!startInput && !endInput) {
      return "选择时间范围";
    }

    return `${formatDateTimeDisplay(startInput)} ~ ${formatDateTimeDisplay(endInput)}`;
  }, [endInput, startInput]);

  const dayPickerLocale = useMemo(() => {
    if (typeof navigator === "undefined") {
      return zhCN;
    }

    const language = navigator.language.toLowerCase();
    if (language.startsWith("zh")) return zhCN;
    if (language.startsWith("ja")) return ja;
    if (language.startsWith("ko")) return ko;
    return enUS;
  }, []);

  const dayPickerClassNames = useMemo(
    () => ({
      months: "flex flex-col gap-2",
      month: "relative space-y-2",
      month_caption: "px-2 py-2 pr-18 text-sm text-slate-200",
      caption: "px-2 py-2 pr-18 text-sm text-slate-200",
      caption_label: "relative top-[2px] text-sm font-semibold text-slate-100",
      nav: "absolute right-2 top-2 z-10 flex items-center gap-2",
      button_previous: "h-7 w-7 rounded-md text-slate-300 hover:bg-slate-800/80",
      button_next: "h-7 w-7 rounded-md text-slate-300 hover:bg-slate-800/80",
      month_grid: "w-full border-separate border-spacing-y-2",
      weekdays: "text-xs text-slate-500",
      weekday: "pb-1",
      weeks: "",
      week: "w-full",
      day: "p-0",
      day_button: "h-8 w-full rounded-none text-sm text-slate-200 transition-all hover:!rounded-md hover:!bg-indigo-500 hover:!text-white relative z-10",
      today: "font-semibold text-indigo-300",
      selected: "!rounded-none !bg-indigo-500 !text-white font-semibold hover:!bg-indigo-600 hover:!text-white",
      range_start: "!rounded-l-lg !bg-indigo-500 !text-white font-semibold hover:!bg-indigo-600 hover:!text-white",
      range_end: "!rounded-r-lg !bg-indigo-500 !text-white font-semibold hover:!bg-indigo-600 hover:!text-white",
      range_middle: "!rounded-none !bg-indigo-500/25 !text-indigo-100 hover:!rounded-none hover:!bg-indigo-500/40 hover:!text-white",
      outside: "text-slate-600",
      disabled: "text-slate-600"
    }),
    []
  );

  const costTone = useCallback((cost: number) => {
    if (cost >= 5) return "bg-red-500/20 text-red-300 ring-1 ring-red-500/40";
    if (cost >= 1) return "bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/40";
    if (cost > 0) return "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/40";
    return "bg-slate-700/60 text-slate-300 ring-1 ring-slate-600";
  }, []);

  const statusTone = useCallback((isError: boolean) => {
    return isError
      ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40"
      : "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40";
  }, []);

  const renderHeader = useCallback(
    (column: ColumnKey) => {
      const index = sortKeys.findIndex((key) => key.field === column);
      const priority = index !== -1 ? index + 1 : undefined;
      const order = index !== -1 ? sortKeys[index].order : undefined;

      return (
        <SortHeader
          label={COLUMN_LABELS[column]}
          priority={priority}
          order={order}
          showPriority={sortKeys.length > 1}
          onClick={() => handleSort(column)}
        />
      );
    },
    [handleSort, sortKeys]
  );

  const renderCell = useCallback(
    (column: ColumnKey, row: UserUsageRecord) => {
      switch (column) {
        case "occurredAt":
          return <span className="text-sm font-semibold text-white">{formatTimestamp(row.occurredAt)}</span>;
        case "model":
          return (
            <span className="block max-w-[220px] truncate font-semibold text-white" title={row.model}>
              {row.model}
            </span>
          );
        case "totalTokens":
          return (
            <span className="inline-flex items-center rounded-full bg-indigo-500/20 px-2.5 py-1 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-500/30">
              {formatNumberWithCommas(row.totalTokens)}
            </span>
          );
        case "inputTokens":
          return <span style={{ color: TOKEN_COLORS.input }}>{formatNumberWithCommas(row.inputTokens)}</span>;
        case "outputTokens":
          return <span style={{ color: TOKEN_COLORS.output }}>{formatNumberWithCommas(row.outputTokens)}</span>;
        case "reasoningTokens":
          return <span style={{ color: TOKEN_COLORS.reasoning }}>{formatNumberWithCommas(row.reasoningTokens)}</span>;
        case "cachedTokens":
          return <span style={{ color: TOKEN_COLORS.cached }}>{formatNumberWithCommas(row.cachedTokens)}</span>;
        case "cost":
          return (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${costTone(row.cost)}`}>
              {formatCost(row.cost)}
            </span>
          );
        case "isError":
          return (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(row.isError)}`}>
              {row.isError ? "失败" : "成功"}
            </span>
          );
        default:
          return null;
      }
    },
    [costTone, statusTone]
  );

  return (
    <main className="min-h-screen px-6 py-8 text-slate-100 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">User Area</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-white">我的记录</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-400">
                这里展示当前登录用户范围内的调用明细，沿用管理端记录页的排序、时间筛选与游标加载体验，但只保留用户可见的安全字段且始终只查询 `/api/user/records`。
              </p>
            </div>
          </div>

          <Link
            href="/user"
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
          >
            返回用户仪表盘
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/20">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3 text-sm text-slate-300">
              <label className="inline-flex items-center gap-2">
                <span className="text-slate-500">模型</span>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">全部模型</option>
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <div className="relative" ref={rangePickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    const start = parseDateTimeInput(startInput);
                    const end = parseDateTimeInput(endInput);

                    if (start && end) {
                      setRange({ from: start.date, to: end.date });
                      setTimeStart(start.time);
                      setTimeEnd(end.time);
                    } else if (start) {
                      setRange({ from: start.date, to: start.date });
                      setTimeStart(start.time);
                      setTimeEnd("23:59");
                    } else if (end) {
                      setRange({ from: end.date, to: end.date });
                      setTimeStart("00:00");
                      setTimeEnd(end.time);
                    } else {
                      setRange(undefined);
                      setTimeStart("00:00");
                      setTimeEnd("23:59");
                    }

                    setRangeError(null);
                    setRangePickerOpen((previous) => !previous);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500"
                >
                  <CalendarRange className="h-4 w-4 text-indigo-400" />
                  <span className="whitespace-nowrap">{rangeLabel}</span>
                </button>

                {rangePickerOpen ? (
                  <div className="absolute left-0 z-20 mt-2 w-auto min-w-[320px] rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                      <DayPicker
                        mode="range"
                        selected={range}
                        onSelect={setRange}
                        numberOfMonths={1}
                        locale={dayPickerLocale}
                        className="rdp rdp-dark text-slate-200"
                        classNames={dayPickerClassNames}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="block text-xs text-slate-400">
                        开始时间
                        <input
                          type="time"
                          value={timeStart}
                          onChange={(event) => setTimeStart(event.target.value)}
                          className="mt-1 w-full min-w-[120px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        />
                      </label>
                      <label className="block text-xs text-slate-400">
                        结束时间
                        <input
                          type="time"
                          value={timeEnd}
                          onChange={(event) => setTimeEnd(event.target.value)}
                          className="mt-1 w-full min-w-[120px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        />
                      </label>
                    </div>

                    {rangeError ? <p className="mt-3 text-xs text-red-400">{rangeError}</p> : null}

                    <div className="mt-4 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRangePickerOpen(false);
                          setRangeError(null);
                        }}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!range?.from || !range?.to) {
                            setRangeError("请选择开始和结束时间");
                            return;
                          }
                          if (range.to < range.from) {
                            setRangeError("结束时间需不早于开始时间");
                            return;
                          }
                          if (!/^\d{2}:\d{2}$/.test(timeStart) || !/^\d{2}:\d{2}$/.test(timeEnd)) {
                            setRangeError("时间格式无效");
                            return;
                          }

                          setRangeError(null);
                          setStartInput(`${formatDateInput(range.from)}T${timeStart}`);
                          setEndInput(`${formatDateInput(range.to)}T${timeEnd}`);
                          setRangePickerOpen(false);
                        }}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        应用
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedModel("");
                  setStartInput("");
                  setEndInput("");
                  setRange(undefined);
                  setTimeStart("00:00");
                  setTimeEnd("23:59");
                  setRangeError(null);
                  setRangePickerOpen(false);
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                重置
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs leading-6 text-slate-400">
              <p>仅展示安全字段：时间、模型、Tokens、输入、输出、思考、缓存、费用、状态。</p>
              <p>当前筛选：{filterSummary}</p>
            </div>
          </div>
        </section>

        <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/10 ${loadingEmpty ? "min-h-[60vh]" : ""}`}>
          {!loadingEmpty ? (
            <div className="overflow-auto">
              <table className="min-w-full table-fixed border-separate border-spacing-y-2">
                <thead className="sticky top-0 z-10">
                  <tr className="text-left text-[13px] uppercase tracking-wide text-slate-400">
                    {COLUMN_ORDER.map((column) => (
                      <th
                        key={column}
                        className="px-3 py-2"
                        style={{ width: `${COLUMN_WIDTHS[column]}px`, minWidth: `${COLUMN_WIDTHS[column]}px` }}
                      >
                        {renderHeader(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {records.map((row) => (
                    <tr
                      key={row.id}
                      className="group h-13 rounded-lg bg-slate-950/75 text-slate-100 shadow-sm ring-1 ring-slate-800 transition hover:shadow-[0_0_24px_rgba(99,102,241,0.14)]"
                    >
                      {COLUMN_ORDER.map((column, index) => {
                        const isFirst = index === 0;
                        const isLast = index === COLUMN_ORDER.length - 1;
                        return (
                          <td
                            key={`${row.id}-${column}`}
                            className={`whitespace-nowrap border-y border-transparent px-3 py-3 transition group-hover:border-indigo-400/40 ${
                              isFirst
                                ? "rounded-l-lg border-l border-l-transparent group-hover:border-l-indigo-400/40 group-hover:shadow-[-10px_0_16px_-10px_rgba(99,102,241,0.42)]"
                                : ""
                            } ${
                              isLast
                                ? "rounded-r-lg border-r border-r-transparent group-hover:border-r-indigo-400/40 group-hover:shadow-[10px_0_16px_-10px_rgba(99,102,241,0.42)]"
                                : ""
                            }`}
                            style={{ width: `${COLUMN_WIDTHS[column]}px`, minWidth: `${COLUMN_WIDTHS[column]}px` }}
                          >
                            {renderCell(column, row)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {loadingEmpty ? (
            <div className="grid min-h-[50vh] gap-3">
              {[1, 2, 3].map((item) => (
                <SkeletonRow key={item} />
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {isEmpty ? (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-sm text-slate-400">
              当前筛选范围内暂无调用记录。
            </div>
          ) : null}

          {records.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>已加载 {records.length} 条记录</span>
              <div className="flex items-center gap-3 self-start sm:self-auto">
                {loading ? <span>加载中...</span> : hasMore ? <span>继续向下滚动或手动加载更多</span> : <span>已到底</span>}
                {hasMore ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!cursor || loadingRef.current) {
                        return;
                      }
                      void fetchRecords({ cursor, append: true, includeFilters: false });
                    }}
                    disabled={!cursor || loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading && !loadingEmpty ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                    加载更多
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div ref={sentinelRef} className="h-6" />
        </section>
      </div>
    </main>
  );
}
