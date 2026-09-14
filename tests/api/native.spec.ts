/**
 * `NativeTransport` (tasks 4.7, 4.8).
 *
 * Every case here exists because the *failure* of this transport must be indistinguishable from a
 * transport that was never configured. A missing host is the normal state for a user who has not
 * installed a desktop app, and it must surface as a typed result the queue can retain — never as a
 * thrown error that a caller might swallow into "delivered", and never as a bare rejection.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { NATIVE_HOST, NativeTransport } from "../../src/api/transport/native.js";
import type { MemoryRecord } from "../../src/types/index.js";
import { installChromeMock, installNativeHost } from "../helpers/chrome-mock.js";
import { expectAcknowledged, expectUnacknowledged } from "../helpers/transport.js";

const RECORD: MemoryRecord = { actor: "browser-user", action: "selected", target: "hello" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NativeTransport.addMemory()", () => {
  it("posts the add body to the host and reports the acknowledgement", async () => {
    const mock = installChromeMock();
    const ports = installNativeHost(mock, { reply: { success: true, record_id: "n1" } });

    const result = expectAcknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result).toEqual({
      acknowledged: true,
      transport: "native",
      recordId: "n1",
      warning: [],
    });
    expect(mock.runtime.connectNative).toHaveBeenCalledWith(NATIVE_HOST);
    expect(ports).toHaveLength(1);
    // The outbound envelope is asserted rather than assumed: this is the one place the assumed
    // native request shape is pinned down.
    expect(ports[0].received).toEqual([
      { actor: "browser-user", action: "selected", target: "hello", metadata: {} },
    ]);
  });

  it("releases the port after every operation", async () => {
    const mock = installChromeMock();
    const ports = installNativeHost(mock, { reply: { success: true, record_id: "n1" } });

    await new NativeTransport().addMemory(RECORD);

    expect(ports[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("treats success without a record_id as unacknowledged", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { reply: { success: true } });

    const result = expectUnacknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result.reason).toBe("NOT_ACKNOWLEDGED");
    expect(result.detail).toContain("no record_id");
  });

  it("treats a reply that is not an object as malformed", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { reply: "ok" });

    const result = expectUnacknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result.reason).toBe("MALFORMED_RESPONSE");
  });

  it("reports a host Chrome does not know about through lastError, without throwing", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { lastErrorMessage: "Specified native messaging host not found." });

    const result = expectUnacknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result.reason).toBe("HOST_UNAVAILABLE");
    expect(result.detail).toContain(NATIVE_HOST);
    expect(result.detail).toContain("not found");
  });

  it("reports a host that throws instead of opening", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { throwMessage: "Access to the specified native messaging host is forbidden." });

    const result = expectUnacknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result.reason).toBe("HOST_UNAVAILABLE");
    expect(result.detail).toContain("forbidden");
  });

  it("reports a host that opens and then disconnects without replying", async () => {
    const mock = installChromeMock();
    const ports = installNativeHost(mock, { disconnectWithoutReply: true });

    const result = expectUnacknowledged(await new NativeTransport().addMemory(RECORD));

    expect(result.reason).toBe("HOST_UNAVAILABLE");
    expect(result.detail).toContain("disconnected");
    expect(ports[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("times out rather than hanging when the host never answers", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, {});

    const result = expectUnacknowledged(
      // A short timeout keeps the case deterministic without fake timers.
      await new NativeTransport("consumer", 10).addMemory(RECORD)
    );

    expect(result.reason).toBe("TIMEOUT");
    expect(result.detail).toContain("timed out");
  });
});

describe("NativeTransport.health()", () => {
  it("reports healthy only once the host answers that its core is up", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, {
      reply: { success: true, healthy: true, core_url: "http://127.0.0.1:3030" },
    });

    expect(await new NativeTransport().health()).toEqual({
      status: "connected",
      service: `${NATIVE_HOST} → http://127.0.0.1:3030`,
      healthy: true,
      connection: "healthy",
    });
  });

  it("does not call an open port healthy when the core is down", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, {
      reply: {
        success: false,
        healthy: false,
        core_url: "http://127.0.0.1:3030",
        detail: "core not reachable at http://127.0.0.1:3030: connect ECONNREFUSED",
      },
    });

    const health = await new NativeTransport().health();

    expect(health.healthy).toBe(false);
    expect(health.connection).toBe("core-unreachable");
    expect(health.status).toContain("ECONNREFUSED");
  });

  it("reports a host that never answers the probe as installed but not running", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, {});

    // A short timeout: what is being asserted is which state is reported, not how long the wait is.
    const health = await new NativeTransport("consumer", 10).health();

    expect(health.connection).toBe("core-unreachable");
    expect(health.status).toContain("registered but did not answer");
  });

  it("reports not-installed when the browser has no such host, distinctly from a stopped core", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { lastErrorMessage: "Specified native messaging host not found." });

    expect(await new NativeTransport().health()).toEqual({
      status: "not installed",
      service: NATIVE_HOST,
      healthy: false,
      connection: "host-not-registered",
    });
  });
});

describe("NativeTransport.resolve()", () => {
  it("never claims a fallback, because consumer mode does not fall back", async () => {
    const mock = installChromeMock();
    // A host that answers: the probe waits for a reply, and a silent mock would spend the whole
    // response timeout proving nothing about fallback.
    installNativeHost(mock, { reply: { success: true, healthy: true } });

    expect(await new NativeTransport("consumer").resolve()).toMatchObject({
      mode: "consumer",
      active: "native",
      fellBack: false,
    });
  });

  it("names the missing host rather than the mode", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { lastErrorMessage: "not found" });

    const resolution = await new NativeTransport("consumer").resolve();
    expect(resolution.detail).toContain(NATIVE_HOST);
    expect(resolution.detail).toContain("does not fall back");
  });

  it("names the command that ends the not-installed state", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, { lastErrorMessage: "Specified native messaging host not found." });

    const resolution = await new NativeTransport("consumer").resolve();
    expect(resolution.detail).toContain("npm run install:host");
  });

  it("tells a user whose core is stopped to start it, not to reinstall", async () => {
    const mock = installChromeMock();
    installNativeHost(mock, {
      reply: { success: false, healthy: false, detail: "connection refused" },
    });

    const resolution = await new NativeTransport("consumer").resolve();
    expect(resolution.detail).toContain("Start HipCortex");
    // The two states must not share advice: reinstalling cannot fix a stopped core (G9.1).
    expect(resolution.detail).not.toContain("npm run install:host");
  });
});

describe("NativeTransport retrieval", () => {
  it("refuses to guess a retrieval message shape", async () => {
    installChromeMock();

    await expect(new NativeTransport().search("anything")).rejects.toMatchObject({
      name: "TransportError",
      reason: "UNSUPPORTED_TRANSPORT",
    });
    await expect(new NativeTransport().queryStructured({ actor: "u" })).rejects.toThrow(
      /not defined for retrieval/
    );
  });
});
