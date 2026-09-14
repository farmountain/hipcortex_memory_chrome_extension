/**
 * Version mismatch, and the all-or-nothing rule — G4.3 (tasks 3.1 – 3.3).
 *
 * The rule under test is not "reject a document you do not understand". It is "a document you do not
 * fully understand is imported *entirely or not at all*, and the reason is said out loud". A reader
 * that skipped the field it did not know and imported the rest would produce a store that looks
 * migrated and is not — the failure mode this requirement exists to make impossible.
 *
 * So every test here that expects a refusal also asserts the second half: nothing was written. That is
 * the half a refactor drops first, and it is the half that makes the refusal worth anything.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { importDocument } from "../../src/migration/import.js";
import { REMAP_STORAGE_KEY, resolvePreviousId } from "../../src/migration/remap.js";
import { CORE_OWNED_EXPORT_FIELDS, EXPORT_SCHEMA_VERSION } from "../../src/schema/index.js";
import type { ExportRecord } from "../../src/schema/index.js";
import { installChromeMock } from "../helpers/chrome-mock.js";
import {
  EVENT_ID,
  IMPORT_ACTOR,
  IMPORTED_AT,
  SOURCE_ACTOR,
  acknowledged,
  coreShapeDocument,
  makeExportRecord,
  ownExportDocument,
  recordStub,
} from "../helpers/export.js";
import type { RecordStub } from "../helpers/export.js";

/** A document with one well-formed record, plus whatever the case needs to make it wrong. */
function documentWith(
  extraRecord: Record<string, unknown>,
  record: ExportRecord = makeExportRecord()
): string {
  return JSON.stringify({
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: IMPORTED_AT,
    actor: SOURCE_ACTOR,
    total: 2,
    records: [record, extraRecord],
  });
}

function documentDeclaring(schemaVersion: unknown): string {
  return JSON.stringify({
    schema_version: schemaVersion,
    exported_at: IMPORTED_AT,
    actor: SOURCE_ACTOR,
    total: 1,
    records: [makeExportRecord()],
  });
}

function importOf(text: string, stub: RecordStub) {
  return importDocument({ text, actor: IMPORT_ACTOR, now: () => new Date(IMPORTED_AT), send: stub.send });
}

beforeEach(() => {
  installChromeMock();
});

describe("an unknown schema version is refused, and both versions are named — G4.3 (task 3.1)", () => {
  it("names the version found and the version understood, and writes nothing", async () => {
    const stub = recordStub();

    const report = await importOf(documentDeclaring(99), stub);

    expect(report.imported).toBe(0);
    expect(report.outcomes).toEqual([]);
    expect(report.failures.map((failure) => failure.kind)).toEqual(["UNSUPPORTED_VERSION"]);
    // "which one did it want?" is the first question a user has, so the reply answers it.
    expect(report.failures[0]?.detail).toContain("99");
    expect(report.failures[0]?.detail).toContain(String(EXPORT_SCHEMA_VERSION));
    expect(stub.sent).toEqual([]);
    expect((await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY]).toBeUndefined();
  });

  it("refuses a version that is a number-like string, rather than coercing it", async () => {
    const stub = recordStub();

    const report = await importOf(documentDeclaring(String(EXPORT_SCHEMA_VERSION)), stub);

    // `"1"` and `1` are different documents. Accepting one as the other is how a contract stops being
    // one, and the reply shows the value it actually found rather than the number it is near.
    expect(report.failures[0]?.kind).toBe("UNSUPPORTED_VERSION");
    expect(report.failures[0]?.detail).toContain(`"${EXPORT_SCHEMA_VERSION}"`);
    expect(stub.sent).toEqual([]);
  });

  it("imports a document that declares the version this build understands", async () => {
    const stub = recordStub();

    const report = await importOf(documentDeclaring(EXPORT_SCHEMA_VERSION), stub);

    expect(report.failures).toEqual([]);
    expect(report.imported).toBe(1);
    expect(stub.sent).toHaveLength(1);
  });

  it("reads an unversioned document as version 1, and says that it defaulted", async () => {
    const stub = recordStub();

    const report = await importOf(coreShapeDocument([makeExportRecord()]), stub);

    // The runtime's own export states no version. Defaulting silently would be the same rule with a
    // worse report, so the note carries the version that was assumed.
    expect(report.imported).toBe(1);
    const note = report.notes.find((entry) => entry.kind === "VERSION_DEFAULTED");
    expect(note?.detail).toContain(String(EXPORT_SCHEMA_VERSION));
  });
});

