/**
 * The user's exit from a queue that cannot be delivered (G4.1).
 *
 * The extension's guarantee is acknowledged delivery, and the queue exists so that an unacknowledged
 * capture is never lost. That guarantee is worth nothing if the runtime stays unreachable forever, so
 * there has to be a way for the user to take the captures out by hand — and the export has to be in
 * the same record shape the core's own export uses, or the two cannot be imported together and the
 * user's exit becomes a translation project.
 *
 * Two properties are load-bearing and both are implemented by *what this file does not do*:
 *
 * - **Nothing is removed.** `readQueue` reads; this module never writes, never acknowledges and never
 *   clears. An entry that has been exported is still an entry that will be delivered, so the user
 *   exporting their backlog and the runtime coming back are not two competing futures (task 3.2).
 * - **Nothing is rewritten.** A record is `toEgressRecord` of the entry's own event with the actor
 *   the delivery path would use. There is no export-only field, no "exported" tag and no marshalled
 *   summary, so a record imported from an export is byte-for-byte the record the transport would
 *   have posted. That is what makes a queued record and a stored record the same record at different
 *   points in its life, which is the whole of requirement 4.
 *
 * The verdict on an entry (`outcome`, `refusalReason`) stays out of the export on purpose. It is
 * this extension's bookkeeping about a send attempt, not part of the record, and importing it would
 * write the extension's opinion about a capture into the user's memory. The capture itself carries
 * its own provenance in the reserved metadata key, so nothing about the record is lost by leaving the
 * retry state behind.
 */

import { toEgressRecord, toExportDocument } from "../../schema/index.js";
import type { ExportDocument } from "../../schema/index.js";
import { readQueue } from "./queue.js";
import type { QueueState } from "./queue.js";

/**
 * Render a queue as an export document.
 *
 * `exportedAt` is a parameter rather than a clock read for the same reason it is in the contract:
 * one source of time per process, and a spec can pin it. `actor` must be the actor the delivery path
 * would use — a different one would import the user's captures under a name their own retrieval
 * cannot see.
 */
export function queueToExportDocument(state: QueueState, actor: string, exportedAt: string): ExportDocument {
  const records = state.entries.map((entry) => toEgressRecord(entry.event, actor));
  return toExportDocument(records, { actor, exportedAt });
}

/**
 * Read the queue and render it.
 *
 * Reads only: the queue state is passed straight through, and there is no write path from here at
 * all — no `writeQueue`, no `removeAcknowledged`, no acknowledgement. An exported entry is still an
 * entry that will be delivered.
 */
export async function exportQueue(
  actor: string,
  exportedAt: string = new Date().toISOString()
): Promise<ExportDocument> {
  const state = await readQueue();
  return queueToExportDocument(state, actor, exportedAt);
}
