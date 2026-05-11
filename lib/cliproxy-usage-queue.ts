import net from "node:net";
import tls from "node:tls";

import { config } from "@/lib/config";
import { parseUsageQueuePayload, type UsageQueueEvent, type UsageQueueWarning } from "@/lib/usage";

export type RespReply =
  | { type: "simpleString"; value: string }
  | { type: "error"; message: string }
  | { type: "integer"; value: number }
  | { type: "bulkString"; value: string | null }
  | { type: "array"; value: RespReply[] | null };

export type CliproxyUsageQueueResultSource = "resp" | "http-usage-queue";
export type CliproxyUsageQueueFailureKind = "auth" | "unsupported" | "timeout" | "protocol";

export type CliproxyUsageQueueWarning =
  | {
      source: CliproxyUsageQueueResultSource;
      kind: "record";
      code: UsageQueueWarning["reason"];
      index: number;
      message: string;
    }
  | {
      source: CliproxyUsageQueueResultSource;
      kind: CliproxyUsageQueueFailureKind;
      code: string;
      message: string;
      status?: number;
    };

export type CliproxyUsageQueueSuccessResult = {
  ok: true;
  source: CliproxyUsageQueueResultSource;
  records: UsageQueueEvent[];
  warnings: CliproxyUsageQueueWarning[];
};

export type CliproxyUsageQueueFailureResult = {
  ok: false;
  source: CliproxyUsageQueueResultSource;
  records: UsageQueueEvent[];
  warnings: CliproxyUsageQueueWarning[];
  failure: {
    kind: CliproxyUsageQueueFailureKind;
    code: string;
    message: string;
    status?: number;
  };
};

export type CliproxyUsageQueueResult = CliproxyUsageQueueSuccessResult | CliproxyUsageQueueFailureResult;

type CliproxyUsageQueueClientOptions = {
  baseUrl?: string;
  serviceBaseUrl?: string;
  managementKey?: string;
  batchSize?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  netConnect?: typeof net.connect;
  tlsConnect?: typeof tls.connect;
};

type ResolvedCliproxyUsageQueueClientOptions = {
  baseUrl: string;
  serviceBaseUrl: string;
  managementKey: string;
  batchSize: number;
  timeoutMs: number;
  fetch: typeof fetch;
  netConnect: typeof net.connect;
  tlsConnect: typeof tls.connect;
};

const RESP_CRLF = "\r\n";

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return fallback;
  return value ?? fallback;
}

function resolveOptions(options: CliproxyUsageQueueClientOptions = {}): ResolvedCliproxyUsageQueueClientOptions {
  return {
    baseUrl: options.baseUrl ?? config.cliproxy.baseUrl,
    serviceBaseUrl: options.serviceBaseUrl ?? config.cliproxy.serviceBaseUrl,
    managementKey: options.managementKey ?? config.cliproxy.managementKey,
    batchSize: toPositiveInt(options.batchSize, config.cliproxy.usageQueue.batchSize ?? 100),
    timeoutMs: toPositiveInt(options.timeoutMs, config.cliproxy.usageQueue.timeoutMs ?? 15_000),
    fetch: options.fetch ?? fetch,
    netConnect: options.netConnect ?? net.connect,
    tlsConnect: options.tlsConnect ?? tls.connect
  };
}

function encodeRespCommand(parts: readonly string[]) {
  const chunks: Buffer[] = [Buffer.from(`*${parts.length}${RESP_CRLF}`, "utf8")];

  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    chunks.push(Buffer.from(`$${value.length}${RESP_CRLF}`, "utf8"), value, Buffer.from(RESP_CRLF, "utf8"));
  }

  return Buffer.concat(chunks);
}

function readRespLine(buffer: Buffer<ArrayBufferLike>, offset: number) {
  const end = buffer.indexOf(RESP_CRLF, offset, "utf8");
  if (end === -1) return null;
  return {
    line: buffer.toString("utf8", offset, end),
    nextOffset: end + RESP_CRLF.length
  };
}

