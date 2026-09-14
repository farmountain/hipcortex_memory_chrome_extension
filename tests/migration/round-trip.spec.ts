/**
 * The migration round trip — G4.2 (tasks 2.1 – 2.4, 2.6).
 *
 * What is proven here is the part of the claim a spec can hold: the record that leaves the document is
 * the record that reaches the wire, field for field, with the two fields the runtime owns left out
 * rather than sent and hoped for. What a mock cannot prove is that the runtime then regenerates `id`
 * and `integrity` and stores the rest unchanged — a canned response is not a core — so that half is
 * live evidence against 3.11.0 recorded in `tasks.md`, and the specs are written to make the
 * difference visible rather than to paper over it (design.md, recorded limitation 1).
 *
 * The `send` stub is deliberately a *recorder*: the assertions are about what was posted. A stub that
 * answered without recording could not tell "imported with every field" from "imported what was left
 * of the document".
 */

import { beforeEach, describe, expect, it } from "vitest";

import { toAddBody } from "../../src/api/transport/endpoints.js";
import type { SendResult } from "../../src/api/transport/index.js";
import { importDocument } from "../../src/migration/import.js";
import { REMAP_STORAGE_KEY, resolvePreviousId } from "../../src/migration/remap.js";
import { CORE_OWNED_EXPORT_FIELDS, EXPORT_SCHEMA_VERSION } from "../../src/schema/index.js";
import type { ExportRecord } from "../../src/schema/index.js";
import type { MemoryRecord } from "../../src/types/index.js";
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
  refused,
} from "../helpers/export.js";

const PINNED = "pinned";

/** The actor the destination stamps. The document's own actor is a different one on purpose. */
const ACTOR = IMPORT_ACTOR;

function sourceRecord(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return makeExportRecord(overrides);
}

/**
 * The spec's own words for the shared builders: a *core* stub answers the way a runtime does, and a
 * *source* record is one a document carries. Aliased rather than renamed at every call site so the
 * assertions below read as the scenario they describe.
 */
const coreStub = recordStub;
const ownDocument = ownExportDocument;
const coreDocument = coreShapeDocument;

function importOf(
  text: string,
  stub: { send: (record: MemoryRecord) => Promise<SendResult> }
) {
  return importDocument({ text, actor: ACTOR, now: () => new Date(IMPORTED_AT), send: stub.send });
}

beforeEach(() => {
  installChromeMock();
});

describe("an import is field-equivalent, and never byte-equivalent — G4.2 (task 2.3)", () => {
  it("posts every field the document states, under the destination's actor", async () => {
    const record = sourceRecord({ priority: PINNED });
    const stub = coreStub();

    const report = await importOf(ownDocument([record]), stub);

    expect(report.imported).toBe(1);
    expect(report.refused).toBe(0);
    expect(stub.sent).toHaveLength(1);
    const posted = stub.sent[0]!;

    // Asserted by name rather than as one object literal: a field that stopped being copied should
    // fail as a named missing field, not as an opaque two-object diff.
    expect(posted.actor).toBe(ACTOR);
    expect(posted.action).toBe(record.action);
    expect(posted.target).toBe(record.target);
    expect(posted.record_type).toBe(record.record_type);
    expect(posted.source).toBe(record.source);
    expect(posted.tags).toEqual(record.tags);
    expect(posted.priority).toBe(PINNED);
    expect(posted.metadata).toEqual(record.metadata);
  });

  it("carries priority as far as the wire, because the runtime keeps what it is sent", async () => {
    const stub = coreStub();
    await importOf(ownDocument([sourceRecord({ priority: PINNED })]), stub);

    // The body, not the record: a field the record carries and `toAddBody` drops would be exactly the
    // silent loss this change exists to remove, and only the body reaches the core.
    expect(toAddBody(stub.sent[0]!)["priority"]).toBe(PINNED);
  });

  it("leaves priority out of a body whose record states none, so capture egress is unchanged", async () => {
    const stub = coreStub();
    await importOf(ownDocument([sourceRecord()]), stub);

    expect("priority" in toAddBody(stub.sent[0]!)).toBe(false);
  });

  it("sends no core-owned field, because the runtime regenerates every one of them", async () => {
    // The core's own export: it carries the fields the core owns, and they must not be echoed back.
    const record = { ...sourceRecord(), id: "old-id-1", integrity: "sha256:abc", status: "active" };
    const stub = coreStub();

    const report = await importOf(coreDocument([record]), stub);

    expect(report.imported).toBe(1);
    const posted = stub.sent[0]!;
    for (const field of CORE_OWNED_EXPORT_FIELDS) {
      expect(posted, `the posted record must not carry ${field}`).not.toHaveProperty(field);
    }
    // Dropped *and said so*: an import that reported a clean run while discarding the identity a user
    // can see in their own export would be hiding the one difference that matters.
    expect(report.notes.map((note) => note.kind)).toContain("CORE_FIELD_DROPPED");
  });

  it("compares metadata deeply, because a string compare reports a difference that is not one", async () => {
    const metadata = {
      "hipcortex.capture": { eventId: EVENT_ID, schemaVersion: EXPORT_SCHEMA_VERSION },
      zzz: 1,
      aaa: [1, 2, 3],
    };
    const reordered = {
      aaa: [1, 2, 3],
      zzz: 1,
      "hipcortex.capture": { schemaVersion: EXPORT_SCHEMA_VERSION, eventId: EVENT_ID },
    };
    const stub = coreStub();

    await importOf(ownDocument([sourceRecord({ metadata })]), stub);

    // The control first: these two are the same value in a different key order, and a string compare
    // says they differ. That is why the assertion below has to be structural.
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(metadata));
    expect(stub.sent[0]?.metadata).toEqual(reordered);
  });
});

