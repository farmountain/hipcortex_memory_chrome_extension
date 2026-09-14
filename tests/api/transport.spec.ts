/**
 * The HTTP transport and the transport factory (tasks 4.3–4.6, 4.10–4.12, 4.16–4.18, 4.20).
 *
 * The load-bearing assertions in this file are about **requests that must not happen**:
 *
 * - a 404 must not advance to a second endpoint, because the ladder is gone;
 * - a refused remote host must produce zero requests;
 * - `consumer` mode must not fall back to HTTP;
 * - a provider filter must not be smuggled into the semantic path.
 *
 * Response-shape cases are grounded in what the live 3.11.0 runtime actually returned
 * (`{records,total}` from `/memory/query`, `{results:[{score,record}]}` from `/memory/search`), not
 * in the protocol document's prose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION, CAPTURE_RECORD_TYPE, CAPTURE_SOURCE, RESERVED_PROVENANCE_KEY } from "../../src/schema/index.js";
import { NATIVE_HOST } from "../../src/api/transport/native.js";
import { HttpTransport } from "../../src/api/transport/http.js";
import { createTransport } from "../../src/api/transport/factory.js";
import { isLoopbackUrl, toAddBody } from "../../src/api/transport/endpoints.js";
import type { TransportMode } from "../../src/api/transport/types.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { MemoryRecord } from "../../src/types/index.js";
import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { installNativeHost } from "../helpers/chrome-mock.js";
import { installFetchMock } from "../helpers/http.js";
import { expectAcknowledged, expectUnacknowledged } from "../helpers/transport.js";
import { scanSource } from "../helpers/scan.js";

const BASE = "http://127.0.0.1:3030";
const CAPTURE_URL = `${BASE}/memory/add`;

const RECORD: MemoryRecord = { actor: "browser-user", action: "selected", target: "hello" };

function http(apiKey = "", mode: TransportMode = "developer"): HttpTransport {
  return new HttpTransport(BASE, apiKey, mode);
}

function captured(provider: string, id = `${provider}-1`): Record<string, unknown> {
  return {
    id,
    actor: "browser-user",
    action: `capture:${provider}`,
    record_type: CAPTURE_RECORD_TYPE,
    source: CAPTURE_SOURCE,
    target: "MARKER-TRANSCRIPT-TEXT-DO-NOT-ASSERT-ON",
    tags: ["capture", provider],
    metadata: {
      [RESERVED_PROVENANCE_KEY]: {
        schemaVersion: SCHEMA_VERSION,
        provider,
        adapterVersion: "1.0.0",
        source: CAPTURE_SOURCE,
        conversationUrl: "https://example.test/c/1",
        eventId: "event-1",
        capturedAt: "2025-01-01T00:00:00.000Z",
      },
    },
  };
}

/** A record that is not a capture: no reserved metadata object at all. */
function nonCapture(): Record<string, unknown> {
  return {
    id: "summary-1",
    actor: "browser-user",
    action: "capture-summary",
    record_type: "Semantic",
    target: "a summary derived from captures",
    metadata: {},
  };
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HttpTransport.health()", () => {
  it("accepts the plain `ok` body and asks for /health once", async () => {
    const recorder = installFetchMock(() => ({ text: "ok" }));

    expect(await http().health()).toEqual({ status: "ok", healthy: true });
    expect(recorder.urls()).toEqual([`${BASE}/health`]);
  });

  it("accepts the JSON health body the runtime serves", async () => {
    installFetchMock(() => ({
      body: { service: "hipcortex", status: "ok", version: "3.11.0" },
    }));

    expect(await http().health()).toEqual({
      status: "ok",
      service: "hipcortex",
      version: "3.11.0",
      tier: undefined,
      healthy: true,
    });
  });

  it("reports a 404 as unhealthy without advancing to any other endpoint", async () => {
    const recorder = installFetchMock(() => ({ status: 404, body: { detail: "Not Found" } }));

    const health = await http().health();

    expect(health.healthy).toBe(false);
    expect(health.status).toBe("HTTP 404");
    // The historical client walked a ladder here. One request is the assertion that it no longer
    // does: a 404 is now honest instead of being read as "try the next rung".
    expect(recorder.requests).toHaveLength(1);
  });

  it("reports an unreachable runtime as unhealthy rather than throwing", async () => {
    installFetchMock(() => ({ networkError: "connect ECONNREFUSED 127.0.0.1:3030" }));

    const health = await http().health();

    expect(health.healthy).toBe(false);
    expect(health.status).toContain("unreachable");
  });

  it("sends auth headers only when an API key is configured", async () => {
    let recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));
    await http("secret").addMemory(RECORD);
    expect(recorder.requests[0].headers["Authorization"]).toBe("Bearer secret");
    expect(recorder.requests[0].headers["X-API-Key"]).toBe("secret");

    recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));
    await http().addMemory(RECORD);
    expect(recorder.requests[0].headers).not.toHaveProperty("Authorization");
    expect(recorder.requests[0].headers).not.toHaveProperty("X-API-Key");
  });
});