function parseRespReply(buffer: Buffer<ArrayBufferLike>, offset = 0): { reply: RespReply; nextOffset: number } | null {
  if (offset >= buffer.length) return null;

  const prefix = String.fromCharCode(buffer[offset]);
  const header = readRespLine(buffer, offset + 1);
  if (!header) return null;

  switch (prefix) {
    case "+":
      return {
        reply: { type: "simpleString", value: header.line },
        nextOffset: header.nextOffset
      };
    case "-":
      return {
        reply: { type: "error", message: header.line },
        nextOffset: header.nextOffset
      };
    case ":": {
      const value = Number.parseInt(header.line, 10);
      if (Number.isNaN(value)) {
        throw new Error(`Invalid RESP integer: ${header.line}`);
      }
      return {
        reply: { type: "integer", value },
        nextOffset: header.nextOffset
      };
    }
    case "$": {
      const length = Number.parseInt(header.line, 10);
      if (Number.isNaN(length) || length < -1) {
        throw new Error(`Invalid RESP bulk string length: ${header.line}`);
      }
      if (length === -1) {
        return {
          reply: { type: "bulkString", value: null },
          nextOffset: header.nextOffset
        };
      }

      const bodyEnd = header.nextOffset + length;
      const trailerEnd = bodyEnd + RESP_CRLF.length;
      if (trailerEnd > buffer.length) return null;

      if (buffer.toString("utf8", bodyEnd, trailerEnd) !== RESP_CRLF) {
        throw new Error("Invalid RESP bulk string terminator");
      }

      return {
        reply: {
          type: "bulkString",
          value: buffer.toString("utf8", header.nextOffset, bodyEnd)
        },
        nextOffset: trailerEnd
      };
    }
    case "*": {
      const length = Number.parseInt(header.line, 10);
      if (Number.isNaN(length) || length < -1) {
        throw new Error(`Invalid RESP array length: ${header.line}`);
      }
      if (length === -1) {
        return {
          reply: { type: "array", value: null },
          nextOffset: header.nextOffset
        };
      }

      const replies: RespReply[] = [];
      let nextOffset = header.nextOffset;
      for (let index = 0; index < length; index += 1) {
        const parsed = parseRespReply(buffer, nextOffset);
        if (!parsed) return null;
        replies.push(parsed.reply);
        nextOffset = parsed.nextOffset;
      }

      return {
        reply: { type: "array", value: replies },
        nextOffset
      };
    }
    default:
      throw new Error(`Unsupported RESP prefix: ${prefix}`);
  }
}

function toWarning(
  source: CliproxyUsageQueueResultSource,
  kind: CliproxyUsageQueueFailureKind,
  code: string,
  message: string,
  status?: number
): CliproxyUsageQueueWarning {
  return { source, kind, code, message, status };
}

function failureResult(
  source: CliproxyUsageQueueResultSource,
  kind: CliproxyUsageQueueFailureKind,
  code: string,
  message: string,
  status?: number
): CliproxyUsageQueueFailureResult {
  return {
    ok: false,
    source,
    records: [],
    warnings: [toWarning(source, kind, code, message, status)],
    failure: { kind, code, message, status }
  };
}

function recordWarnings(source: CliproxyUsageQueueResultSource, warnings: UsageQueueWarning[]): CliproxyUsageQueueWarning[] {
  return warnings.map((warning) => ({
    source,
    kind: "record",
    code: warning.reason,
    index: warning.index,
    message: warning.message
  }));
}

function classifyRespError(message: string): { kind: CliproxyUsageQueueFailureKind; code: string } {
  const normalized = message.toLowerCase();
  if (normalized.includes("wrongpass") || normalized.includes("noauth") || normalized.includes("auth")) {
    return { kind: "auth", code: "resp-auth-failed" };
  }
  if (normalized.includes("unknown command") || normalized.includes("unknown subcommand") || normalized.includes("unsupported")) {
    return { kind: "unsupported", code: "resp-unsupported" };
  }
  return { kind: "protocol", code: "resp-command-error" };
}

function respReplyToValue(reply: RespReply): unknown {
  switch (reply.type) {
    case "simpleString":
      return reply.value;
    case "integer":
      return reply.value;
    case "bulkString":
      return reply.value;
    case "array":
      return reply.value?.map((value) => respReplyToValue(value)) ?? null;
    case "error":
      throw new Error("RESP error replies cannot be converted into queue payloads");
  }
}

function finalizeQueuePayload(source: CliproxyUsageQueueResultSource, payload: unknown): CliproxyUsageQueueSuccessResult {
  const parsed = parseUsageQueuePayload(payload);
  return {
    ok: true,
    source,
    records: parsed.events,
    warnings: recordWarnings(source, parsed.warnings)
  };
}

