/**
 * Import — a document from a file becomes records in a core (G4.2).
 *
 * The migration is not a copy. The runtime regenerates `id` and `integrity` on every record it accepts
 * (verified against 3.11.0; `docs/PROTOCOL.md` section 6.1), so what crosses the boundary is
 * **field-equivalent, never byte-equivalent**, and the two fields that differ are recorded rather than
 * glossed: `remap.ts` holds the transition so an old id still leads somewhere afterwards.
 *
 * Four decisions are load-bearing here, and each one has a cheaper alternative that is wrong.
 *
 * - **`POST /memory/add`, one record at a time — not `POST /memory/bulk`.** Measured on 2026-09-14
 *   against 3.11.0: bulk answered `{"success":true,"inserted":2,"failed":0}` while the read-back showed
 *   `tags: []`, `source: null` and `priority: "normal"` where the source said `["capture","probe"]`,
 *   `"cortexbridge"` and `"pinned"`. An import that reports unqualified success while dropping a field
 *   is worse than one that refuses, because nothing in the reply announces it. `/memory/add` is also the
 *   path a capture already takes, so there is one egress rule in this repository rather than two.
 * - **The document is validated whole before the first write.** `parseExportDocument` runs once and its
 *   refusal is returned verbatim with nothing written, which is how "a refused document leaves the
 *   store unchanged" is achieved — by ordering, not by rollback. There is no rollback, deliberately: it
 *   would mean deleting records the core has confirmed it holds, which is a destructive act performed
 *   to make a report look tidier.
 * - **A per-record refusal does not stop the import.** Records are independent documents; the transport
 *   already classifies a refusal as `refused` rather than `transient`, so it is deterministic for that
 *   record. Stopping would leave later records unimported for no gain.
 * - **A duplicate is reported as a duplicate, not as a refusal.** A repeat import duplicates (design
 *   decision 4 — the runtime does not merge, section 6.2 of `docs/PROTOCOL.md`), and it says so in its
 *   reply. Reporting an accepted record as refused would be the mirror image of the mistake the
 *   acknowledgement rule forbids (G2.9).
 */

import type { SendResult } from "../api/transport/index.js";
import { parseExportDocument } from "../schema/export-document.js";
import type { ExportRecord, ExportSourceIdentity } from "../schema/export-document.js";
import type {
  ImportFailure,
  ImportNote,
  ImportRecordOutcome,
  ImportReport,
  MemoryRecord,
} from "../types/index.js";
import { appendRemapMapping } from "./remap.js";
import type { RemapKeyKind, RemapMapping } from "./remap.js";

export interface ImportRequest {
  /** The file's text, never a parsed document: the surface cannot hand this an unvalidated record. */
  readonly text: string;
  /**
   * The actor the **destination** stamps on every imported record.
   *
   * Not the document's own actor: a document may cover several actors, and a record in this store
   * belongs to the person who imported it. When the two differ the report says so, because "your
   * records are now under someone else's name" is not something to do quietly.
   */
  readonly actor: string;
  /** The clock, injected so a spec can pin the import timestamp (house rule: one time source). */
  readonly now: () => Date;
  /** The one egress: a transport obtained from the factory, never constructed here. */
  readonly send: (record: MemoryRecord) => Promise<SendResult>;
}

/** Everything the record carries, and only that. The core-owned fields are not in `ExportRecord`. */
function toRecord(record: ExportRecord, actor: string): MemoryRecord {
  const imported: MemoryRecord = {
    actor,
    action: record.action,
    target: record.target,
  };
  if (record.record_type) imported.record_type = record.record_type;
  if (record.source) imported.source = record.source;
  if (record.tags) imported.tags = record.tags;
  if (record.priority) imported.priority = record.priority;
  if (record.metadata) imported.metadata = record.metadata;

  return imported;
}

