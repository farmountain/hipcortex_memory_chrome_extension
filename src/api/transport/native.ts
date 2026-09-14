/**
 * The Native Messaging transport — Consumer Mode.
 *
 * The host this speaks to is `host/bridge-host.mjs` in this repository, and `npm run install:host`
 * registers it with the browser. §9 of `docs/PROTOCOL.md` no longer calls the capture envelope
 * assumed: `tests/host/end-to-end.spec.ts` executes it — a real frame on stdin, answered by a real
 * frame on stdout, against a real HTTP core. What no spec can prove is that **Chrome itself**
 * connects to a registered host; that needs a loaded extension in a real browser and is recorded
 * as the one leg still unrun.
 *
 * Two consequences of talking to a host the user installs are built in:
 *
 * 1. `chrome.runtime.lastError` is read after **every** host interaction, because Chrome reports a
 *    missing host there rather than by throwing.
 * 2. The acknowledgement rule is not re-implemented here — `interpretAcknowledgement` is shared
 *    with the HTTP transport. If a host answers with a different envelope, the correction is one
 *    place, and the failure mode is "the entry stays unacknowledged" rather than a silent drop.
 */

import type { HealthStatus, MemoryRecord, SearchResult } from "../../types/index.js";
import type { TransportMode } from "../../types/index.js";
import { interpretAcknowledgement } from "./acknowledge.js";
import { ADD_MEMORY_PATH, toAddBody } from "./endpoints.js";
import { TransportError, messageOf } from "./types.js";
import type {
  SearchOptions,
  SendResult,
  StructuredQueryOptions,
  Transport,
  TransportName,
  TransportResolution,
} from "./types.js";

/** The host registered by `npm run install:host`, and implemented by `host/bridge-host.mjs`. */
export const NATIVE_HOST = "com.hipcortex.bridge";

/**
 * The host's side-effect-free health probe.
 *
 * It exists because `connectNative` returning a port proves only that the host is *installed*. A
 * probe that stops there reports "healthy" while the core is stopped, and reports one
 * undifferentiated failure to a user who never installed anything (G9.1). The host answers this
 * from `GET /health`, so asking costs the core nothing and writes no record.
 */
const HOST_HEALTH_REQUEST = { type: "health" } as const;

/** What the host reports about the core in reply to `HOST_HEALTH_REQUEST`. */
interface HostHealthReply {
  readonly healthy?: boolean;
  readonly core_url?: string;
  readonly detail?: string;
}

const RESPONSE_TIMEOUT_MS = 10000;

class NativeTimeout extends Error {}

type OpenResult =
  | { readonly ok: true; readonly port: chrome.runtime.Port }
  | { readonly ok: false; readonly detail: string };

type RoundTrip =
  | { readonly ok: true; readonly response: unknown }
  | { readonly ok: false; readonly reason: "HOST_UNAVAILABLE" | "TIMEOUT"; readonly detail: string };

export class NativeTransport implements Transport {
  readonly name: TransportName = "native";
  readonly mode: TransportMode;
  private readonly responseTimeoutMs: number;

  /**
   * `responseTimeoutMs` is injectable so the timeout path can be exercised without a ten-second
   * wait. It is not a configuration knob: nothing outside a spec should set it.
   */
  constructor(mode: TransportMode = "consumer", responseTimeoutMs = RESPONSE_TIMEOUT_MS) {
    this.mode = mode;
    this.responseTimeoutMs = responseTimeoutMs;
  }

  private open(): OpenResult {
    let port: chrome.runtime.Port | undefined;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
      return { ok: false, detail: `${NATIVE_HOST}: ${messageOf(error)}` };
    }

