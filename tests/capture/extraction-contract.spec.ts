/**
 * Extraction contract specs (tasks 5.9 and 5.15).
 *
 * `extract()` is the boundary between the volatile page and everything that follows it, so two
 * properties are asserted here rather than provider by provider — they must hold for *every*
 * adapter, and a per-provider copy would only ever be a weaker restatement:
 *
 * 1. a refused extraction must not reach the network at all;
 * 2. a successful extraction must not depend on the network existing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { installChromeMock, installNativeHost } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { installFetchMock, jsonBody } from "../helpers/http.js";
import { parseFixture, readFixture } from "../helpers/fixtures.js";
import { expectExtractFailure, expectExtractSuccess } from "../helpers/extract.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import type { ExtractResult } from "../../src/capture/providers/types.js";

const CONVERSATION_URL = "https://chatgpt.com/c/redacted-conversation";
const CAPTURED_AT = "2025-01-15T12:00:00.000Z";

/** One fixture per failure mode the adapter can report. */
const REFUSED_FIXTURES = [
  "unknown-shape.html",
  "no-turns.html",
  "no-role.html",
  "unsupported-role.html",
  "partial.html",
] as const;

const FAILURE_KEYS = ["ok", "code", "detail", "slot", "rung"];

function extractFixture(name: string): ExtractResult {
  const document = parseFixture(readFixture("chatgpt", name));
  return chatgptAdapter.extract({ document, url: CONVERSATION_URL, capturedAt: CAPTURED_AT });
}

/**
 * Put the process into one of two network states and return the request recorder for the working
 * one. Native Messaging is closed in both states, so the only variable is whether HTTP could work.
 *
 * "No network" means *absent*, not *failing*: a throwing `fetch` is already exercised by the
 * transport specs, whereas a missing global is the state that catches an accidental fetch (it
 * throws `TypeError: fetch is not a function` on the spot rather than after a timeout).
 */
function installNetwork(state: "working" | "absent"): { chrome: ChromeMock; requests: readonly unknown[] } {
  const chrome = installChromeMock();
  installNativeHost(chrome, { throwMessage: "native messaging is unavailable" });

  if (state === "absent") {
    vi.stubGlobal("fetch", undefined);
    vi.stubGlobal("XMLHttpRequest", undefined);
    return { chrome, requests: [] };
  }

  const recorder = installFetchMock(() => jsonBody({ ok: true }));
  return { chrome, requests: recorder.requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a refused extraction never reaches the network — G1.4, G8.7", () => {
  it("records zero HTTP requests and opens zero native ports across every failure mode", () => {
    const probe = installNetwork("working");
    const ports = installNativeHost(probe.chrome, { reply: { success: true, record_id: "must-not-happen" } });

    for (const fixture of REFUSED_FIXTURES) {
      expect(expectExtractFailure(extractFixture(fixture)).ok, fixture).toBe(false);
    }

    expect(probe.requests).toHaveLength(0);
    expect(ports).toHaveLength(0);
  });

  it("carries no field a caller could mistake for a capture", () => {
    for (const fixture of REFUSED_FIXTURES) {
      const failure = expectExtractFailure(extractFixture(fixture));
      const keys = Object.keys(failure);

      for (const required of ["ok", "code", "detail"]) {
        expect(keys, fixture).toContain(required);
      }
      for (const key of keys) {
        expect(FAILURE_KEYS, `${fixture}:${key}`).toContain(key);
      }
      expect(failure).not.toHaveProperty("conversation");
      expect(failure).not.toHaveProperty("provenance");
      expect(failure).not.toHaveProperty("rungs");
    }
  });
});

describe("extraction is independent of the network — G8.9", () => {
  it("returns the same success with a working network and with no network at all", () => {
    const working = installNetwork("working");
    const withNetwork = extractFixture("conversation.html");

    const absent = installNetwork("absent");
    const withoutNetwork = extractFixture("conversation.html");

    expect(expectExtractSuccess(withoutNetwork)).toEqual(expectExtractSuccess(withNetwork));
    expect(working.requests).toHaveLength(0);
    expect(absent.requests).toHaveLength(0);
  });

  it("returns the same refusal with a working network and with no network at all", () => {
    installNetwork("working");
    const withNetwork = extractFixture("unknown-shape.html");

    installNetwork("absent");
    const withoutNetwork = extractFixture("unknown-shape.html");

    expect(expectExtractFailure(withoutNetwork)).toEqual(expectExtractFailure(withNetwork));
  });

  it("proves the no-network state was real while extraction succeeded in it", () => {
    installNetwork("absent");

    // Without this, "the network was absent" would be an unverified claim about the environment
    // rather than a fact about the run.
    expect(() => (globalThis as unknown as { fetch: () => void }).fetch()).toThrow();

    const success = expectExtractSuccess(extractFixture("conversation.html"));
    expect(success.conversation.messages).toHaveLength(4);
    expect(success.provenance.provider).toBe(chatgptAdapter.id);
    expect(chatgptAdapter.matches(CONVERSATION_URL)).toBe(true);
  });

  it("refuses a degraded page identically with no network", () => {
    installNetwork("absent");

    const failure = expectExtractFailure(extractFixture("no-role.html"));
    expect(failure.code).toBe("NO_ROLE_SIGNAL");
  });
});

describe("the probes above can fail", () => {
  it("detects a transport call when one is made, so a zero-request assertion means something", () => {
    const probe = installNetwork("working");
    expect(probe.requests).toHaveLength(0);

    void globalThis.fetch("http://127.0.0.1:3030/health");

    expect(probe.requests).toHaveLength(1);
  });
});
