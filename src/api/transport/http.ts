/**
 * The HTTP transport — loopback by default, and the only place in `src/` allowed to call `fetch`.
 *
 * The historical implementation tried a ladder of paths for every operation — the canonical add
 * path, an ingest alias, a versioned prefix, a bare add — treating a 404 as "try the next one".
 * That ladder is gone. `docs/PROTOCOL.md` §2 rule 1 is the reason: a 404 is honest, a ladder of
 * 404s looks like a transient failure and hides the misconfiguration, and one rung of the old
 * ladder returned HTTP 200 while destroying every provenance field and setting a 24-hour TTL.
 *
 * That superseded path is not even named here in a comment, which is deliberate: the source scan
 * that proves it is unreferenced (task 9.9) is only worth having if it admits no exceptions.
 */

import type { HealthStatus, MemoryRecord, SearchResult } from "../../types/index.js";
import type { ExtensionSettings, TransportMode } from "../../types/index.js";
import { CAPTURE_RECORD_TYPE, captureAction, readCaptureProvenance } from "../../schema/index.js";
import { interpretAcknowledgement, refusalReasonOf, classifyHttpStatus } from "./acknowledge.js";
import {
  ADD_MEMORY_PATH,
  DEFAULT_LIMIT,
  HEALTH_PATH,
  HEALTH_TIMEOUT_MS,
  QUERY_PATH,
  REQUEST_TIMEOUT_MS,
  SEARCH_PATH,
  normalizeBaseUrl,
  toAddBody,
} from "./endpoints.js";
import { TransportError, isRecord, messageOf } from "./types.js";
import type {
  SearchOptions,
  SendResult,
  StructuredQueryOptions,
  Transport,
  TransportName,
  TransportResolution,
} from "./types.js";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Read one record out of a runtime response.
 *
 * This is the trust boundary for the read path. The runtime returns a wider object than
 * `MemoryRecord` — integrity, priority, version, status, `expires_at` — and abandoning those fields
 * would lose information, so the narrower local type is asserted here, once, and provider
 * provenance is lifted into a discrete field on the way through.
 */
export function toMemoryRecord(value: Record<string, unknown>): MemoryRecord {
  const record = value as unknown as MemoryRecord;
  const provenance = readCaptureProvenance(record);
  if (provenance) record.provider = provenance.provider;
  return record;
}

export class HttpTransport implements Transport {
  readonly name: TransportName = "http";
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly mode: TransportMode;

  constructor(baseUrl: string, apiKey = "", mode: TransportMode = "developer") {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.mode = mode;
  }

