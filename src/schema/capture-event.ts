/**
 * The capture event — the unit this layer produces.
 *
 * `Provenance` carries **exactly six** fields. That is a contract, not a convenience: each one is
 * either a filter key or a version stamp, and an extra field here is a field the core would have to
 * tolerate without being told why. `eventId` deliberately lives on `CaptureEvent` and not on
 * `Provenance`, because it identifies *this capture attempt* while provenance describes *the source
 * it came from* — conflating them would make a re-capture of the same conversation look like the
 * same event.
 */

import type { Conversation } from "./conversation.js";
import type { SchemaVersion } from "./version.js";

export interface Provenance {
  /** Contract version that produced this event. */
  readonly schemaVersion: SchemaVersion;
  /** Adapter id, e.g. `chatgpt`. Must equal `adapter.id` (G1.5). */
  readonly provider: string;
  /** Adapter version, bumped when a selector ladder changes. */
  readonly adapterVersion: string;
  /** Producer identity. Always `cortexbridge` — see `CAPTURE_SOURCE` in `egress.ts`. */
  readonly source: string;
  /** Canonical conversation URL. */
  readonly conversationUrl: string;
  /** ISO-8601 UTC with a `Z` suffix. */
  readonly capturedAt: string;
}

export interface CaptureEvent {
  /** Identifies this capture attempt, not the conversation. */
  readonly eventId: string;
  readonly provenance: Provenance;
  readonly conversation: Conversation;
}