describe("capture egress", () => {
  it("posts to /memory/add and to nothing else", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    await http().addMemory(RECORD);

    expect(recorder.requests).toHaveLength(1);
    expect(recorder.urlOf(0)).toBe(CAPTURE_URL);
    expect(recorder.requests[0].method).toBe("POST");
  });

  it("sends the verified add body and never a TTL", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    await http().addMemory({
      actor: "u",
      action: "capture:chatgpt",
      target: "transcript",
      metadata: { a: 1 },
      record_type: CAPTURE_RECORD_TYPE,
      source: CAPTURE_SOURCE,
      tags: ["capture", "chatgpt"],
    });

    expect(recorder.requests[0].json).toEqual({
      actor: "u",
      action: "capture:chatgpt",
      target: "transcript",
      metadata: { a: 1 },
      record_type: CAPTURE_RECORD_TYPE,
      source: CAPTURE_SOURCE,
      tags: ["capture", "chatgpt"],
    });
    // Omitting ttl_seconds is what yields `expires_at: null`. Emitting one would create a capture
    // that looks successful and is deleted later.
    expect(recorder.requests[0].body).not.toMatch(/ttl|expires/i);
  });

  it("never references a superseded capture path, in source or in a request", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    await http().addMemory(RECORD);

    const attempted = recorder.urls().join(" ");
    expect(attempted).not.toContain("/memory/ingest");
    expect(attempted).not.toContain("/v1/memory");
    expect(scanSource().filter((file) => file.content.includes("/memory/ingest"))).toEqual([]);
  });

  it("omits optional fields that were not supplied", () => {
    expect(toAddBody(RECORD)).toEqual({
      actor: "browser-user",
      action: "selected",
      target: "hello",
      metadata: {},
    });
  });
});