  static fromSettings(settings: ExtensionSettings): HttpTransport {
    return new HttpTransport(settings.apiUrl, settings.apiKey, settings.transportMode);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  async health(): Promise<HealthStatus> {
    const endpoint = `${this.baseUrl}${HEALTH_PATH}`;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { status: `HTTP ${response.status}`, healthy: false };
      }
      const text = await response.text();
      if (text.trim().toLowerCase() === "ok") {
        return { status: "ok", healthy: true };
      }
      const payload = safeParse(text);
      if (isRecord(payload)) {
        return {
          status: typeof payload["status"] === "string" ? payload["status"] : "ok",
          service: typeof payload["service"] === "string" ? payload["service"] : undefined,
          version: typeof payload["version"] === "string" ? payload["version"] : undefined,
          tier: typeof payload["tier"] === "string" ? payload["tier"] : undefined,
          healthy: true,
        };
      }
      return { status: text.slice(0, 32), healthy: true };
    } catch (error) {
      return { status: `unreachable: ${messageOf(error)}`, healthy: false };
    }
  }

  async resolve(): Promise<TransportResolution> {
    return {
      mode: this.mode,
      active: "http",
      fellBack: false,
      detail: `HTTP ${this.baseUrl}${ADD_MEMORY_PATH}`,
    };
  }

  async addMemory(record: MemoryRecord): Promise<SendResult> {
    const endpoint = `${this.baseUrl}${ADD_MEMORY_PATH}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(toAddBody(record)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        acknowledged: false,
        transport: this.name,
        reason: "UNREACHABLE",
        detail: `${endpoint}: ${messageOf(error)}`,
        kind: "transient",
        refusalReason: null,
      };
    }

    if (!response.ok) {
      // The body is read, not just the status. A `403` from the PII precondition carries the only
      // explanation the user will ever get, and discarding it is what made a permanent refusal
      // indistinguishable from a dropped connection (task 5.2).
      const payload = await readJson(response);
      const refusalReason = refusalReasonOf(payload);
      return {
        acknowledged: false,
        transport: this.name,
        reason: "HTTP_ERROR",
        detail: refusalReason
          ? `${endpoint}: HTTP ${response.status} - ${refusalReason}`
          : `${endpoint}: HTTP ${response.status}`,
        kind: classifyHttpStatus(response.status),
        refusalReason,
      };
    }

    return interpretAcknowledgement(await readJson(response), this.name, endpoint);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const endpoint = `${this.baseUrl}${SEARCH_PATH}`;
    const limitation = options.providerFilter
      ? `Cannot scope semantic search to provider "${options.providerFilter}": ${SEARCH_PATH} has no filter field. These results may include other providers' captures; use the structured read path to filter.`
      : undefined;

    const response = await this.post(endpoint, {
      query,
      limit: options.limit ?? DEFAULT_LIMIT,
    });
    if (!response.ok) {
      throw new TransportError(`${endpoint}: HTTP ${response.status}`, "HTTP_ERROR", endpoint);
    }

    const payload = await readJson(response);
    const members = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload["results"])
        ? payload["results"]
        : null;

    if (members === null) {
      throw new TransportError(
        `${endpoint}: response carried no results array`,
        "MALFORMED_RESPONSE",
        endpoint
      );
    }

    const results = members.map((member, index) => unwrapMember(member, index, endpoint));
    return { results, count: results.length, query, ...(limitation ? { limitation } : {}) };
  }

  async queryStructured(options: StructuredQueryOptions = {}): Promise<SearchResult> {
    const endpoint = `${this.baseUrl}${QUERY_PATH}`;
    const params = new URLSearchParams();

    if (options.providerFilter) {
      // The verified resolution: a provider filter is `action` AND `record_type`, both server-side
      // filterable. Sending only one of them would silently over-select.
      params.set("action", captureAction(options.providerFilter));
      params.set("record_type", options.recordType ?? CAPTURE_RECORD_TYPE);
    } else {
      if (options.action) params.set("action", options.action);
      if (options.recordType) params.set("record_type", options.recordType);
    }

    if (options.actor) params.set("actor", options.actor);
    params.set("limit", String(options.limit ?? DEFAULT_LIMIT));
    if (options.asOf) params.set("as_of", options.asOf);

    const url = `${endpoint}?${params.toString()}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TransportError(`${url}: ${messageOf(error)}`, "UNREACHABLE", endpoint);
    }
    if (!response.ok) {
      throw new TransportError(`${url}: HTTP ${response.status}`, "HTTP_ERROR", endpoint);
    }

    const payload = await readJson(response);
    const records = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload["records"])
        ? payload["records"]
        : null;

    if (records === null) {
      throw new TransportError(
        `${endpoint}: response carried no records array`,
        "MALFORMED_RESPONSE",
        endpoint
      );
    }

    const annotated = records.filter(isRecord).map((record) => toMemoryRecord(record));

    // Defence in depth. The server-side filter was verified to be exact, but presenting an
    // over-selected record as if it passed a provider filter is the failure this whole path exists
    // to prevent, so the local set is narrowed too — and reported when it had to be.
    let results = annotated;
    let limitation: string | undefined;
    if (options.providerFilter) {
      const wanted = options.providerFilter;
      const kept = annotated.filter((record) => record.provider === wanted);
      if (kept.length !== annotated.length) {
        limitation = `The runtime returned ${annotated.length - kept.length} record(s) outside provider "${wanted}"; they were excluded locally.`;
      }
      results = kept;
    }

    return { results, count: results.length, ...(limitation ? { limitation } : {}) };
  }

  private async post(endpoint: string, body: unknown): Promise<Response> {
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TransportError(`${endpoint}: ${messageOf(error)}`, "UNREACHABLE", endpoint);
    }
  }
}

function unwrapMember(member: unknown, index: number, endpoint: string): MemoryRecord {
  if (!isRecord(member)) {
    throw new TransportError(
      `${endpoint}: result member ${index} is not an object`,
      "MALFORMED_RESPONSE",
      endpoint
    );
  }
  const record = member["record"];
  if (!isRecord(record)) {
    throw new TransportError(
      `${endpoint}: result member ${index} has no record member — the semantic path returns {score, record}`,
      "MALFORMED_RESPONSE",
      endpoint
    );
  }

  const unwrapped = toMemoryRecord(record);
  const score = member["score"];
  if (typeof score === "number") {
    unwrapped.score = score;
  }
  return unwrapped;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
