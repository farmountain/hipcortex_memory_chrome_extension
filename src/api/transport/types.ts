/**
 * The transport contract.
 *
 * Two decisions are encoded here and each one exists because the alternative was observed to fail:
 *
 * 1. **`SendResult` is a discriminated union, not a boolean and not a throw.** A capture has three
 *    outcomes the caller must distinguish — acknowledged, not-acknowledged, and could-not-be-sent —
 *    and every attempt to collapse them has produced a bug. The old client returned success on
 *    `res.ok`, so an HTTP 200 carrying no `record_id` looked delivered (G2.9).
 * 2. **Retrieval is two methods, not one.** `search` is semantic and cannot be provider-scoped
 *    because the endpoint has no filter field; `queryStructured` is the only server-side filter.
 *    A single `search(query, {providerFilter})` would silently return other providers' records.
 */

import type { HealthStatus, MemoryRecord, SearchResult, TransportMode } from "../../types/index.js";

export type { TransportMode };

/** Which transport is actually serving. `refused` means a remote base URL was rejected (G7.3). */
export type TransportName = "native" | "http" | "refused";

/**
 * Why a send was not acknowledged.
 *
 * `NOT_ACKNOWLEDGED` is the important one: HTTP succeeded and the runtime still did not confirm the
 * write, so the entry must be retained.
 */
export type SendFailureReason =
  | "HTTP_ERROR"
  | "UNREACHABLE"
  | "NOT_ACKNOWLEDGED"
  | "MALFORMED_RESPONSE"
  | "HOST_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED_TRANSPORT"
  | "REMOTE_HOST_REFUSED";

/** A duplicate advisory from the runtime, with `target` deliberately dropped (G2.10). */
export interface DuplicateWarning {
  readonly action?: string;
  readonly id?: string;
  readonly overlapRatio?: number;
}

/**
 * Whether repeating the attempt could ever succeed.
 *
 * `refused` is not a synonym for "failed". A refusal is the runtime's decision about **this record**,
 * so repeating it produces the same answer forever; a transient failure is about the moment. The
 * distinction cannot be derived from `SendFailureReason`, because `HTTP_ERROR` covers both a 500 and
 * a 403 — which is exactly why it is a value of its own rather than a second list of reasons
 * (`cortexbridge-retention-boundary` task 5.1).
 */
export type SendFailureKind = "transient" | "refused";

export type SendResult =
  | {
      readonly acknowledged: true;
      readonly transport: TransportName;
      readonly recordId: string;
      readonly warning: readonly DuplicateWarning[];
    }
  | {
      readonly acknowledged: false;
      readonly transport: TransportName;
      readonly reason: SendFailureReason;
      readonly detail: string;
      /** Whether repeating the attempt could ever succeed. */
      readonly kind: SendFailureKind;
      /**
       * The runtime's own words when it refused the record, or `null` when it gave none.
       *
       * This is what makes a deterministic refusal legible instead of invisible. Before it existed a
       * PII `403` and a dropped connection produced the same unacknowledged count and nothing else,
       * so a capture that could never be delivered was retried forever with no user-visible reason
       * (`docs/PROTOCOL.md` section 3.2; `docs/END-STATE.md` open risk 6).
       */
      readonly refusalReason: string | null;
    };

export interface SearchOptions {
  readonly limit?: number;
  /**
   * Requested provider scope for the **semantic** path.
   *
   * It cannot be honoured — `POST /memory/search` has no filter field — so it is not silently
   * dropped: `SearchResult.limitation` is populated and the caller must present it (G3.6).
   */
  readonly providerFilter?: string;
}

export interface StructuredQueryOptions {
  readonly actor?: string;
  readonly action?: string;
  readonly recordType?: string;
  /** A provider id. Resolved to `action = capture:<id>` **and** `record_type = Perception`. */
  readonly providerFilter?: string;
  readonly limit?: number;
  /** The runtime's documented-but-unlisted time-travel parameter (`docs/PROTOCOL.md` §4). */
  readonly asOf?: string;
}

export interface TransportResolution {
  readonly mode: TransportMode;
  /** Which transport would serve a capture right now. */
  readonly active: TransportName;
  /** True when `auto` could not reach native and fell back to HTTP. */
  readonly fellBack: boolean;
  /** Names the endpoint or native host that was tried (task 8.3). */
  readonly detail: string;
}

export interface Transport {
  readonly name: TransportName;
  readonly mode: TransportMode;
  health(): Promise<HealthStatus>;
  /** Which transport a capture would use right now, and why. */
  resolve(): Promise<TransportResolution>;
  /** Capture egress. Never throws for an expected failure — inspect the result instead. */
  addMemory(record: MemoryRecord): Promise<SendResult>;
  /** Semantic search. Throws `TransportError` when the endpoint cannot be read. */
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  /** The structured, provider-filterable read path. */
  queryStructured(options?: StructuredQueryOptions): Promise<SearchResult>;
}

/**
 * Raised for retrieval failures and for refusals.
 *
 * Capture egress does **not** throw, because a rejected capture must be retained rather than
 * handled by a caller that may forget to catch. Retrieval throws because it has no queue: an
 * unreadable result is simply an error the surface displays.
 */
export class TransportError extends Error {
  readonly reason: SendFailureReason;
  readonly endpoint: string;

  constructor(message: string, reason: SendFailureReason, endpoint: string) {
    super(message);
    this.name = "TransportError";
    this.reason = reason;
    this.endpoint = endpoint;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