describe("positive acknowledgement", () => {
  it("is acknowledged by success plus a non-empty record_id", async () => {
    installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    const result = expectAcknowledged(await http().addMemory(RECORD));

    expect(result.recordId).toBe("r1");
    expect(result.transport).toBe("http");
  });

  it("is NOT acknowledged by a bare 2xx, which is the failure the old client could not see", async () => {
    installFetchMock(() => ({ status: 200, body: { success: true } }));

    const result = expectUnacknowledged(await http().addMemory(RECORD));

    expect(result.reason).toBe("NOT_ACKNOWLEDGED");
    expect(result.detail).toContain("no record_id");
  });

  it("is NOT acknowledged by a whitespace-only record_id", async () => {
    installFetchMock(() => ({ body: { success: true, record_id: "   " } }));

    expect(expectUnacknowledged(await http().addMemory(RECORD)).reason).toBe("NOT_ACKNOWLEDGED");
  });

  it("is NOT acknowledged when the reply reports failure", async () => {
    installFetchMock(() => ({ body: { success: false, record_id: "r1" } }));

    expect(expectUnacknowledged(await http().addMemory(RECORD)).reason).toBe("NOT_ACKNOWLEDGED");
  });

  it("is NOT acknowledged when the reply is not a JSON object", async () => {
    installFetchMock(() => ({ text: "ok" }));

    expect(expectUnacknowledged(await http().addMemory(RECORD)).reason).toBe("MALFORMED_RESPONSE");
  });

  it("still succeeds when the runtime returns a duplicate warning, and drops the warning's target", async () => {
    installFetchMock(() => ({
      body: {
        success: true,
        record_id: "r1",
        warning: [
          {
            action: "duplicate",
            id: "old-1",
            overlap_ratio: 0.94,
            target: "MARKER-SECRET-TRANSCRIPT-TEXT",
          },
        ],
      },
    }));

    const result = expectAcknowledged(await http().addMemory(RECORD));

    expect(result.warning).toEqual([{ action: "duplicate", id: "old-1", overlapRatio: 0.94 }]);
    expect(JSON.stringify(result)).not.toContain("MARKER-SECRET-TRANSCRIPT-TEXT");
  });

  it("reports an HTTP error status as HTTP_ERROR and an unreachable runtime as UNREACHABLE", async () => {
    installFetchMock(() => ({ status: 500, body: { detail: "boom" } }));
    expect(expectUnacknowledged(await http().addMemory(RECORD)).reason).toBe("HTTP_ERROR");

    installFetchMock(() => ({ networkError: "connect ECONNREFUSED" }));
    expect(expectUnacknowledged(await http().addMemory(RECORD)).reason).toBe("UNREACHABLE");
  });

  it("makes exactly one attempt and reports the failure rather than throwing", async () => {
    const recorder = installFetchMock(() => ({ networkError: "connect ECONNREFUSED 127.0.0.1:3030" }));

    const result = expectUnacknowledged(await http().addMemory(RECORD));

    expect(result.detail).toContain(CAPTURE_URL);
    expect(recorder.requests).toHaveLength(1);
  });
});

describe("transport mode resolution", () => {
  it("defaults to auto", () => {
    expect(DEFAULT_SETTINGS.transportMode).toBe("auto");
  });

  it("developer mode uses HTTP and never touches native", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    const result = expectAcknowledged(
      await createTransport({ ...DEFAULT_SETTINGS, transportMode: "developer" }).addMemory(RECORD)
    );

    expect(result.transport).toBe("http");
    expect(recorder.requests).toHaveLength(1);
    expect(mock.runtime.connectNative).not.toHaveBeenCalled();
  });

  it("consumer mode uses native only and never falls back to HTTP", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));
    installNativeHost(mock, { lastErrorMessage: "Specified native messaging host not found." });

    const result = expectUnacknowledged(
      await createTransport({ ...DEFAULT_SETTINGS, transportMode: "consumer" }).addMemory(RECORD)
    );

    expect(result.reason).toBe("HOST_UNAVAILABLE");
    expect(recorder.requests).toHaveLength(0);
  });

  it("auto mode prefers native when the host is present", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "http" } }));
    installNativeHost(mock, { reply: { success: true, record_id: "native-host-1" } });

    const result = expectAcknowledged(await createTransport(DEFAULT_SETTINGS).addMemory(RECORD));

    expect(result.transport).toBe("native");
    expect(result.recordId).toBe("native-host-1");
    expect(recorder.requests).toHaveLength(0);
  });

  it("auto mode falls back to HTTP when the host is absent, and reports that it did", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));
    installNativeHost(mock, { lastErrorMessage: "Specified native messaging host not found." });
    const transport = createTransport(DEFAULT_SETTINGS);

    const resolution = await transport.resolve();
    expect(resolution).toMatchObject({ mode: "auto", active: "http", fellBack: true });
    expect(resolution.detail).toContain(NATIVE_HOST);
    expect(resolution.detail).toContain("/memory/add");

    expect(expectAcknowledged(await transport.addMemory(RECORD)).transport).toBe("http");
    expect(recorder.requests).toHaveLength(1);
  });

  it("auto mode does not re-send over HTTP when the host answered and refused — a duplicate is not a fix", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "http" } }));
    installNativeHost(mock, { reply: { success: false } });

    const result = expectUnacknowledged(await createTransport(DEFAULT_SETTINGS).addMemory(RECORD));

    expect(result.transport).toBe("native");
    expect(result.reason).toBe("NOT_ACKNOWLEDGED");
    expect(recorder.requests).toHaveLength(0);
  });
});

