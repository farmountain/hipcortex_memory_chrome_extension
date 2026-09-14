/**
 * Queue-export specs (tasks 3.1 and 3.2) — the user's exit from an undeliverable backlog (G4.1).
 *
 * Two claims are being tested, and both are about what the export *does not* do:
 *
 * 1. A queued capture and a stored record are the same record. So the assertion is not "the export
 *    looks plausible" but "the record in the export is byte-for-byte the record the transport would
 *    have posted" — same field set, same provenance in the reserved metadata key, and the
 *    extension's own retry bookkeeping nowhere in it. If the export carried an export-only field, the
 *    user's two files would need a translation step and requirement 4 would be false.
 *
 * 2. Exporting removes nothing. The spec exports a full queue and then drains it against a transport
 *    that finally works, and requires that **every** entry arrives exactly once. A "backup" that
 *    silently cleared the queue would pass any assertion about the file's contents.
 *
 * The document is also round-tripped through `JSON.parse(JSON.stringify(...))` and the contract's own
 * reader, because the thing the user actually has is text on disk, not the object graph this spec
 * built — and a document the reader rejects is a document that cannot be imported.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { drainQueue, enqueueEvent, readQueue } from "../../src/capture/queue/queue.js";
import { exportQueue, queueToExportDocument } from "../../src/capture/queue/export.js";
import {
  EXPORT_RECORD_FIELDS,
  EXPORT_SCHEMA_VERSION,
  RESERVED_PROVENANCE_KEY,
  readExportDocument,
  toEgressRecord,
} from "../../src/schema/index.js";
import type { ExportDocument } from "../../src/schema/index.js";
import type { SendResult } from "../../src/api/transport/index.js";

const T0 = new Date("2025-01-15T00:00:00.000Z");
const T1 = "2025-02-01T12:00:00.000Z";
const ACTOR = "browser-user";

function acknowledged(recordId: string): SendResult {
  return { acknowledged: true, transport: "http", recordId, warning: [] };
}

/** The document as the user has it: text in a file, read back through the contract's own reader. */
function roundTrip(exported: ExportDocument) {
  return readExportDocument(JSON.parse(JSON.stringify(exported)));
}

function eventIdOf(record: { readonly metadata?: Record<string, unknown> }): string | undefined {
  const provenance = record.metadata?.[RESERVED_PROVENANCE_KEY] as { eventId?: string } | undefined;
  return provenance?.eventId;
}

beforeEach(() => {
  installChromeMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a queued capture exports in the core's record shape — G4.1 (task 3.1)", () => {
  it("produces one record per undelivered capture, in delivery order", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: "first" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2", text: "second" }), T0);

    const exported = await exportQueue(ACTOR, T1);

    expect(exported.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(exported.exported_at).toBe(T1);
    expect(exported.actor).toBe(ACTOR);
    expect(exported.total).toBe(2);
    // FIFO, the order the drain would use — so an import reconstructs the same backlog. Read through
    // the reserved key constant, so a rename of the key cannot make this assertion silently vacuous.
    expect(exported.records.map((record) => eventIdOf(record))).toEqual(["evt-1", "evt-2"]);
  });

  it("exports exactly the record the transport would have posted, field for field", async () => {
    const event = makeCaptureEvent({ eventId: "evt-1", provider: "claude", text: "a private line" });
    await enqueueEvent(event, T0);

    const exported = await exportQueue(ACTOR, T1);
    const record = exported.records[0];

    // The comparison is against the producer, not against a hand-written literal: if the egress
    // shape ever changes, this spec fails rather than blessing a stale copy of it.
    expect(record).toEqual(toEgressRecord(event, ACTOR));

    // The fields requirement 4 names by hand, asserted by name so a rename cannot pass. The
    // provenance object keeps the contract's own key names — the export does not rename anything
    // on the way out, which is what "without a translation step" means in practice.
    expect(record?.record_type).toBe("Perception");
    expect(record?.actor).toBe(ACTOR);
    expect(record?.metadata).toMatchObject({
      [RESERVED_PROVENANCE_KEY]: {
        schemaVersion: expect.any(Number),
        eventId: "evt-1",
        provider: "claude",
        adapterVersion: expect.any(String),
        conversationUrl: expect.any(String),
        capturedAt: expect.any(String),
      },
    });
    expect(record?.tags).toContain("capture");
    expect(record?.target).toContain("a private line");
  });

  it("carries no export-only field, so no translation step is needed to import it", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);

    const exported = await exportQueue(ACTOR, T1);

    for (const record of exported.records) {
      const extra = Object.keys(record).filter((key) => !EXPORT_RECORD_FIELDS.includes(key));
      expect(extra).toEqual([]);
    }
  });

  it("leaves the retry bookkeeping behind, because a verdict is not part of the record", async () => {
    const reason = "precondition blocked: PII risk=0.90";
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-refused" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-pending" }), T0);
    // Drain with everything refused, so the queue holds a refused entry and a waiting one.
    await drainQueue({
      send: async () => ({
        acknowledged: false,
        transport: "http",
        reason: "HTTP_ERROR",
        detail: "spec",
        kind: "refused",
        refusalReason: reason,
      }),
      now: () => new Date(T0.getTime() + 1_000),
    });

    const exported = await exportQueue(ACTOR, T1);

    expect(exported.records).toHaveLength(2);
    const text = JSON.stringify(exported);
    expect(text).not.toContain(reason);
    expect(text).not.toContain("refusalReason");
    expect(text).not.toContain("nextAttemptAt");
    expect(text).not.toContain("outcome");
    // The queue itself still holds both verdicts — nothing was cleared by exporting.
    const state = await readQueue();
    expect(state.entries.map((entry) => entry.event.eventId)).toEqual(["evt-refused", "evt-pending"]);
  });

  it("renders an empty backlog as an empty document rather than a failure", async () => {
    const exported = await exportQueue(ACTOR, T1);

    expect(exported.total).toBe(0);
    expect(exported.records).toEqual([]);
    // An empty document is still a valid document: a user who exports an empty queue must not be
    // told the export failed.
    expect(roundTrip(exported).ok).toBe(true);
  });
});