function normalizeRespQueueReply(reply: RespReply): CliproxyUsageQueueResult {
  if (reply.type === "error") {
    const classification = classifyRespError(reply.message);
    return failureResult("resp", classification.kind, classification.code, reply.message);
  }

  switch (reply.type) {
    case "bulkString":
    case "array":
    case "simpleString":
      return finalizeQueuePayload("resp", respReplyToValue(reply));
    case "integer":
      return failureResult("resp", "protocol", "resp-unexpected-integer", "Unexpected RESP integer queue reply");
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class RespParser {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  get bufferedByteLength() {
    return this.buffer.length;
  }

  push(chunk: Buffer | string) {
    const nextChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    this.buffer = this.buffer.length === 0 ? nextChunk : Buffer.concat([this.buffer, nextChunk]);

    const replies: RespReply[] = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      const parsed = parseRespReply(this.buffer, offset);
      if (!parsed) break;
      replies.push(parsed.reply);
      offset = parsed.nextOffset;
    }

    this.buffer = offset === 0 ? this.buffer : this.buffer.subarray(offset);
    return replies;
  }
}

export function encodeRespAuthCommand(managementKey: string) {
  return encodeRespCommand(["AUTH", managementKey]);
}

export function encodeRespLpopCommand(count: number) {
  const size = toPositiveInt(count, config.cliproxy.usageQueue.batchSize);
  return encodeRespCommand(["LPOP", "queue", String(size)]);
}

export async function fetchCliproxyUsageQueueWithHttp(
  options: CliproxyUsageQueueClientOptions = {}
): Promise<CliproxyUsageQueueResult> {
  const resolved = resolveOptions(options);
  if (!resolved.baseUrl) {
    return failureResult("http-usage-queue", "protocol", "http-missing-base-url", "CLIProxy management base URL is missing");
  }
  if (!resolved.managementKey) {
    return failureResult("http-usage-queue", "auth", "http-missing-management-key", "CLIProxy management key is missing");
  }

  const endpoint = `${resolved.baseUrl.replace(/\/$/, "")}/usage-queue?count=${resolved.batchSize}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(resolved.fetch, endpoint, {
      headers: {
        Authorization: `Bearer ${resolved.managementKey}`,
        "Content-Type": "application/json"
      },
      cache: "no-store"
    }, resolved.timeoutMs);
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return failureResult(
      "http-usage-queue",
      isTimeout ? "timeout" : "protocol",
      isTimeout ? "http-timeout" : "http-request-failed",
      isTimeout ? "HTTP usage queue request timed out" : "HTTP usage queue request failed"
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failureResult("http-usage-queue", "auth", "http-auth-failed", "HTTP usage queue authentication failed", response.status);
  }

  if (response.status === 404) {
    return failureResult("http-usage-queue", "unsupported", "http-unsupported", "HTTP usage queue endpoint is unsupported", response.status);
  }

  if (!response.ok) {
    return failureResult(
      "http-usage-queue",
      "protocol",
      "http-bad-status",
      `HTTP usage queue request failed with status ${response.status}`,
      response.status
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failureResult("http-usage-queue", "protocol", "http-invalid-json", "HTTP usage queue returned invalid JSON");
  }

  if (!Array.isArray(payload)) {
    return failureResult("http-usage-queue", "protocol", "http-invalid-payload", "HTTP usage queue must return an array payload");
  }

  return finalizeQueuePayload("http-usage-queue", payload);
}

export async function fetchCliproxyUsageQueueWithResp(
  options: CliproxyUsageQueueClientOptions = {}
): Promise<CliproxyUsageQueueResult> {
  const resolved = resolveOptions(options);
  if (!resolved.serviceBaseUrl) {
    return failureResult("resp", "protocol", "resp-missing-service-url", "CLIProxy service URL is missing");
  }
  if (!resolved.managementKey) {
    return failureResult("resp", "auth", "resp-missing-management-key", "CLIProxy management key is missing");
  }

  const serviceUrl = new URL(resolved.serviceBaseUrl);
  const port = serviceUrl.port ? Number.parseInt(serviceUrl.port, 10) : serviceUrl.protocol === "https:" ? 443 : 80;
  const parser = new RespParser();
  const commands = Buffer.concat([
    encodeRespAuthCommand(resolved.managementKey),
    encodeRespLpopCommand(resolved.batchSize)
  ]);

  return await new Promise<CliproxyUsageQueueResult>((resolve) => {
    let settled = false;
    const replies: RespReply[] = [];

    const settle = (result: CliproxyUsageQueueResult, socket: net.Socket | tls.TLSSocket) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = serviceUrl.protocol === "https:"
      ? resolved.tlsConnect({
          host: serviceUrl.hostname,
          port,
          servername: serviceUrl.hostname
        })
      : resolved.netConnect({
          host: serviceUrl.hostname,
          port
        });

    socket.setTimeout(resolved.timeoutMs);
    socket.once("timeout", () => {
      settle(failureResult("resp", "timeout", "resp-timeout", "RESP usage queue request timed out"), socket);
    });
    socket.once("error", () => {
      settle(failureResult("resp", "protocol", "resp-connection-error", "RESP usage queue connection failed"), socket);
    });
    socket.once("close", () => {
      if (!settled) {
        settle(
          failureResult("resp", "protocol", "resp-incomplete-reply", "RESP usage queue connection closed before a full reply was received"),
          socket
        );
      }
    });
    socket.on("data", (chunk) => {
      if (settled) return;

      try {
        replies.push(...parser.push(chunk));
      } catch (error) {
        const message = error instanceof Error ? error.message : "RESP parser failure";
        settle(failureResult("resp", "protocol", "resp-parser-error", message), socket);
        return;
      }

      if (replies.length < 2) return;

      const [authReply, queueReply] = replies;
      if (authReply.type === "error") {
        const classification = classifyRespError(authReply.message);
        settle(failureResult("resp", classification.kind, classification.code, authReply.message), socket);
        return;
      }

      if (authReply.type !== "simpleString" || authReply.value.toUpperCase() !== "OK") {
        settle(
          failureResult("resp", "protocol", "resp-auth-unexpected-reply", "RESP AUTH returned an unexpected reply"),
          socket
        );
        return;
      }

      settle(normalizeRespQueueReply(queueReply), socket);
    });

    if (serviceUrl.protocol === "https:") {
      socket.once("secureConnect", () => {
        socket.write(commands);
      });
      return;
    }

    socket.once("connect", () => {
      socket.write(commands);
    });
  });
}
