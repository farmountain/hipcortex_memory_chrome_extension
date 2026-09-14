/**
 * The identity remap — where an id from before an import leads afterwards (G4.2).
 *
 * The runtime regenerates `id` and `integrity` on every import (`docs/PROTOCOL.md` section 6.1), which
 * means an import *breaks* every reference that named the old id. Nothing the runtime holds can repair
 * that, because the old id is not in it: the only record of the transition is the one made at the
 * moment of the import. That is this module, and it is the reason the requirement says "forever
 * after" rather than "for the duration of the import".
 *
 * Three properties, each of which rules out a cheaper design.
 *
 * - **Durable.** It lives in `chrome.storage.local`, not in memory. The MV3 worker is terminated at
 *   will, so an in-memory map would resolve an old id exactly as long as nothing happened.
 * - **Append-only and unbounded.** It is the one store in this extension that is neither a cache nor a
 *   queue. An evicted index record is still in the core and an acknowledged capture is still in the
 *   core — both can be rebuilt from the runtime. A dropped remap entry cannot be rebuilt from
 *   anything, so a cap here would be a different promise wearing the same name.
 * - **Identity only.** No `target`, no `metadata`, no excerpt. `{previousId, recordId, action}` is
 *   enough to resolve a reference, and a stored bookkeeping object is not the place for a capture's
 *   text (G2.10).
 *
 * It is keyed by import rather than kept as one flat map: "which import brought this in" is the
 * question a user has when a remap surprises them, and one flat map cannot answer it.
 */

import type { RemapLookup } from "../types/index.js";

export const REMAP_STORAGE_KEY = "hipcortex.capture.migration.remap" as const;

/** The version of the *stored* shape. A shape change is a migration of this file, not of a core. */
export const REMAP_STORE_VERSION = 1 as const;

/**
 * Which of a record's two identities `previousId` is.
 *
 * The distinction is user-facing: a `core-id` is a string the core printed, an `event-id` is the one
 * this extension minted at capture time. Someone resolving an id they copied out of a CLI output and
 * someone resolving one they copied out of this extension should be told which they have.
 */
export type RemapKeyKind = "core-id" | "event-id";

export interface RemapMapping {
  readonly previousId: string;
  readonly kind: RemapKeyKind;
  /** The id the destination core issued. The point of the whole file. */
  readonly recordId: string;
  readonly action: string;
}

export interface RemapBatch {
  /**
   * This import run's identity. Minted once per import, so two imports are two batches even when the
   * clock has not moved between them — grouping by `importedAt` alone would merge them, and
   * "how many imports touched this id" would then answer with an undercount.
   */
  readonly runId: string;
  readonly importedAt: string;
  readonly actor: string;
  /**
   * What this run recorded. Named for what each one is — one old id leading to one new id — rather
   * than for the queue's vocabulary, which is a different store with a different promise (G2.1).
   */
  readonly mappings: readonly RemapMapping[];
}

export interface RemapStore {
  readonly version: number;
  readonly batches: readonly RemapBatch[];
}

const EMPTY_STORE: RemapStore = { version: REMAP_STORE_VERSION, batches: [] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toMapping(value: unknown): RemapMapping | null {
  if (!isPlainRecord(value)) return null;
  const { previousId, recordId, kind, action } = value;
  if (!isNonEmptyString(previousId) || !isNonEmptyString(recordId)) return null;
  return {
    previousId,
    recordId,
    kind: kind === "event-id" ? "event-id" : "core-id",
    action: isNonEmptyString(action) ? action : "",
  };
}

function toBatch(value: unknown): RemapBatch | null {
  if (!isPlainRecord(value)) return null;
  const mappings = Array.isArray(value["mappings"])
    ? value["mappings"].map(toMapping).filter((mapping): mapping is RemapMapping => mapping !== null)
    : [];
  const importedAt = value["importedAt"];
  const actor = value["actor"];
  if (!isNonEmptyString(importedAt) || mappings.length === 0) return null;
  // A batch stored before the run identity existed falls back to its timestamp, which is what it was
  // grouped by. Tolerated rather than dropped: a dropped batch is lost remap data, and remap data is
  // the one thing in this extension nothing else can rebuild.
  const runId = value["runId"];
  return {
    runId: isNonEmptyString(runId) ? runId : importedAt,
    importedAt,
    actor: isNonEmptyString(actor) ? actor : "",
    mappings,
  };
}

/**
 * Read the store, or an empty store.
 *
 * A stored shape that does not parse is read as empty rather than thrown over: this file is a record
 * of a transition, and a corrupt entry cannot be repaired by refusing to read the rest. Nothing here
 * validates a *core's* state, so nothing here is a correctness gate — the worst case of an empty read
 * is a lookup that answers "not in the remap", which is a state this module already has to be able to
 * report truthfully.
 */
export async function readRemap(): Promise<RemapStore> {
  const stored = await chrome.storage.local.get(REMAP_STORAGE_KEY);
  const value = stored[REMAP_STORAGE_KEY];
  if (!isPlainRecord(value)) return EMPTY_STORE;
  const batches = Array.isArray(value["batches"])
    ? value["batches"].map(toBatch).filter((batch): batch is RemapBatch => batch !== null)
    : [];
  return { version: REMAP_STORE_VERSION, batches };
}

/**
 * Record one acknowledged import, one entry at a time.
 *
 * It is called *per record* rather than once per import on purpose: an import that stops halfway — a
 * closed page, an evicted worker, a run the user cancelled — leaves a remap of exactly the records the
 * core confirmed, which is a truthful partial answer. Collecting the whole import and writing once
 * would make the remap a summary of an operation that may not have finished.
 *
 * The cost is a read-modify-write per record, which is the price of that truthfulness and is paid only
 * during a manual migration.
 */
export async function appendRemapMapping(
  mapping: RemapMapping,
  context: { readonly runId: string; readonly importedAt: string; readonly actor: string }
): Promise<void> {
  const store = await readRemap();
  const last = store.batches[store.batches.length - 1];
  const sameImport = last !== undefined && last.runId === context.runId;

  const batches: RemapBatch[] = sameImport
    ? [...store.batches.slice(0, -1), { ...last, mappings: [...last.mappings, mapping] }]
    : [
        ...store.batches,
        { runId: context.runId, importedAt: context.importedAt, actor: context.actor, mappings: [mapping] },
      ];

  await chrome.storage.local.set({
    [REMAP_STORAGE_KEY]: { version: REMAP_STORE_VERSION, batches },
  });
}

/**
 * Answer "where did this go?" for an id from before an import.
 *
 * The newest matching entry wins. Two imports of the same document produce two entries for one
 * previous id — the runtime keeps both records (section 6.2 of `docs/PROTOCOL.md`: a duplicate does
 * not overwrite anything) — and the useful answer is the most recent one, which is the record a user
 * is asking about when they re-run an import and look a reference up afterwards.
 *
 * `imports` is reported even when nothing matched, so an empty answer can be told apart from an empty
 * store. A user who has never imported anything is not looking at a bug.
 */
export async function resolvePreviousId(previousId: string): Promise<RemapLookup> {
  const store = await readRemap();
  const wanted = previousId.trim();

  let found: RemapLookup | null = null;
  for (const batch of store.batches) {
    for (const mapping of batch.mappings) {
      if (mapping.previousId !== wanted) continue;
      found = {
        previousId: wanted,
        found: true,
        recordId: mapping.recordId,
        action: mapping.action,
        importedAt: batch.importedAt,
        imports: store.batches.length,
      };
    }
  }

  return found ?? { previousId: wanted, found: false, imports: store.batches.length };
}
