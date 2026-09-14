/**
 * Shared builders for the migration specs (G4.2, G4.3).
 *
 * Two of them build a *document*, and the difference between them is the whole point of the change:
 * `ownExportDocument` is what this repository writes, `coreShapeDocument` is what
 * `GET /memory/export` returns — unversioned, and carrying an `id` per record that this repository's
 * producer cannot emit. A spec that only used one of them would not be testing the boundary.
 *
 * The `send` stub is a recorder: it returns canned results and keeps every record it was handed, so
 * the assertions can be about what reached the wire rather than about what the importer believed.
 */

import { interpretAcknowledgement } from "../../src/api/transport/acknowledge.js";
import type { SendResult } from "../../src/api/transport/index.js";
import { toEgressRecord, toExportDocument } from "../../src/schema/index.js";
import type { ExportRecord } from "../../src/schema/index.js";
import type { MemoryRecord } from "../../src/types/index.js";
import { makeConversation, makeEvent } from "./capture.js";

/** The actor the destination stamps. Deliberately not the actor the documents were exported for. */
export const IMPORT_ACTOR = "browser-user";
export const SOURCE_ACTOR = "the-other-machine";
export const EVENT_ID = "evt-migrate-1";
export const IMPORTED_AT = "2025-03-01T00:00:00.000Z";

export function makeExportRecord(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    ...toEgressRecord(
      makeEvent({
        eventId: EVENT_ID,
        conversation: makeConversation({ title: "a migrated conversation" }),
      }),
      SOURCE_ACTOR
    ),
    ...overrides,
  };
}

/** A document this repository produced: versioned, and carrying no identity at all. */
export function ownExportDocument(records: readonly ExportRecord[]): string {
  return JSON.stringify(toExportDocument(records, { actor: SOURCE_ACTOR, exportedAt: IMPORTED_AT }));
}

/** A document the runtime produced, in the shape and key order `GET /memory/export` was observed to use. */
export function coreShapeDocument(records: readonly (ExportRecord & { id?: string })[]): string {
  return JSON.stringify({ exported_at: IMPORTED_AT, records, total: records.length });
}

export interface Advisory {
  readonly action?: string;
  readonly id?: string;
  readonly overlapRatio?: number;
}

export function acknowledged(recordId: string, warning: readonly Advisory[] = []): SendResult {
  return { acknowledged: true, transport: "http", recordId, warning };
}

/**
 * A refusal in the runtime's own terms: a precondition it applied, and the words it gave for it.
 *
 * Built by the transport's own reader rather than by hand, so a change to how a refusal is read shows
 * up here instead of being papered over by a stub that quietly stopped matching the real thing.
 */
export function refused(refusalReason: string): SendResult {
  return interpretAcknowledgement(
    { success: false, error: refusalReason },
    "http",
    "http://127.0.0.1:3030/memory/add"
  );
}

export interface RecordStub {
  readonly sent: MemoryRecord[];
  readonly send: (record: MemoryRecord) => Promise<SendResult>;
}

/**
 * A core that answers acknowledgements from a queue, and records what it was asked to store.
 *
 * The default answer mints `new-core-N`, which is what a runtime that regenerates `id` looks like from
 * this side. When the queue runs out, the default takes over, so a spec that only cares about the
 * first result does not have to spell out the rest.
 */
export function recordStub(results: readonly SendResult[] = []): RecordStub {
  const sent: MemoryRecord[] = [];
  let call = 0;

  return {
    sent,
    send: async (record: MemoryRecord): Promise<SendResult> => {
      sent.push(record);
      const canned = results[call];
      call += 1;
      return canned ?? acknowledged(`new-core-${call}`);
    },
  };
}
