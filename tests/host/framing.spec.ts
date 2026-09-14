/**
 * The native messaging host's wire behaviour — G9.1, and `docs/PROTOCOL.md` §9.
 *
 * §9 has said since it was written that the Consumer Mode envelope is "assumed, not verified",
 * because no host existed to verify it against. These specs exercise the host directly, which
 * makes the envelope executable. What they do **not** do is prove Chrome itself connects to a
 * registered host — that is `tests/host/registration.spec.ts` and, finally, the manual step
 * recorded in `docs/END-STATE.md`.
 *
 * `forwardToCore` is tested against a real HTTP server on loopback rather than a stubbed `fetch`.
 * The failure this guards against is not "the function calls fetch" but "the reply the core
 * actually sends is not the shape `interpretAcknowledgement` parses" — and a stub would encode the
 * same assumption the code already makes, so it could never catch that.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFrameReader,
  DEFAULT_CORE_URL,
  encodeMessage,
  forwardToCore,
  handleRequest,
  HEALTH_REQUEST_TYPE,
  isHealthRequest,
  isLoopbackUrl,
  probeCore,
  resolveCoreUrl,
} from "../../host/bridge-host.mjs";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

/** A loopback core that replies with whatever the test tells it to. */
async function startCore(reply: { status: number; body: string }): Promise<{
  url: string;
  bodies: string[];
  paths: string[];
}> {
  const bodies: string[] = [];
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      bodies.push(raw);
      response.writeHead(reply.status, { "Content-Type": "application/json" });
      response.end(reply.body);
    });
  });

  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies, paths };
}

describe("core health probe", () => {
  it("tells a probe apart from a capture body", () => {
    expect(isHealthRequest({ type: HEALTH_REQUEST_TYPE })).toBe(true);
    expect(isHealthRequest({ actor: "u", action: "captured", target: "t", metadata: {} })).toBe(false);
    expect(isHealthRequest(null)).toBe(false);
    expect(isHealthRequest("health")).toBe(false);
  });

  it("reads the core over GET and writes nothing to it", async () => {
    const core = await startCore({ status: 200, body: '{"status":"ok"}' });
    const reply = await probeCore(core.url);

    expect(reply).toMatchObject({ success: true, healthy: true, core_url: core.url });
    expect(core.paths).toEqual(["/health"]);
    // A health check that captures something is not a health check (G9.1).
    expect(core.bodies).toEqual([""]);
  });

  it("reports an unhealthy core by its status instead of throwing", async () => {
    const core = await startCore({ status: 503, body: "{}" });
    const reply = await probeCore(core.url);

    expect(reply).toMatchObject({ success: true, healthy: false, detail: "HTTP 503" });
  });

  it("reports a stopped core as a state, naming the URL it tried", async () => {
    const reply = await probeCore("http://127.0.0.1:9", 200);

    expect(reply.success).toBe(false);
    expect(reply.healthy).toBe(false);
    expect(String(reply.detail)).toContain("127.0.0.1:9");
  });

  it("refuses a non-loopback probe rather than asking it", async () => {
    const reply = await probeCore("http://example.com");

    expect(reply).toMatchObject({ success: false, healthy: false });
    expect(String(reply.detail)).toMatch(/non-loopback/);
  });

  it("routes a probe and a capture down different core paths", async () => {
    const core = await startCore({ status: 200, body: '{"success":true,"record_id":"r1"}' });
    const frames: Buffer[] = [];

    await handleRequest({ type: HEALTH_REQUEST_TYPE }, core.url, (frame: Buffer) => frames.push(frame));
    await handleRequest(
      { actor: "u", action: "captured", target: "t", metadata: {} },
      core.url,
      (frame: Buffer) => frames.push(frame)
    );

    expect(core.paths).toEqual(["/health", "/memory/add"]);
    const decoded = frames.map((frame) => JSON.parse(frame.subarray(4).toString("utf8")));
    expect(decoded[0]).toMatchObject({ success: true, healthy: true });
    expect(decoded[1]).toMatchObject({ success: true, record_id: "r1" });
  });

  it("refuses an unknown control type instead of posting it to the core", async () => {
    // Found by running the installed host against the live core: an unknown type was forwarded to
    // POST /memory/add, the core answered 422, and the reply blamed the core's response body. Safe,
    // but it pointed at the wrong repository. A capture body never carries `type`, so a `type` is
    // always a control message and an unrecognised one is this host's gap.
    const core = await startCore({ status: 422, body: "(Validation error)" });
    const frames: Buffer[] = [];

    await handleRequest({ type: "not-a-real-request" }, core.url, (frame: Buffer) => frames.push(frame));

    expect(core.paths).toEqual([]);
    const decoded = JSON.parse(frames[0]!.subarray(4).toString("utf8"));
    expect(decoded.success).toBe(false);
    expect(String(decoded.error)).toContain("not-a-real-request");
    expect(String(decoded.error)).toContain("Nothing was sent to the core");
  });
});

