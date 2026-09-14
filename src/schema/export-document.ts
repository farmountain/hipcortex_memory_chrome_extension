/**
 * The export document — one record shape, two producers, one consumer.
 *
 * `cortexbridge-retention-boundary` exports the *undelivered* queue; `substrate-migration` exports an
 * actor's *stored* records. Both have to produce something that can be imported later without a
 * translation step, so both produce this document and `readExportDocument` below is the single place
 * that decides whether a document may be imported at all. Two producers and one reader is the point:
 * a second reader would be a second set of rules, and the rules are the guarantee.
 *
 * Four rules live here rather than in either change.
 *
 * - **The document states its own version.** A document declaring a version this build does not
 *   understand is refused, naming the version found and the version understood. Refusing is the safe
 *   direction: a newer document may give an existing field a meaning this build would silently
 *   misread, and a misread memory is worse than a refused import.
 * - **A core-owned field is accepted and dropped; an unknown field is refused.** `id`, `integrity`,
 *   `status`, `version`, `timestamp`, `expires_at` and `confidence` are assigned by the runtime, which
 *   regenerates every one of them on import (verified, `docs/PROTOCOL.md` section 6.1), so they are
 *   read, noted and not re-sent. Any *other* field this contract does not define is refused with the
 *   record named, because a field an import silently drops is a field the user believes they
 *   migrated. Dropping a core-owned field is safe because the runtime re-derives it; dropping an
 *   unknown field is not safe, because nothing re-derives it.
 * - **Refusal is all-or-nothing.** Every failure is collected and returned together, so a user learns
 *   about a bad record *before* any of the good ones have been written.
 * - **`metadata` equality is deep.** The runtime re-serialises the object with a different key order
 *   (verified against 3.11.0), so a string comparison of two equal objects reports a difference that
 *   is not one. Callers asserting round-trip equality must compare structurally.
 */

import { RESERVED_PROVENANCE_KEY } from "./egress.js";

/** The version this build writes, and the oldest one it can still read. */
export const EXPORT_SCHEMA_VERSION = 1 as const;

export const SUPPORTED_EXPORT_VERSIONS: readonly number[] = [EXPORT_SCHEMA_VERSION];

/**
 * Fields the runtime owns.
 *
 * Accepted on read and deliberately not carried into the imported record. They are listed rather than
 * ignored because "recognised and re-derived" and "unrecognised" must be different outcomes.
 */
export const CORE_OWNED_EXPORT_FIELDS: readonly string[] = [
  "id",
  "integrity",
  "status",
  "version",
  "timestamp",
  "expires_at",
  "confidence",
];

/** The fields this contract defines on a record. Anything outside this set is refused. */
export const EXPORT_RECORD_FIELDS: readonly string[] = [
  "actor",
  "action",
  "target",
  "record_type",
  "source",
  "tags",
  "priority",
  "metadata",
];

/** The fields this contract defines on the document. Anything outside this set is refused. */
export const EXPORT_DOCUMENT_FIELDS: readonly string[] = [
  "schema_version",
  "exported_at",
  "actor",
  "records",
  "total",
];

/** The fields an import cannot proceed without. */
const REQUIRED_RECORD_FIELDS: readonly string[] = ["actor", "action", "target"];

/**
 * One record, in the shape the runtime's own export uses.
 *
 * `ttl_seconds` is absent by construction, exactly as it is on the capture egress record: emitting a
 * value would create a memory that looks stored and is deleted later.
 */
