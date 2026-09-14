/**
 * Egress mapping: `CaptureEvent` → the runtime's `POST /memory/add` body.
 *
 * This is where the contract meets the verified surface. `docs/PROTOCOL.md` §3 is the specification
 * and this file is the only place allowed to encode it:
 *
 * - `action` is `capture:<providerId>`, which the runtime **filters on server-side**. That is what
 *   makes provider-scoped retrieval possible at all, and it is why provider identity must not be
 *   conveyed only as prose inside the transcript (G3.1).
 * - `record_type` is `Perception`.
 * - `ttl_seconds` is **never emitted**. Omitting it yields `expires_at: null`; emitting a value
 *   would create a capture that looks successful and is deleted later.
 * - The whole payload lives as one record. `tags` and the reserved metadata object both persist.
 */

import type { CaptureEvent } from "./capture-event.js";
import type { Conversation } from "./conversation.js";

/** The single reserved key. Nothing else may be written into `metadata`. */
export const RESERVED_PROVENANCE_KEY = "hipcortex.capture" as const;

export const CAPTURE_RECORD_TYPE = "Perception" as const;
export const CAPTURE_SOURCE = "cortexbridge" as const;
export const CAPTURE_TAG = "capture" as const;

/**
 * The payload stored under `RESERVED_PROVENANCE_KEY`.
 *
 * It repeats `schemaVersion` even though the event carries one, so that a consumer holding only
 * this object can version-decide without reading the envelope it arrived in.
 */
export interface CaptureProvenancePayload {
  readonly schemaVersion: number;
  readonly provider: string;
  readonly adapterVersion: string;
  readonly source: string;
  readonly conversationUrl: string;
  readonly eventId: string;
  readonly capturedAt: string;
}

export interface EgressRecord {
  readonly actor: string;
  readonly action: string;
  readonly record_type: string;
  readonly source: string;
  readonly target: string;
  readonly tags: readonly string[];
  readonly metadata: Record<string, unknown>;
}

export function captureAction(providerId: string): string {
  return `capture:${providerId}`;
}

/**
 * Deterministic transcript rendering.
 *
 * Deterministic matters more than pretty: two captures of an unchanged conversation must produce
 * byte-identical `target` text, otherwise every re-capture looks like new content to the semantic
 * index. That is why there is no timestamp, no counter, and no environment-dependent formatting.
 */
export function renderTranscript(conversation: Conversation): string {
  const blocks: string[] = [];

  if (conversation.title) {
    blocks.push(`# ${conversation.title}`);
  }

  for (const message of conversation.messages) {
    const body: string[] = [];
    if (message.text.length > 0) {
      body.push(message.text);
    }
    for (const attachment of message.attachments ?? []) {
      const name = attachment.name ? `: ${attachment.name}` : "";
      const url = attachment.url ? ` <${attachment.url}>` : "";
      body.push(`[${attachment.kind}${name}${url}]`);
    }
    blocks.push([`${message.role}:`, ...body].join("\n"));
  }

  return blocks.join("\n\n");
}

export function toCaptureProvenance(event: CaptureEvent): CaptureProvenancePayload {
  return {
    schemaVersion: event.provenance.schemaVersion,
    provider: event.provenance.provider,
    adapterVersion: event.provenance.adapterVersion,
    source: event.provenance.source,
    conversationUrl: event.provenance.conversationUrl,
    eventId: event.eventId,
    capturedAt: event.provenance.capturedAt,
  };
}

/**
 * Map a validated event onto the add body.
 *
 * `ttl_seconds` is absent by construction — it is not a field on `EgressRecord`, so no future edit
 * can add it by accident while still type-checking.
 */
export function toEgressRecord(event: CaptureEvent, actor: string): EgressRecord {
  return {
    actor,
    action: captureAction(event.provenance.provider),
    record_type: CAPTURE_RECORD_TYPE,
    source: CAPTURE_SOURCE,
    target: renderTranscript(event.conversation),
    tags: [CAPTURE_TAG, event.provenance.provider],
    metadata: {
      [RESERVED_PROVENANCE_KEY]: toCaptureProvenance(event),
    },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read capture provenance back out of a record the runtime returned.
 *
 * This is the inverse of `toEgressRecord` and it is what makes provider provenance a **discrete
 * field** on the read path rather than something a caller has to scrape out of prose (G3.1). It is
 * deliberately total: any record that is not a capture — or whose reserved object is present but
 * unreadable — yields `null` instead of throwing, because the read path must keep working across
 * records written before this contract existed.
 */
export function readCaptureProvenance(record: {
  metadata?: Record<string, unknown>;
}): CaptureProvenancePayload | null {
  const metadata = record.metadata;
  if (!isPlainRecord(metadata)) return null;

  const reserved = metadata[RESERVED_PROVENANCE_KEY];
  if (!isPlainRecord(reserved)) return null;

  const provider = reserved["provider"];
  if (typeof provider !== "string" || provider.trim().length === 0) return null;

  return reserved as unknown as CaptureProvenancePayload;
}