describe("the remap is what makes an import resolvable afterwards — G4.2 (task 2.4)", () => {
  it("resolves the id the source document stated to the id the core issued", async () => {
    const stub = coreStub([acknowledged("new-core-id-9")]);

    const report = await importOf(coreDocument([{ ...sourceRecord(), id: "old-core-id-1" }]), stub);

    expect(report.outcomes[0]?.recordId).toBe("new-core-id-9");
    const lookup = await resolvePreviousId("old-core-id-1");
    expect(lookup.found).toBe(true);
    expect(lookup.recordId).toBe("new-core-id-9");
    expect(lookup.imports).toBe(1);
    // `previousId` is echoed so a caller cannot pair a lookup with the wrong question.
    expect(lookup.previousId).toBe("old-core-id-1");
  });

  it("also resolves the capture's own eventId, which is the only identity this repository emits", async () => {
    const stub = coreStub([acknowledged("new-core-id-9")]);

    await importOf(ownDocument([sourceRecord()]), stub);

    const lookup = await resolvePreviousId(EVENT_ID);
    expect(lookup.found).toBe(true);
    expect(lookup.recordId).toBe("new-core-id-9");
  });

  it("answers an unknown id as not found, and says how many imports it does hold", async () => {
    const empty = await resolvePreviousId("nothing-like-this");

    expect(empty.found).toBe(false);
    expect(empty.imports).toBe(0);
    // Not an error: an id that predates the remap is a real answer, and so is an empty store.
    expect(empty.recordId).toBeUndefined();
  });

  it("records nothing for a document that carried no identity at all", async () => {
    // A hand-written document may state neither an id nor a provenance object. It still imports —
    // the records are the point — and the remap stays empty rather than gaining an empty key.
    const bare: ExportRecord = { actor: SOURCE_ACTOR, action: "capture:x", target: "a line" };
    const stub = coreStub();

    const report = await importOf(ownDocument([bare]), stub);

    expect(report.imported).toBe(1);
    expect(report.outcomes[0]?.previousId).toBeUndefined();
    const stored = await chrome.storage.local.get(REMAP_STORAGE_KEY);
    expect(stored[REMAP_STORAGE_KEY]).toBeUndefined();
  });

  it("keeps every entry of the import in one batch, timestamped once", async () => {
    const stub = coreStub([acknowledged("new-1"), acknowledged("new-2")]);

    await importOf(ownDocument([sourceRecord({ action: "capture:a" }), sourceRecord({ action: "capture:b" })]), stub);

    const stored = (await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY] as {
      batches: readonly {
        runId: string;
        importedAt: string;
        actor: string;
        mappings: readonly { recordId: string }[];
      }[];
    };
    expect(stored.batches).toHaveLength(1);
    expect(stored.batches[0]?.importedAt).toBe(IMPORTED_AT);
    expect(stored.batches[0]?.actor).toBe(ACTOR);
    // The batch is identified by the run, not by the clock: a second import in the same millisecond
    // is a second import, and the per-record write must not merge the two runs into one.
    expect(stored.batches[0]?.runId.length).toBeGreaterThan(0);
    expect(stored.batches[0]?.mappings.map((mapping) => mapping.recordId)).toEqual(["new-1", "new-2"]);
  });
});

