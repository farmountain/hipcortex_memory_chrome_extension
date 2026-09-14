/**
 * Where the wire is described.
 *
 * Every path constant in the repository lives here, so a spec can assert that a forbidden endpoint
 * appears nowhere by scanning for the string rather than by trusting a list (G5.5).
 *
 * `toAddBody` is shared by both transports: HTTP posts it as JSON, Native Messaging posts it as the
 * message payload. That shared definition is what makes "the acknowledgement rule is implemented
 * once" true in practice rather than only in prose (`docs/PROTOCOL.md` §9).
 */

import type { MemoryRecord } from "../../types/index.js";

export const HEALTH_PATH = "/health";

/** The only correct capture egress. See `docs/PROTOCOL.md` §3. */
export const ADD_MEMORY_PATH = "/memory/add";

/** Semantic search. Response members are `{score, record}` — see §4. */
export const SEARCH_PATH = "/memory/search";

/** The only server-side structured filter. See §4. */
export const QUERY_PATH = "/memory/query";

export const DEFAULT_LIMIT = 20;
export const REQUEST_TIMEOUT_MS = 8000;
export const HEALTH_TIMEOUT_MS = 4000;

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function hostOfUrl(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

/**
 * Loopback means `localhost`, an IPv4 `127.0.0.0/8` address, or `::1`. Nothing else.
 *
 * `0.0.0.0` is deliberately **not** loopback: it is a bind address meaning "every interface", so a
 * capture sent to it may leave the machine. Treating it as local would be exactly the kind of
 * plausible-looking mistake G7 exists to prevent.
 */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1") return true;
    return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
  } catch {
    return false;
  }
}

/**
 * The add body.
 *
 * Field set is exactly `docs/PROTOCOL.md` §3. Note the absences: no `ttl_seconds` (omitting it is
 * what yields `expires_at: null`), and nothing that would be silently dropped by the runtime.
 *
 * `priority` is the one field this list gained after the migration probe (G4.2): the runtime stores
 * what it is sent, the export states it, and an import that left it out turned a pinned memory into
 * an ordinary one without saying so. It is emitted only when a caller states one, so capture egress
 * is byte-identical to what it was — an absent field is still absent.
 */
export function toAddBody(record: MemoryRecord): Record<string, unknown> {
  const body: Record<string, unknown> = {
    actor: record.actor,
    action: record.action,
    target: record.target,
    metadata: record.metadata ?? {},
  };

  if (record.record_type) body["record_type"] = record.record_type;
  if (record.source) body["source"] = record.source;
  if (record.tags) body["tags"] = record.tags;
  if (record.priority) body["priority"] = record.priority;
  if (record.confidence != null) body["confidence"] = record.confidence;
  if (record.causal_parents) body["causal_parents"] = record.causal_parents;

  return body;
}