describe("non-loopback refusal", () => {
  it("classifies loopback exactly, and does not mistake 0.0.0.0 for local", () => {
    expect(isLoopbackUrl("http://127.0.0.1:3030")).toBe(true);
    expect(isLoopbackUrl("http://127.9.9.9:1")).toBe(true);
    expect(isLoopbackUrl("http://localhost:3030")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3030")).toBe(true);
    expect(isLoopbackUrl("http://0.0.0.0:3030")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.10:3030")).toBe(false);
    expect(isLoopbackUrl("https://memory.example.com")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("refuses a remote base URL in auto and consumer, names the host, and makes no request", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));
    const remote = { ...DEFAULT_SETTINGS, apiUrl: "https://memory.example.com" };

    for (const mode of ["auto", "consumer"] as const) {
      const transport = createTransport({ ...remote, transportMode: mode });

      const result = expectUnacknowledged(await transport.addMemory(RECORD));
      expect(result.reason).toBe("REMOTE_HOST_REFUSED");
      expect(result.detail).toContain("memory.example.com");
      expect(result.transport).toBe("refused");

      expect(await transport.resolve()).toMatchObject({ mode, active: "refused", fellBack: false });
      await expect(transport.search("q")).rejects.toThrow(/memory\.example\.com/);
      await expect(transport.queryStructured()).rejects.toThrow(/memory\.example\.com/);
      expect((await transport.health()).healthy).toBe(false);
    }

    expect(recorder.requests).toHaveLength(0);
    expect(mock.runtime.connectNative).not.toHaveBeenCalled();
  });

  it("allows a remote base URL only in developer mode, where the user chose it", async () => {
    const recorder = installFetchMock(() => ({ body: { success: true, record_id: "r1" } }));

    const result = expectAcknowledged(
      await createTransport({
        ...DEFAULT_SETTINGS,
        apiUrl: "https://memory.example.com",
        transportMode: "developer",
      }).addMemory(RECORD)
    );

    expect(result.recordId).toBe("r1");
    expect(recorder.urlOf(0)).toBe("https://memory.example.com/memory/add");
  });
});

describe("semantic search path", () => {
  it("unwraps {score, record} into a record with a discrete score", async () => {
    installFetchMock(() => ({
      body: { results: [{ score: 0.87, record: captured("chatgpt", "r1") }] },
    }));

    const result = await http().search("prompt");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].score).toBe(0.87);
    expect(result.results[0].id).toBe("r1");
    expect(result.results[0].actor).toBe("browser-user");
    expect(result.results[0]).not.toHaveProperty("record");
    expect(result.query).toBe("prompt");
  });

  it("sends only query and limit — the endpoint has no filter field", async () => {
    const recorder = installFetchMock(() => ({ body: { results: [] } }));

    await http().search("prompt", { limit: 3 });

    expect(recorder.requests[0].json).toEqual({ query: "prompt", limit: 3 });
    expect(recorder.urlOf(0)).toBe(`${BASE}/memory/search`);
  });

  it("reports the limitation instead of implying the results are provider-scoped", async () => {
    const recorder = installFetchMock(() => ({ body: { results: [] } }));

    const result = await http().search("prompt", { providerFilter: "chatgpt" });

    expect(result.limitation).toContain("no filter field");
    expect(result.limitation).toContain("chatgpt");
    // The filter must not be smuggled into the request: the runtime would ignore it, and a request
    // that looks filtered but is not is worse than no filter at all.
    expect(JSON.stringify(recorder.requests[0].json)).not.toContain("chatgpt");
  });

  it("raises a typed error when a member has no record", async () => {
    installFetchMock(() => ({ body: { results: [{ score: 0.5 }] } }));

    await expect(http().search("q")).rejects.toMatchObject({
      name: "TransportError",
      reason: "MALFORMED_RESPONSE",
    });
  });

  it("raises a typed error when the response carries no results array at all", async () => {
    installFetchMock(() => ({ body: { total: 0 } }));

    await expect(http().search("q")).rejects.toMatchObject({ reason: "MALFORMED_RESPONSE" });
  });
});