describe("a refusal is all-or-nothing, not record by record — G4.3 (task 3.2)", () => {
  it("imports none of a document whose second record is unreadable", async () => {
    const stub = recordStub();

    // The first record is entirely valid and comes first. A reader that imported as it read would have
    // written it before discovering the second one, and its store would be half migrated.
    const report = await importOf(documentWith({ ...makeExportRecord(), emotion: "calm" }), stub);

    expect(report.imported).toBe(0);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(stub.sent).toEqual([]);
    expect((await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY]).toBeUndefined();
  });

  it("reports no notes when it refused, so a partial success cannot be read out of one", async () => {
    const stub = recordStub();

    // A core-owned field produces a note, and the unknown field produces the refusal. On a refusal
    // neither is returned: `notes` would otherwise invite a surface to show "1 field dropped" beside
    // "0 of 2 imported" and call it progress.
    const record = { ...makeExportRecord(), id: "old-1" };
    const report = await importOf(documentWith({ ...makeExportRecord(), mystery: true }, record), stub);

    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.notes).toEqual([]);
    expect(stub.sent).toEqual([]);
  });

  it("leaves a remap recorded by an earlier import exactly as it was", async () => {
    const good = recordStub([acknowledged("new-core-1")]);
    await importOf(ownExportDocument([makeExportRecord()]), good);
    const before = (await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY];

    const stub = recordStub();
    await importOf(documentDeclaring(99), stub);

    expect((await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY]).toEqual(before);
    const lookup = await resolvePreviousId(EVENT_ID);
    expect(lookup.found).toBe(true);
    expect(lookup.recordId).toBe("new-core-1");
    expect(lookup.imports).toBe(1);
  });
});

describe("an unknown field cannot be dropped in silence — G4.3 (task 3.3)", () => {
  it("refuses a record carrying a field the contract does not define, and names it", async () => {
    const stub = recordStub();

    const report = await importOf(documentWith({ ...makeExportRecord(), emotion: "calm" }), stub);

    const failure = report.failures.find((entry) => entry.kind === "UNKNOWN_FIELD");
    expect(failure?.field).toBe("emotion");
    expect(failure?.index).toBe(1);
    expect(failure?.detail).toContain("emotion");
    expect(stub.sent).toEqual([]);
  });

  it("refuses an unknown document-level field too, because the document is the contract", async () => {
    const stub = recordStub();
    const text = JSON.stringify({
      schema_version: EXPORT_SCHEMA_VERSION,
      exported_at: IMPORTED_AT,
      actor: SOURCE_ACTOR,
      total: 1,
      records: [makeExportRecord()],
      future_field: "something new",
    });

    const report = await importOf(text, stub);

    expect(report.failures.map((entry) => entry.kind)).toEqual(["UNKNOWN_FIELD"]);
    expect(report.failures[0]?.field).toBe("future_field");
    expect(stub.sent).toEqual([]);
  });

  it("drops the core-owned fields and only those, with a note naming what it dropped", async () => {
    const stub = recordStub();
    // `id` is tolerated because the runtime assigns it; `ids` is not, because nothing has agreed what
    // it would mean. The tolerated set is exactly the core-owned list — not a prefix, not a guess.
    const record = { ...makeExportRecord(), id: "old-1", ids: ["old-1"] };

    const report = await importOf(coreShapeDocument([record]), stub);

    expect(report.failures.map((entry) => entry.field)).toEqual(["ids"]);
    for (const field of CORE_OWNED_EXPORT_FIELDS) {
      expect(report.failures.map((entry) => entry.field)).not.toContain(field);
    }
    expect(stub.sent).toEqual([]);
  });

  it("imports a core-shaped record that carries every core-owned field, and says which it dropped", async () => {
    const stub = recordStub();
    const coreFields = {
      id: "old-1",
      integrity: "sha256:abc",
      status: "active",
      version: 2,
      timestamp: IMPORTED_AT,
      expires_at: IMPORTED_AT,
      confidence: 0.9,
    };

    const report = await importOf(coreShapeDocument([{ ...makeExportRecord(), ...coreFields }]), stub);

    expect(report.imported).toBe(1);
    const note = report.notes.find((entry) => entry.kind === "CORE_FIELD_DROPPED");
    for (const field of Object.keys(coreFields)) expect(note?.detail).toContain(field);
    expect(stub.sent[0]).not.toHaveProperty("integrity");
  });

  it("names the record and the field when a required field is missing", async () => {
    const stub = recordStub();
    const withoutTarget: Record<string, unknown> = { ...makeExportRecord() };
    delete withoutTarget["target"];

    const report = await importOf(documentWith(withoutTarget), stub);

    const failure = report.failures.find((entry) => entry.kind === "MALFORMED_RECORD");
    expect(failure?.index).toBe(1);
    expect(failure?.field).toBe("target");
    expect(stub.sent).toEqual([]);
  });

  it("rejects a file that is not JSON, naming the parse problem rather than throwing", async () => {
    const stub = recordStub();

    const report = await importOf("{ this is not json", stub);

    expect(report.failures[0]?.kind).toBe("MALFORMED_DOCUMENT");
    expect(report.failures[0]?.detail).toContain("not JSON");
    expect(stub.sent).toEqual([]);
  });

  it("answers rather than throwing for a file that is JSON but not a document", async () => {
    const stub = recordStub();

    for (const text of ["null", "[]", '"a string"', "42", "{}"]) {
      const report = await importOf(text, stub);
      expect(report.imported, text).toBe(0);
      expect(report.failures.length, text).toBeGreaterThan(0);
    }
    expect(stub.sent).toEqual([]);
  });
});
