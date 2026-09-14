/**
 * The import, through the router — G4.2 (tasks 2.1, 2.4, 2.5) and G4.3 (task 3.2).
 *
 * The migration specs next door drive `importDocument` directly, which proves the module. This one
 * proves the *path a user's click takes*: a message in, a reply out, and the record on the wire with
 * nothing between the two but the router. That distinction matters here more than usual, because the
 * decision this change makes is about the route (one record at a time through `POST /memory/add`) and
 * a module-level test could pass while the router used something else.
 *
 * `developer` is named rather than left on `auto` for the same reason the injection specs name it:
 * `auto` tries Native Messaging first and the chrome mock's port never answers, so leaving it would
 * make these measurements of a response timeout rather than of the import.
 */

import { describe, expect, it } from "vitest";

import { REMAP_STORAGE_KEY } from "../../src/migration/remap.js";
import { CORE_OWNED_EXPORT_FIELDS, EXPORT_SCHEMA_VERSION } from "../../src/schema/index.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { ImportReport, RemapLookup } from "../../src/types/index.js";
import { EVENT_ID, IMPORT_ACTOR, IMPORTED_AT, coreShapeDocument, makeExportRecord, ownExportDocument } from "../helpers/export.js";
import { installFetchMock, jsonBody } from "../helpers/http.js";
import { loadWorker } from "../helpers/worker.js";

const ADD_URL = "http://127.0.0.1:3030/memory/add";

function worker() {
  return loadWorker({
    sync: { ...DEFAULT_SETTINGS, transportMode: "developer", defaultActor: IMPORT_ACTOR },
  });
}

/** A core that answers acknowledgements in order, minting a fresh id per record as the runtime does. */
function coreAnswers(ids: readonly string[] = ["core-1", "core-2", "core-3"]) {
  let call = 0;
  return installFetchMock(() => {
    const recordId = ids[call] ?? `core-${call + 1}`;
    call += 1;
    return jsonBody({ success: true, record_id: recordId });
  });
}

function reportOf(response: { data?: unknown }): ImportReport {
  return response.data as ImportReport;
}

describe("an import reaches the runtime one record at a time — G4.2 (task 2.1)", () => {
  it("posts every record of the document to the add endpoint, and answers with the report", async () => {
    const harness = await worker();
    const recorder = coreAnswers(["core-1", "core-2"]);
    const text = ownExportDocument([
      makeExportRecord({ action: "capture:a" }),
      makeExportRecord({ action: "capture:b", priority: "pinned" }),
    ]);

    const call = await harness.send({ type: "IMPORT_DOCUMENT", text });

    expect(call.response.success).toBe(true);
    const report = reportOf(call.response);
    expect(report.imported).toBe(2);
    expect(report.refused).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.outcomes.map((outcome) => outcome.recordId)).toEqual(["core-1", "core-2"]);

    // One route, N requests: the decision recorded in `design.md` is that `/memory/bulk` is not used,
    // so the count is the assertion and not an implementation detail.
    expect(recorder.urls()).toEqual([ADD_URL, ADD_URL]);
  });

  it("posts the migrated fields and none of the core-owned ones", async () => {
    const harness = await worker();
    const recorder = coreAnswers(["core-1"]);
    const record = makeExportRecord({ priority: "pinned" });

    // The `id` is added here rather than by the builder: `id` is core-owned and this repository's own
    // producer cannot emit it, so a document that carries one is the runtime's shape and not ours.
    await harness.send({ type: "IMPORT_DOCUMENT", text: coreShapeDocument([{ ...record, id: "old-id-1" }]) });

    const body = recorder.requests[0]?.json as Record<string, unknown>;
    expect(body["action"]).toBe(record.action);
    expect(body["target"]).toBe(record.target);
    expect(body["record_type"]).toBe(record.record_type);
    expect(body["tags"]).toEqual(record.tags);
    expect(body["priority"]).toBe("pinned");
    expect(body["metadata"]).toEqual(record.metadata);
    expect(body["actor"]).toBe(IMPORT_ACTOR);
    for (const field of CORE_OWNED_EXPORT_FIELDS) {
      expect(body, `the body must not carry ${field}`).not.toHaveProperty(field);
    }
  });

  it("records the remap in storage, so it outlives the worker that made it", async () => {
    const harness = await worker();
    coreAnswers(["core-1"]);

    await harness.send({ type: "IMPORT_DOCUMENT", text: ownExportDocument([makeExportRecord()]) });

    // Storage, not a module variable: an MV3 worker is terminated whenever Chrome feels like it, so
    // "the remap resolves afterwards" has to mean it was durably written, and this is the written
    // value rather than a read-back through the same code path that wrote it.
    const stored = harness.mock.storage.local.data[REMAP_STORAGE_KEY] as {
      batches: readonly { mappings: readonly { previousId: string; recordId: string }[] }[];
    };
    expect(stored.batches).toHaveLength(1);
    expect(stored.batches[0]?.mappings).toEqual([
      expect.objectContaining({ previousId: EVENT_ID, recordId: "core-1", kind: "event-id" }),
    ]);
  });

  it("touches nothing but the remap", async () => {
    const harness = await worker();
    coreAnswers(["core-1"]);

    await harness.send({ type: "IMPORT_DOCUMENT", text: ownExportDocument([makeExportRecord()]) });

    // An import is not a capture. If it wrote a queue entry or an index record it would be a second
    // ingest path with its own failure rules, which is the thing task 2.1 was amended to prevent.
    expect(Object.keys(harness.mock.storage.local.data).sort()).toEqual([REMAP_STORAGE_KEY]);
    expect(Object.keys(harness.mock.storage.session.data)).toEqual([]);
  });
});

