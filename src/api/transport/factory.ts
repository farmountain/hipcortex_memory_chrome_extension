/**
 * Transport resolution.
 *
 * Three modes, and the difference between them is entirely about what happens when the preferred
 * transport is not there:
 *
 * | Mode | Capture egress | On failure |
 * |------|----------------|------------|
 * | `auto` (default) | Native Messaging, then loopback HTTP | falls back, and reports that it did |
 * | `consumer` | Native Messaging only | **no** fallback — an explicit choice is not second-guessed |
 * | `developer` | loopback HTTP only | native is never attempted |
 *
 * A non-loopback base URL is refused outright in `auto` and `consumer` (G7.3). Refusing rather than
 * ignoring is deliberate: the base URL being remote in one of those modes is a misconfiguration,
 * and silently proceeding would send captures off the machine on the strength of a setting the user
 * was told meant "local".
 */

import type { ExtensionSettings, HealthStatus, MemoryRecord, SearchResult, TransportMode } from "../../types/index.js";
import { ADD_MEMORY_PATH, hostOfUrl, isLoopbackUrl } from "./endpoints.js";
import { HttpTransport } from "./http.js";
import { NATIVE_HOST, NativeTransport } from "./native.js";
import { TransportError } from "./types.js";
import type { SendResult, Transport, TransportName, TransportResolution } from "./types.js";

/**
 * A transport that performs no request, ever.
 *
 * Every operation reports `REMOTE_HOST_REFUSED` and names the host, so the failure is actionable
 * without reading source.
 */
class RefusingTransport implements Transport {
  readonly name: TransportName = "refused";
  readonly mode: TransportMode;
  readonly host: string;
  readonly detail: string;

  constructor(mode: TransportMode, host: string, detail: string) {
    this.mode = mode;
    this.host = host;
    this.detail = detail;
  }

  async health(): Promise<HealthStatus> {
    return { status: "refused", service: this.host, healthy: false };
  }

  async resolve(): Promise<TransportResolution> {
    return { mode: this.mode, active: "refused", fellBack: false, detail: this.detail };
  }

  async addMemory(): Promise<SendResult> {
    return {
      acknowledged: false,
      transport: "refused",
      reason: "REMOTE_HOST_REFUSED",
      detail: this.detail,
      // Deterministic: the base URL is non-loopback and no retry can change that (G7.3).
      kind: "refused",
      refusalReason: this.detail,
    };
  }

  async search(): Promise<SearchResult> {
    throw new TransportError(this.detail, "REMOTE_HOST_REFUSED", this.host);
  }

  async queryStructured(): Promise<SearchResult> {
    throw new TransportError(this.detail, "REMOTE_HOST_REFUSED", this.host);
  }
}

/**
 * `auto`: native first, HTTP as the fallback.
 *
 * The fallback fires on `HOST_UNAVAILABLE` and on nothing else. In particular it does **not** fire
 * on `TIMEOUT` or on `NOT_ACKNOWLEDGED`: the host may already have received and written the
 * capture, and the runtime retains duplicates rather than merging them (`docs/PROTOCOL.md` §6.2),
 * so re-sending a capture that might have landed trades a duplicate for nothing. A timeout leaves
 * the entry unacknowledged, which is the state the queue already knows how to retry.
 */
class AutoTransport implements Transport {
  readonly name: TransportName = "http";
  readonly mode: TransportMode = "auto";
  private readonly native: NativeTransport;
  private readonly http: HttpTransport;

  constructor(native: NativeTransport, http: HttpTransport) {
    this.native = native;
    this.http = http;
  }

  async health(): Promise<HealthStatus> {
    const nativeHealth = await this.native.health();
    if (nativeHealth.healthy) return nativeHealth;

    const httpHealth = await this.http.health();
    return { ...httpHealth, status: `${httpHealth.status} (${NATIVE_HOST} unavailable)` };
  }

  async resolve(): Promise<TransportResolution> {
    const probe = await this.native.health();
    if (probe.healthy) {
      return {
        mode: this.mode,
        active: "native",
        fellBack: false,
        detail: `${NATIVE_HOST} reachable; captures are delivered over Native Messaging`,
      };
    }
    return {
      mode: this.mode,
      active: "http",
      fellBack: true,
      detail: `${NATIVE_HOST} unavailable; falling back to HTTP ${this.http.baseUrl}${ADD_MEMORY_PATH}`,
    };
  }

  async addMemory(record: MemoryRecord): Promise<SendResult> {
    const first = await this.native.addMemory(record);
    if (first.acknowledged || first.reason !== "HOST_UNAVAILABLE") {
      return first;
    }

    const second = await this.http.addMemory(record);
    if (second.acknowledged) return second;
    return { ...second, detail: `${second.detail} (native: ${first.detail})` };
  }

  /** Retrieval is HTTP always: the assumed native envelope defines no read path. */
  search(query: string, options?: Parameters<HttpTransport["search"]>[1]): Promise<SearchResult> {
    return this.http.search(query, options);
  }

  queryStructured(options?: Parameters<HttpTransport["queryStructured"]>[0]): Promise<SearchResult> {
    return this.http.queryStructured(options);
  }
}

export function createTransport(settings: ExtensionSettings): Transport {
  const mode = settings.transportMode;
  const host = hostOfUrl(settings.apiUrl);

  if ((mode === "auto" || mode === "consumer") && !isLoopbackUrl(settings.apiUrl)) {
    return new RefusingTransport(
      mode,
      host,
      `${mode} mode refuses the non-loopback base URL "${settings.apiUrl}" (host ${host}); no capture was sent. Capture does not leave this machine unless you configure developer mode and confirm the host.`
    );
  }

  if (mode === "developer") {
    return new HttpTransport(settings.apiUrl, settings.apiKey, mode);
  }

  const native = new NativeTransport(mode);
  if (mode === "consumer") return native;

  return new AutoTransport(native, new HttpTransport(settings.apiUrl, settings.apiKey, mode));
}