describe("an export survives the trip through a file — G4.1 (task 3.1)", () => {
  it("round-trips through JSON and the contract's own reader with no note and no failure", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: "line one" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2", provider: "gemini", messages: 3 }), T0);

    const exported = await exportQueue(ACTOR, T1);
    const read = roundTrip(exported);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // No note: the producer emits the current version and only fields the contract defines, so the
    // reader has nothing to interpret. A note here would mean the export needed a caveat.
    expect(read.notes).toEqual([]);
    expect(read.document.actor).toBe(ACTOR);
    // Deep equality, never a string compare: `metadata` is a nested object and two emitters may
    // order its keys differently while meaning the same thing.
    expect(read.document.records).toEqual(exported.records);
    expect(read.document.records[1]?.metadata).toEqual(toEgressRecord(
      makeCaptureEvent({ eventId: "evt-2", provider: "gemini", messages: 3 }),
      ACTOR
    ).metadata);
  });

  it("keeps the transcript byte-identical, so an import is not a re-summarisation", async () => {
    const line = "  leading spaces, a\ttab, an emoji 🧠 and a newline\nsecond line  ";
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: line, messages: 2 }), T0);

    const exported = await exportQueue(ACTOR, T1);
    const read = roundTrip(exported);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const target = read.document.records[0]?.target ?? "";
    expect(target).toContain(line);
  });
});

describe("exporting removes nothing — G4.1 (task 3.2)", () => {
  it("accounts for every exported entry exactly once when the backlog is finally delivered", async () => {
    const ids = ["evt-1", "evt-2", "evt-3", "evt-4"];
    for (const id of ids) {
      await enqueueEvent(makeCaptureEvent({ eventId: id }), T0);
    }

    // Export the whole backlog while the runtime is unreachable.
    const exported = await exportQueue(ACTOR, T1);
    expect(exported.total).toBe(ids.length);
    expect((await readQueue()).entries).toHaveLength(ids.length);

    // Now the runtime answers. Every entry must arrive, and exactly once.
    const delivered: string[] = [];
    const outcome = await drainQueue({
      send: async (event) => {
        delivered.push(event.eventId);
        return acknowledged(`rec-${event.eventId}`);
      },
      // Past every backoff: the first attempt on each entry is due.
      now: () => new Date(T0.getTime() + 400_000),
    });

    expect(exported.total).toBe(ids.length);
    expect(outcome.delivered).toBe(ids.length);
    expect(delivered).toEqual(ids);
    expect(new Set(delivered).size).toBe(ids.length);
    expect(outcome.retention.retrying).toBe(0);
    expect(outcome.retention.refused).toBe(0);
    expect((await readQueue()).entries).toEqual([]);
  });

  it("does not write the queue at all, so exporting cannot be what discards a capture", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);
    const before = await readQueue();

    await exportQueue(ACTOR, T1);
    await exportQueue(ACTOR, T1);

    // Two exports of the same backlog are the same backlog, twice. There is no "exported" marker
    // that a second export could consume.
    expect(await readQueue()).toEqual(before);
  });

  it("exports a paused backlog, and pausing is not a reason to withhold it", async () => {
    const state = { entries: [], paused: true } as const;
    const exported = queueToExportDocument({ entries: state.entries, paused: state.paused }, ACTOR, T1);

    expect(exported.total).toBe(0);
    expect(roundTrip(exported).ok).toBe(true);
  });
});