describe("the remap is resolvable through the router — G4.2 (tasks 2.4, 2.5)", () => {
  it("answers with the id the core issued for the id the user has", async () => {
    const harness = await worker();
    coreAnswers(["core-1"]);
    await harness.send({ type: "IMPORT_DOCUMENT", text: ownExportDocument([makeExportRecord()]) });

    const call = await harness.send({ type: "RESOLVE_PREVIOUS_ID", previousId: EVENT_ID });

    expect(call.response.success).toBe(true);
    const lookup = call.response.data as RemapLookup;
    expect(lookup.found).toBe(true);
    expect(lookup.recordId).toBe("core-1");
    expect(lookup.imports).toBe(1);
  });

  it("answers a miss as a miss, not as an error", async () => {
    const harness = await worker();

    const call = await harness.send({ type: "RESOLVE_PREVIOUS_ID", previousId: "never-imported" });

    // A lookup that failed would make a user think their remap was lost; the truthful answer is that
    // this id is not in it, and `imports: 0` says the store is empty rather than the id being wrong.
    expect(call.response.success).toBe(true);
    const lookup = call.response.data as RemapLookup;
    expect(lookup.found).toBe(false);
    expect(lookup.imports).toBe(0);
  });
});

describe("a refused document never reaches the runtime — G4.3 (task 3.2)", () => {
  it("answers as a failure, names the version, and issues no request at all", async () => {
    const harness = await worker();
    const recorder = installFetchMock(() => {
      throw new Error("a refused document must not reach the network");
    });
    const text = JSON.stringify({
      schema_version: EXPORT_SCHEMA_VERSION + 98,
      exported_at: IMPORTED_AT,
      actor: IMPORT_ACTOR,
      total: 1,
      records: [makeExportRecord()],
    });

    const call = await harness.send({ type: "IMPORT_DOCUMENT", text });

    expect(call.response.success).toBe(false);
    expect(String(call.response.error)).toContain(String(EXPORT_SCHEMA_VERSION + 98));
    const report = reportOf(call.response);
    expect(report.imported).toBe(0);
    expect(report.failures.map((failure) => failure.kind)).toEqual(["UNSUPPORTED_VERSION"]);
    // The proof that "all-or-nothing" is an ordering and not a rollback: there was certainly no
    // record written and no delete needed, because nothing was ever sent.
    expect(recorder.urls()).toEqual([]);
    expect(harness.mock.storage.local.data[REMAP_STORAGE_KEY]).toBeUndefined();
  });

  it("reports a run in which the runtime refused one record as a failure, with the count", async () => {
    const harness = await worker();
    let call = 0;
    installFetchMock(() => {
      call += 1;
      // The runtime's refusal body carries its own words in `error`; the transport keeps them as the
      // `refusalReason` the report shows (PROTOCOL section 6), which reaches the report inside the
      // outcome's `detail`.
      return call === 2
        ? jsonBody({ success: false, error: "precondition blocked: PII risk=0.90" }, 403)
        : jsonBody({ success: true, record_id: `core-${call}` });
    });
    const text = ownExportDocument([
      makeExportRecord({ action: "capture:a" }),
      makeExportRecord({ action: "capture:b" }),
    ]);

    const refusal = await harness.send({ type: "IMPORT_DOCUMENT", text });

    // `success: true` beside "1 of 2 imported" is the shape of reply that lets a surface show a
    // migration as done when it is not, so the run is a failure — and the report is still the data.
    expect(refusal.response.success).toBe(false);
    expect(String(refusal.response.error)).toContain("1 imported");
    const report = reportOf(refusal.response);
    expect(report.imported).toBe(1);
    expect(report.refused).toBe(1);
    expect(report.outcomes[1]?.detail).toContain("PII risk");
  });
});

describe("the reply is the same shape on both routes — G4.2", () => {
  it("passes the reader's notes through, so a defaulted version is visible from the surface", async () => {
    const harness = await worker();
    coreAnswers(["core-1"]);

    const call = await harness.send({
      type: "IMPORT_DOCUMENT",
      text: coreShapeDocument([makeExportRecord()]),
    });

    const report = reportOf(call.response);
    expect(report.notes.map((note) => note.kind)).toContain("VERSION_DEFAULTED");
  });
});
