import { describe, expect, it, vi } from "vitest";

import {
  encodeRespAuthCommand,
  encodeRespLpopCommand,
  fetchCliproxyUsageQueueWithHttp,
  RespParser
} from "@/lib/cliproxy-usage-queue";

describe("lib/cliproxy-usage-queue RESP parser", () => {
  it("emits valid RESP arrays for AUTH and LPOP queue commands", () => {
    expect(encodeRespAuthCommand("mgmt-key").toString("utf8")).toBe(
      "*2\r\n$4\r\nAUTH\r\n$8\r\nmgmt-key\r\n"
    );
    expect(encodeRespLpopCommand(12).toString("utf8")).toBe(
      "*3\r\n$4\r\nLPOP\r\n$5\r\nqueue\r\n$2\r\n12\r\n"
    );
  });

  it("parses chunk-split bulk strings, nil bulk strings, empty arrays, and error replies", () => {
    const payload = '{"request_id":"req-123"}';
    const parser = new RespParser();
    const reply = [
      "+OK\r\n",
      `$${Buffer.byteLength(payload, "utf8")}\r\n${payload}\r\n`,
      "$-1\r\n",
      "*0\r\n",
      "-ERR unsupported\r\n",
      ":42\r\n"
    ].join("");
    const chunks = [reply.slice(0, 9), reply.slice(9, 21), reply.slice(21, 33), reply.slice(33)];

    const replies = chunks.flatMap((chunk) => parser.push(chunk));

    expect(replies).toEqual([
      { type: "simpleString", value: "OK" },
      { type: "bulkString", value: payload },
      { type: "bulkString", value: null },
      { type: "array", value: [] },
      { type: "error", message: "ERR unsupported" },
      { type: "integer", value: 42 }
    ]);
    expect(parser.bufferedByteLength).toBe(0);
  });
});

describe("lib/cliproxy-usage-queue HTTP usage-queue", () => {
  it("treats HTTP 200 empty arrays as successful empty queue reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await fetchCliproxyUsageQueueWithHttp({
      baseUrl: "https://queue.example.com/v0/management",
      managementKey: "mgmt-secret",
      batchSize: 7,
      timeoutMs: 1_000,
      fetch: fetchMock
    });

    expect(result).toEqual({
      ok: true,
      source: "http-usage-queue",
      records: [],
      warnings: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://queue.example.com/v0/management/usage-queue?count=7");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        Authorization: "Bearer mgmt-secret",
        "Content-Type": "application/json"
      }
    });
  });

  it("classifies HTTP 401 and 403 as auth failures without leaking credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("forbidden", { status: 401 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    const unauthorized = await fetchCliproxyUsageQueueWithHttp({
      baseUrl: "https://queue.example.com/v0/management",
      managementKey: "mgmt-secret",
      fetch: fetchMock
    });
    const forbidden = await fetchCliproxyUsageQueueWithHttp({
      baseUrl: "https://queue.example.com/v0/management",
      managementKey: "mgmt-secret",
      fetch: fetchMock
    });

    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) throw new Error("expected unauthorized failure");
    expect(unauthorized.failure).toMatchObject({ kind: "auth", code: "http-auth-failed", status: 401 });
    expect(JSON.stringify(unauthorized)).not.toContain("mgmt-secret");

    expect(forbidden.ok).toBe(false);
    if (forbidden.ok) throw new Error("expected forbidden failure");
    expect(forbidden.failure).toMatchObject({ kind: "auth", code: "http-auth-failed", status: 403 });
    expect(JSON.stringify(forbidden)).not.toContain("mgmt-secret");
  });

  it("classifies HTTP 404 as unsupported and AbortError as timeout", async () => {
    const timeoutError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetch404 = vi.fn<typeof fetch>().mockResolvedValue(new Response("missing", { status: 404 }));
    const fetchTimeout = vi.fn<typeof fetch>().mockRejectedValue(timeoutError);

    const unsupported = await fetchCliproxyUsageQueueWithHttp({
      baseUrl: "http://queue.example.com/v0/management",
      managementKey: "mgmt-secret",
      fetch: fetch404
    });
    const timeout = await fetchCliproxyUsageQueueWithHttp({
      baseUrl: "http://queue.example.com/v0/management",
      managementKey: "mgmt-secret",
      fetch: fetchTimeout,
      timeoutMs: 25
    });

    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) throw new Error("expected unsupported failure");
    expect(unsupported.failure).toMatchObject({ kind: "unsupported", code: "http-unsupported", status: 404 });

    expect(timeout.ok).toBe(false);
    if (timeout.ok) throw new Error("expected timeout failure");
    expect(timeout.failure).toMatchObject({ kind: "timeout", code: "http-timeout" });
  });
});