describe("a repeat import duplicates, and the advisory is reported — G4.2 (task 2.6)", () => {
  it("imports again rather than merging, and passes the core's own advisory through", async () => {
    const document = coreDocument([{ ...sourceRecord(), id: "old-core-id-1" }]);
    const first = coreStub([acknowledged("new-1")]);
    const second = coreStub([
      acknowledged("new-2", [{ action: "capture:chatgpt", id: "new-1", overlapRatio: 62 }]),
    ]);

    const once = await importOf(document, first);
    const twice = await importOf(document, second);

    // Both records exist in the core afterwards — a duplicate does not overwrite (PROTOCOL 6.2) — so
    // "imported" is the truthful outcome in both runs.
    expect(once.imported).toBe(1);
    expect(twice.imported).toBe(1);
    expect(twice.refused).toBe(0);
    expect(twice.outcomes[0]?.duplicated).toBe(true);
    expect(twice.outcomes[0]?.detail).toContain("new-1");

    // The newest entry wins, because that is the record a user is asking about when they re-import
    // and then look a reference up.
    const lookup = await resolvePreviousId("old-core-id-1");
    expect(lookup.recordId).toBe("new-2");
    expect(lookup.imports).toBe(2);
  });

  it("does not record an advisory as a refusal: the record was accepted and named", async () => {
    const stub = coreStub([
      acknowledged("new-2", [{ action: "capture:chatgpt", id: "new-1", overlapRatio: 62 }]),
    ]);

    const report = await importOf(ownDocument([sourceRecord()]), stub);

    // Reporting an accepted record as refused would be the mirror image of the mistake the
    // acknowledgement rule forbids (G2.9).
    expect(report.refused).toBe(0);
    expect(report.outcomes[0]?.outcome).toBe("imported");
  });
});

describe("a refusal is the core's decision about one record, and stops nothing — G4.2", () => {
  it("imports the rest and names the refused record with the core's own words", async () => {
    const reason = "precondition blocked: PII risk=0.90";
    const stub = coreStub([acknowledged("new-1"), refused(reason), acknowledged("new-3")]);

    const report = await importOf(
      ownDocument([
        sourceRecord({ action: "capture:a" }),
        sourceRecord({ action: "capture:b" }),
        sourceRecord({ action: "capture:c" }),
      ]),
      stub
    );

    expect(stub.sent).toHaveLength(3);
    expect(report.imported).toBe(2);
    expect(report.refused).toBe(1);
    expect(report.outcomes[1]?.outcome).toBe("refused");
    // The runtime's own words reach the report inside `detail`, which is where the transport put
    // them: the report does not hold them in a field of its own, because that field name belongs to
    // the *queue's* verdict about a waiting capture (G2.1).
    expect(report.outcomes[1]?.detail).toContain(reason);
    // Two remap mappings, not three: a record the core refused has no id to resolve to.
    const stored = (await chrome.storage.local.get(REMAP_STORAGE_KEY))[REMAP_STORAGE_KEY] as {
      batches: readonly { mappings: readonly unknown[] }[];
    };
    expect(stored.batches[0]?.mappings).toHaveLength(2);
  });

  it("stamps the destination's actor and reports that the document was exported for another", async () => {
    const stub = coreStub();

    const report = await importOf(ownDocument([sourceRecord()]), stub);

    expect(stub.sent[0]?.actor).toBe(ACTOR);
    const note = report.notes.find((entry) => entry.kind === "ACTOR_REPLACED");
    expect(note?.detail).toContain(SOURCE_ACTOR);
    expect(note?.detail).toContain(ACTOR);
  });

  it("reports a recorded import even when the remap write could not be made", async () => {
    const stub = coreStub([acknowledged("new-1")]);
    // The storage failure is simulated at the boundary the importer actually uses.
    const original = chrome.storage.local.set;
    chrome.storage.local.set = async () => {
      throw new Error("QUOTA_BYTES exceeded");
    };

    const report = await importOf(ownDocument([sourceRecord()]), stub);
    chrome.storage.local.set = original;

    // The record is in the core, so the outcome is `imported` — with the lost transition named,
    // rather than the whole import being reported as failed or the failure being swallowed.
    expect(report.imported).toBe(1);
    expect(report.outcomes[0]?.outcome).toBe("imported");
    expect(report.outcomes[0]?.detail).toContain("QUOTA_BYTES");
  });
});