export interface ExportRecord {
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly record_type?: string;
  readonly source?: string;
  readonly tags?: readonly string[];
  readonly priority?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ExportDocument {
  readonly schema_version: number;
  readonly exported_at: string;
  /** The actor the document was produced for, when it covers exactly one. `null` for a mixed document. */
  readonly actor: string | null;
  readonly records: readonly ExportRecord[];
  readonly total: number;
}

/** Something the reader accepted but had to interpret. Reported, never silent. */
export interface ExportReadNote {
  readonly kind: "VERSION_DEFAULTED" | "CORE_FIELD_DROPPED";
  readonly detail: string;
}

export interface ExportReadFailure {
  readonly kind:
    | "MALFORMED_DOCUMENT"
    | "UNSUPPORTED_VERSION"
    | "MALFORMED_RECORD"
    | "UNKNOWN_FIELD";
  /** Which record, by position. `null` when the failure is about the document. */
  readonly index: number | null;
  /** The field at fault, when the failure is about one. */
  readonly field?: string;
  readonly detail: string;
}

export type ExportReadResult =
  | { readonly ok: true; readonly document: ExportDocument; readonly notes: readonly ExportReadNote[] }
  | { readonly ok: false; readonly failures: readonly ExportReadFailure[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build the document both producers emit.
 *
 * `exportedAt` is a parameter rather than a clock read so the caller owns the one source of time in
 * the process, and so a spec can pin it.
 */
export function toExportDocument(
  records: readonly ExportRecord[],
  options: { readonly actor: string | null; readonly exportedAt: string }
): ExportDocument {
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: options.exportedAt,
    actor: options.actor,
    records,
    total: records.length,
  };
}

/** `3 (id 96dd67db)` — a record named well enough to be found by someone reading an error. */
function label(raw: Record<string, unknown>, index: number): string {
  const id = raw["id"];
  const suffix = isNonEmptyString(id) ? ` (id ${id})` : "";
  return `record ${index}${suffix}`;
}

interface RecordRead {
  readonly record: ExportRecord | null;
  readonly failures: readonly ExportReadFailure[];
  readonly notes: readonly ExportReadNote[];
}

function readRecord(raw: unknown, index: number): RecordRead {
  const failures: ExportReadFailure[] = [];
  const notes: ExportReadNote[] = [];

  if (!isPlainRecord(raw)) {
    return {
      record: null,
      failures: [
        { kind: "MALFORMED_RECORD", index, detail: `record ${index} is not a JSON object` },
      ],
      notes,
    };
  }

  const unknown = Object.keys(raw).filter(
    (key) => !EXPORT_RECORD_FIELDS.includes(key) && !CORE_OWNED_EXPORT_FIELDS.includes(key)
  );
  for (const field of unknown) {
    failures.push({
      kind: "UNKNOWN_FIELD",
      index,
      field,
      detail: `${label(raw, index)} carries field "${field}", which this contract does not define`,
    });
  }

  const dropped = Object.keys(raw).filter((key) => CORE_OWNED_EXPORT_FIELDS.includes(key));
  if (dropped.length > 0) {
    notes.push({
      kind: "CORE_FIELD_DROPPED",
      detail: `${label(raw, index)}: ${dropped.join(", ")} are assigned by the runtime and are not imported`,
    });
  }

  for (const field of REQUIRED_RECORD_FIELDS) {
    if (!isNonEmptyString(raw[field])) {
      failures.push({
        kind: "MALFORMED_RECORD",
        index,
        field,
        detail: `${label(raw, index)} is missing required field "${field}"`,
      });
    }
  }

  const tags = raw["tags"];
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every(isNonEmptyString))) {
    failures.push({
      kind: "MALFORMED_RECORD",
      index,
      field: "tags",
      detail: `${label(raw, index)} has a "tags" field that is not an array of strings`,
    });
  }

  const metadata = raw["metadata"];
  if (metadata !== undefined && !isPlainRecord(metadata)) {
    failures.push({
      kind: "MALFORMED_RECORD",
      index,
      field: "metadata",
      detail: `${label(raw, index)} has a "metadata" field that is not a JSON object`,
    });
  }

  if (failures.length > 0) return { record: null, failures, notes };

  const record: ExportRecord = {
    actor: raw["actor"] as string,
    action: raw["action"] as string,
    target: raw["target"] as string,
    ...(isNonEmptyString(raw["record_type"]) ? { record_type: raw["record_type"] } : {}),
    ...(isNonEmptyString(raw["source"]) ? { source: raw["source"] } : {}),
    ...(Array.isArray(tags) ? { tags: tags as string[] } : {}),
    ...(isNonEmptyString(raw["priority"]) ? { priority: raw["priority"] } : {}),
    ...(isPlainRecord(metadata) ? { metadata } : {}),
  };

  return { record, failures, notes };
}

/**
 * Decide whether a parsed JSON value may be imported, and hand back the records to import if so.
 *
 * Total by design: the caller gets a result rather than an exception, because the two callers are an
 * options-page import and a queue export, and neither should be able to throw on user-supplied JSON.
 */