describe("native messaging framing", () => {
  it("prefixes the payload with a little-endian uint32 length", () => {
    const frame = encodeMessage({ a: 1 });
    const json = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
    expect(frame.readUInt32LE(0)).toBe(json.length);
    expect(frame.subarray(4).toString("utf8")).toBe(json.toString("utf8"));
  });

  it("round-trips a message through the reader", () => {
    const reader = createFrameReader();
    expect(reader.push(encodeMessage({ action: "add" }))).toEqual([{ action: "add" }]);
  });

  it("reassembles a message split across arbitrary chunk boundaries", () => {
    // stdio delivers bytes, not messages. A reader that assumes one chunk per message works in
    // every test that writes a whole frame at once and fails on a real machine under load.
    const reader = createFrameReader();
    const frame = encodeMessage({ hello: "world", nested: { n: 42 } });

    const delivered: unknown[] = [];
    for (const byte of frame) delivered.push(...reader.push(Buffer.from([byte])));

    expect(delivered).toEqual([{ hello: "world", nested: { n: 42 } }]);
  });

  it("returns two messages when two frames arrive in one chunk", () => {
    const reader = createFrameReader();
    const combined = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 })]);
    expect(reader.push(combined)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("holds a partial frame rather than emitting it", () => {
    const reader = createFrameReader();
    const frame = encodeMessage({ partial: true });
    expect(reader.push(frame.subarray(0, 3))).toEqual([]);
  });
});

describe("loopback refusal mirrors the extension's rule — G7.2", () => {
  it("accepts localhost, 127.0.0.0/8 and ::1", () => {
    for (const url of ["http://localhost:3030", "http://127.0.0.1:3030", "http://127.9.9.9:3030", "http://[::1]:3030"]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
  });

  it("refuses a remote host and 0.0.0.0", () => {
    // `0.0.0.0` is a bind address meaning "every interface", not a local address.
    for (const url of ["http://example.com", "http://10.0.0.5:3030", "http://0.0.0.0:3030"]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });

  it("refuses to forward a capture to a non-loopback core", async () => {
    const reply = await forwardToCore({ actor: "a", action: "b", target: "c" }, "http://example.com");
    expect(reply.success).toBe(false);
    expect(String(reply.error)).toMatch(/non-loopback/i);
  });
});

describe("forwarding a capture to the core", () => {
  it("posts the add body and passes the acknowledgement through unchanged", async () => {
    const core = await startCore({ status: 200, body: JSON.stringify({ success: true, record_id: "rec-1" }) });
    const reply = await forwardToCore({ actor: "hipcortex-chatgpt", action: "captured", target: "t" }, core.url);

    expect(reply).toEqual({ success: true, record_id: "rec-1" });
    expect(core.bodies).toHaveLength(1);
    expect(JSON.parse(core.bodies[0]!)).toEqual({ actor: "hipcortex-chatgpt", action: "captured", target: "t" });
  });

  it("passes a refusal through rather than inventing success", async () => {
    // A 2xx is not a delivery (docs/PROTOCOL.md §2). The core's verdict is the only one that counts.
    const core = await startCore({ status: 200, body: JSON.stringify({ success: false, error: "refused" }) });
    const reply = await forwardToCore({ actor: "a", action: "b", target: "c" }, core.url);
    expect(reply).toEqual({ success: false, error: "refused" });
  });

  it("reports a core that is down as an answer, not as a crash", async () => {
    // This is the distinction G9.1 depends on: a host that dies leaves Chrome reporting a
    // disconnect, which the extension cannot tell apart from "host not installed".
    const reply = await forwardToCore({ actor: "a", action: "b", target: "c" }, "http://127.0.0.1:1");
    expect(reply.success).toBe(false);
    expect(String(reply.error)).toMatch(/not reachable/i);
  });

  it("reports a non-JSON reply instead of throwing", async () => {
    const core = await startCore({ status: 502, body: "<html>gateway</html>" });
    const reply = await forwardToCore({ actor: "a", action: "b", target: "c" }, core.url);
    expect(reply.success).toBe(false);
    expect(String(reply.error)).toMatch(/not JSON/i);
  });
});

describe("core URL resolution", () => {
  it("defaults to the documented loopback URL", () => {
    // Asserted here rather than end-to-end on purpose: a spec that spawns the host with no override
    // posts to `127.0.0.1:3030`, which is a developer's live core, and would both depend on whether
    // they have it running and write a synthetic record into their real memory store.
    expect(resolveCoreUrl({})).toBe(DEFAULT_CORE_URL);
    expect(DEFAULT_CORE_URL).toBe("http://127.0.0.1:3030");
  });

  it("treats a blank override as absent rather than as a URL", () => {
    expect(resolveCoreUrl({ HIPCORTEX_CORE_URL: "" })).toBe(DEFAULT_CORE_URL);
    expect(resolveCoreUrl({ HIPCORTEX_CORE_URL: "   " })).toBe(DEFAULT_CORE_URL);
  });

  it("honours an explicit override and trims it", () => {
    expect(resolveCoreUrl({ HIPCORTEX_CORE_URL: "http://127.0.0.1:4123" })).toBe("http://127.0.0.1:4123");
    expect(resolveCoreUrl({ HIPCORTEX_CORE_URL: " http://127.0.0.1:4123 " })).toBe("http://127.0.0.1:4123");
  });
});