/**
 * Which identity the remap is keyed by.
 *
 * The core's `id` wins when the document states one, because that is the id the user copied out of the
 * runtime they exported from. The capture's own `eventId` is the fallback, and it is not a consolation
 * prize: it is stable across the boundary, which a core id is not.
 */
function remapKeys(identity: ExportSourceIdentity | undefined): readonly { key: string; kind: RemapKeyKind }[] {
  if (!identity) return [];
  const keys: { key: string; kind: RemapKeyKind }[] = [];
  if (identity.sourceId) keys.push({ key: identity.sourceId, kind: "core-id" });
  if (identity.eventId) keys.push({ key: identity.eventId, kind: "event-id" });
  return keys;
}

function detailOf(result: Extract<SendResult, { acknowledged: false }>): string {
  return result.detail;
}

export async function importDocument(request: ImportRequest): Promise<ImportReport> {
  const parsed = parseExportDocument(request.text);

  if (!parsed.read.ok) {
    const failures: ImportFailure[] = parsed.read.failures.map((failure) => ({
      kind: failure.kind,
      index: failure.index,
      ...(failure.field === undefined ? {} : { field: failure.field }),
      detail: failure.detail,
    }));
    return { actor: request.actor, imported: 0, refused: 0, failures, notes: [], outcomes: [] };
  }

  const { document, notes } = parsed.read;
  const importNotes: ImportNote[] = notes.map((note) => ({
    kind: note.kind,
    detail: note.detail,
  }));
  if (document.actor !== null && document.actor !== request.actor) {
    importNotes.push({
      kind: "ACTOR_REPLACED",
      detail: `the document was exported for actor "${document.actor}"; imported records are stamped "${request.actor}"`,
    });
  }

  // One timestamp for the whole import, so its mappings land in one batch of the remap and a user
  // reading the store afterwards sees one import rather than N. The run identity is separate because
  // a clock can stand still between two imports and the batch boundary must not.
  const importedAt = request.now().toISOString();
  const runId = crypto.randomUUID();

  const outcomes: ImportRecordOutcome[] = [];
  let imported = 0;
  let refused = 0;

  for (let index = 0; index < document.records.length; index += 1) {
    const source = document.records[index];
    if (!source) continue;

    const identity = parsed.identities[index];
    const keys = remapKeys(identity);
    const previousId = keys[0]?.key;
    const result = await request.send(toRecord(source, request.actor));

    if (!result.acknowledged) {
      if (result.kind === "refused") refused += 1;
      outcomes.push({
        index,
        ...(previousId === undefined ? {} : { previousId }),
        outcome: result.kind === "refused" ? "refused" : "failed",
        reason: result.reason,
        detail: detailOf(result),
      });
      continue;
    }

    imported += 1;
    const duplicated = result.warning.length > 0;
    const duplicateOf = result.warning.find((warning) => warning.id)?.id;
    const remarks: string[] = [];
    if (duplicateOf !== undefined) {
      remarks.push(`the core reports this overlaps record ${duplicateOf}`);
    }

    // The record is acknowledged at this point, so any failure below is a failure to *record* the
    // transition — reported as a remark on an otherwise successful entry, never as a lost import.
    try {
      for (const { key, kind } of keys) {
        const mapping: RemapMapping = {
          previousId: key,
          kind,
          recordId: result.recordId,
          action: source.action,
        };
        await appendRemapMapping(mapping, { runId, importedAt, actor: request.actor });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      remarks.push(`imported, but the id remap could not be recorded: ${message}`);
    }

    outcomes.push({
      index,
      ...(previousId === undefined ? {} : { previousId }),
      recordId: result.recordId,
      outcome: "imported",
      ...(duplicated ? { duplicated: true } : {}),
      ...(remarks.length === 0 ? {} : { detail: remarks.join("; ") }),
    });
  }

  return {
    actor: request.actor,
    imported,
    refused,
    failures: [],
    notes: importNotes,
    outcomes,
  };
}