    const lastError = chrome.runtime.lastError;
    if (lastError) {
      return { ok: false, detail: `${NATIVE_HOST}: ${lastError.message ?? "host not available"}` };
    }
    if (!port) {
      return { ok: false, detail: `${NATIVE_HOST}: connectNative returned no port` };
    }
    return { ok: true, port };
  }

  /**
   * `existingPort` lets the health probe reuse the port it already opened rather than opening a
   * second one; every other caller opens its own.
   */
  private async roundTrip(payload: unknown, existingPort?: chrome.runtime.Port): Promise<RoundTrip> {
    const opened: OpenResult = existingPort ? { ok: true, port: existingPort } : this.open();
    if (!opened.ok) {
      return { ok: false, reason: "HOST_UNAVAILABLE", detail: opened.detail };
    }

    const { port } = opened;
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new NativeTimeout("timed out waiting for the host")),
          this.responseTimeoutMs
        );
        port.onMessage.addListener((message: unknown) => {
          clearTimeout(timer);
          resolve(message);
        });
        port.onDisconnect.addListener(() => {
          clearTimeout(timer);
          const lastError = chrome.runtime.lastError;
          reject(new Error(lastError?.message ?? "the host disconnected without replying"));
        });
        port.postMessage(payload);
      });
      return { ok: true, response };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof NativeTimeout ? "TIMEOUT" : "HOST_UNAVAILABLE",
        detail: `${NATIVE_HOST}: ${messageOf(error)}`,
      };
    } finally {
      // Always release the port: an MV3 worker is terminated at any time, and a port left open
      // keeps the host process alive.
      try {
        port.disconnect();
      } catch {
        // Already gone.
      }
    }
  }

  async health(): Promise<HealthStatus> {
    const opened = this.open();
    if (!opened.ok) {
      // No host is registered with this browser. This is the state of every user who has installed
      // the extension and nothing else, and it is not reachable by checking whether anything is
      // running — there is no process on the other end at all (G9.1).
      return {
        status: "not installed",
        service: NATIVE_HOST,
        healthy: false,
        connection: "host-not-registered",
      };
    }

    // The host is registered. That is all `connectNative` proved: it says nothing about whether the
    // core is up, and reporting the first as the second is the dead end G9.1 closes.
    const outcome = await this.roundTrip(HOST_HEALTH_REQUEST, opened.port);
    const reply = outcome.ok ? (outcome.response as HostHealthReply | undefined) : undefined;

    if (outcome.ok && reply?.healthy === true) {
      return {
        status: "connected",
        service: reply.core_url ? `${NATIVE_HOST} → ${reply.core_url}` : NATIVE_HOST,
        healthy: true,
        connection: "healthy",
      };
    }

    // The host is registered and did not report a healthy core. Either it answered with the core's
    // own failure, or it answered nothing at all — both are "installed but not running", and the
    // detail distinguishes them so a host that predates this probe is diagnosable rather than
    // silently indistinguishable (G9.1).
    const detail = outcome.ok
      ? (reply?.detail ?? "the host did not report the core as healthy")
      : `${outcome.detail} — the host is registered but did not answer a health probe`;

    return { status: detail, service: NATIVE_HOST, healthy: false, connection: "core-unreachable" };
  }

  async resolve(): Promise<TransportResolution> {
    const probe = await this.health();

    // Each state names the action that ends it. The not-installed state is the one the old wording
    // got wrong: it advised checking that HipCortex was running to a user who had never installed
    // it, which is advice with no possible outcome (G9.2).
    const detail = probe.healthy
      ? `${NATIVE_HOST} reachable; captures are delivered over Native Messaging`
      : probe.connection === "host-not-registered"
        ? `${NATIVE_HOST} is not registered with this browser, so Consumer Mode has no host to talk to. Run "npm run install:host" in the extension's repository, then reload the extension. Consumer Mode does not fall back to HTTP.`
        : `${NATIVE_HOST} is registered, but its core is not answering. Start HipCortex — or install it, if it was never installed. Consumer Mode does not fall back to HTTP.`;

    return { mode: this.mode, active: "native", fellBack: false, detail };
  }

  async addMemory(record: MemoryRecord): Promise<SendResult> {
    const outcome = await this.roundTrip(toAddBody(record));
    if (!outcome.ok) {
      // Both members of `outcome.reason` are about the pipe, not the record: the host was absent, or
      // it did not answer in time. The record has not been judged by anything, so it is transient and
      // there is no runtime reason to carry.
      return {
        acknowledged: false,
        transport: this.name,
        reason: outcome.reason,
        detail: outcome.detail,
        kind: "transient",
        refusalReason: null,
      };
    }
    return interpretAcknowledgement(outcome.response, this.name, NATIVE_HOST);
  }

  /** Retrieval is not part of the native envelope, and guessed messages are not sent. */
  async search(_query: string, _options?: SearchOptions): Promise<SearchResult> {
    throw new TransportError(
      `Native Messaging is not defined for retrieval (docs/PROTOCOL.md §9); ${ADD_MEMORY_PATH} over loopback HTTP is the read path`,
      "UNSUPPORTED_TRANSPORT",
      NATIVE_HOST
    );
  }

  async queryStructured(_options?: StructuredQueryOptions): Promise<SearchResult> {
    throw new TransportError(
      `Native Messaging is not defined for retrieval (docs/PROTOCOL.md §9); ${ADD_MEMORY_PATH} over loopback HTTP is the read path`,
      "UNSUPPORTED_TRANSPORT",
      NATIVE_HOST
    );
  }
}