export function readExportDocument(value: unknown): ExportReadResult {
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      failures: [
        { kind: "MALFORMED_DOCUMENT", index: null, detail: "the document is not a JSON object" },
      ],
    };
  }

  const documentUnknown = Object.keys(value).filter((key) => !EXPORT_DOCUMENT_FIELDS.includes(key));
  if (documentUnknown.length > 0) {
    return {
      ok: false,
      failures: documentUnknown.map((field) => ({
        kind: "UNKNOWN_FIELD" as const,
        index: null,
        field,
        detail: `the document carries field "${field}", which this contract does not define`,
      })),
    };
  }

  const declared = value["schema_version"];
  const notes: ExportReadNote[] = [];
  if (declared !== undefined) {
    if (!Number.isInteger(declared) || !SUPPORTED_EXPORT_VERSIONS.includes(declared as number)) {
      return {
        ok: false,
        failures: [
          {
            kind: "UNSUPPORTED_VERSION",
            index: null,
            detail: `the document declares schema_version ${JSON.stringify(declared)}; this build understands ${SUPPORTED_EXPORT_VERSIONS.join(", ")}`,
          },
        ],
      };
    }
  } else {
    // The runtime's own `GET /memory/export` states no version and its record shape is frozen, so an
    // undeclared document is read as version 1 — and *said so*, rather than defaulted in silence.
    notes.push({
      kind: "VERSION_DEFAULTED",
      detail: `the document declares no schema_version; read as ${EXPORT_SCHEMA_VERSION}`,
    });
  }

  const failures: ExportReadFailure[] = [];
  if (!isNonEmptyString(value["exported_at"])) {
    failures.push({
      kind: "MALFORMED_DOCUMENT",
      index: null,
      detail: `the document has no "exported_at" timestamp`,
    });
  }

  const rawRecords = value["records"];
  if (!Array.isArray(rawRecords)) {
    failures.push({
      kind: "MALFORMED_DOCUMENT",
      index: null,
      detail: `the document has no "records" array`,
    });
    return { ok: false, failures };
  }

  const records: ExportRecord[] = [];
  rawRecords.forEach((raw, index) => {
    const read = readRecord(raw, index);
    failures.push(...read.failures);
    notes.push(...read.notes);
    if (read.record) records.push(read.record);
  });

  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    document: toExportDocument(records, {
      actor: isNonEmptyString(value["actor"]) ? value["actor"] : null,
      exportedAt: value["exported_at"] as string,
    }),
    notes,
  };
}

/**
 * Where a record's identity stood before the import.
 *
 * Two identities are recorded because the two producers of this document carry different ones, and
 * the remap has to be able to answer for whichever the user names.
 *
 * - `sourceId` is the runtime's own `id`. The reader drops it — the runtime regenerates identity on
 *   import (`docs/PROTOCOL.md` section 6.1), so re-sending it would be asserting an id this
 *   repository does not own — but it is exactly what a user holds when they ask "where did this
 *   record go?", so it is read here and written into the remap instead of into a record.
 * - `eventId` is the capture's own identity, minted by this extension at capture time and carried
 *   inside `metadata` ever since. It is the same string on both sides of an import, which is what
 *   makes it a usable key for a document this repository produced (that document states no `id` at
 *   all — see `tests/capture/queue-export.spec.ts`, "carries no export-only field").
 *
 * It is a *lookup key*, never a field: nothing this returns is written into a record.
 */
export interface ExportSourceIdentity {
  readonly index: number;
  readonly sourceId: string | null;
  readonly eventId: string | null;
}

export interface ParsedExportDocument {
  readonly read: ExportReadResult;
  /** In record order. Empty unless the document was accepted, because a refused document is not read. */
  readonly identities: readonly ExportSourceIdentity[];
}

/**
 * Read a document from the text of a file — the one place a file becomes a document.
 *
 * Two jobs that are deliberately not merged. `readExportDocument` stays the only authority on which
 * fields are accepted, and it runs first; the identity read runs *only* on a document it accepted, so
 * a refused document yields no identities and therefore cannot write anything. Keeping them in one
 * function is what stops a caller from parsing the same text twice and getting two opinions of it.
 *
 * The JSON parse is caught here rather than left to the caller: the input is a file a user chose, and
 * "that is not JSON" is a refusal like any other, not a crash.
 */
export function parseExportDocument(text: string): ParsedExportDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      read: {
        ok: false,
        failures: [
          { kind: "MALFORMED_DOCUMENT", index: null, detail: `the file is not JSON: ${detail}` },
        ],
      },
      identities: [],
    };
  }

  const read = readExportDocument(value);
  if (!read.ok) return { read, identities: [] };

  const rawRecords = (value as { records: unknown }).records;
  const identities = Array.isArray(rawRecords) ? rawRecords.map(readSourceIdentity) : [];

  return { read, identities };
}

function readSourceIdentity(raw: unknown, index: number): ExportSourceIdentity {
  if (!isPlainRecord(raw)) return { index, sourceId: null, eventId: null };

  const sourceId = isNonEmptyString(raw["id"]) ? raw["id"] : null;
  const metadata = raw["metadata"];
  const provenance = isPlainRecord(metadata) ? metadata[RESERVED_PROVENANCE_KEY] : undefined;
  const eventId =
    isPlainRecord(provenance) && isNonEmptyString(provenance["eventId"])
      ? provenance["eventId"]
      : null;

  return { index, sourceId, eventId };
}