describe("structured read path", () => {
  it("resolves a provider filter to both server-side dimensions", async () => {
    const recorder = installFetchMock(() => ({ body: { records: [], total: 0 } }));

    await http().queryStructured({ providerFilter: "chatgpt", limit: 5 });

    const request = recorder.requests[0];
    expect(request.url.startsWith(`${BASE}/memory/query?`)).toBe(true);
    expect(request.method).toBe("GET");
    expect(request.params.get("action")).toBe("capture:chatgpt");
    expect(request.params.get("record_type")).toBe(CAPTURE_RECORD_TYPE);
    expect(request.params.get("limit")).toBe("5");
  });

  it("transmits actor, action and record_type without a provider filter", async () => {
    const recorder = installFetchMock(() => ({ body: { records: [], total: 0 } }));

    await http().queryStructured({ actor: "browser-user", action: "selected", recordType: "Temporal" });

    expect(recorder.requests[0].params.get("actor")).toBe("browser-user");
    expect(recorder.requests[0].params.get("action")).toBe("selected");
    expect(recorder.requests[0].params.get("record_type")).toBe("Temporal");
  });

  it("passes as_of through for time-travel reads", async () => {
    const recorder = installFetchMock(() => ({ body: { records: [], total: 0 } }));

    await http().queryStructured({ asOf: "2025-01-01T00:00:00.000Z" });

    expect(recorder.requests[0].params.get("as_of")).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns an empty-but-successful result for a provider with no captures", async () => {
    installFetchMock(() => ({ body: { records: [], total: 0 } }));

    const result = await http().queryStructured({ providerFilter: "deepseek" });

    expect(result.results).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.limitation).toBeUndefined();
  });

  it("excludes other providers' records and reports that it had to", async () => {
    installFetchMock(() => ({
      body: { records: [captured("chatgpt"), captured("claude"), nonCapture()], total: 3 },
    }));

    const result = await http().queryStructured({ providerFilter: "chatgpt" });

    expect(result.results.map((record) => record.provider)).toEqual(["chatgpt"]);
    expect(result.count).toBe(1);
    expect(result.limitation).toContain("outside provider");
    expect(result.limitation).toContain("chatgpt");
  });

  it("raises a typed error when the response carries no records array", async () => {
    installFetchMock(() => ({ body: { total: 0 } }));

    await expect(http().queryStructured()).rejects.toMatchObject({ reason: "MALFORMED_RESPONSE" });
  });

  it("raises a typed error on a non-2xx status", async () => {
    installFetchMock(() => ({ status: 404, body: { detail: "Not Found" } }));

    await expect(http().queryStructured()).rejects.toMatchObject({ reason: "HTTP_ERROR" });
  });
});

describe("provider provenance on the read path", () => {
  it("exposes provider as a discrete field on both paths, and omits it for non-captures", async () => {
    installFetchMock(() => ({ body: { records: [captured("chatgpt"), nonCapture()] } }));
    const structured = await http().queryStructured();

    expect(structured.results[0].provider).toBe("chatgpt");
    expect(structured.results[1].provider).toBeUndefined();

    installFetchMock(() => ({
      body: { results: [{ score: 1, record: captured("grok") }, { score: 0.2, record: nonCapture() }] },
    }));
    const semantic = await http().search("q");

    expect(semantic.results[0].provider).toBe("grok");
    expect(semantic.results[1].provider).toBeUndefined();
  });

  it("returns the record's timestamp and id untouched, so a surface can sort and link", async () => {
    installFetchMock(() => ({
      body: { records: [{ ...captured("gemini", "g1"), timestamp: "2025-01-01T00:00:00.000Z", expires_at: null }] },
    }));

    const result = await http().queryStructured({ providerFilter: "gemini" });

    expect(result.results[0]).toMatchObject({
      id: "g1",
      timestamp: "2025-01-01T00:00:00.000Z",
      expires_at: null,
      provider: "gemini",
    });
  });
});
