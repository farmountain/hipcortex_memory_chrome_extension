/**
 * The import surface (task 2.5, G4.2, G4.3).
 *
 * Task 2.5 asked for "a user-facing way to migrate a core export", and the decision recorded in
 * `design.md` is that the surface sends **text** and the worker decides: it reads the file, hands the
 * characters on, and renders the report it gets back. The spec is written against the shipped
 * `public/options.html` for that reason — a panel that re-typed its own markup would pass while the
 * packaged extension was broken, which is the failure `scripts/copy-assets.js` exists to prevent.
 *
 * Two properties are asserted rather than the layout:
 *
 * 1. **the surface is not the decider.** An unreadable file, an unknown version and a record the
 *    runtime refused all end as *a report from the worker*, and the panel's job is to say which of
 *    them happened. A refusal that rendered its own green border would be the same defect as a
 *    `{success: true}` on the capture path (G2.9);
 * 2. **nothing the user did not ask to see is printed.** The report carries ids, counts and the
 *    runtime's own words — never captured text (G2.10), which is asserted directly by searching the
 *    rendered panel for the text the document held.
 *
 * What this cannot prove is what the *runtime* does with the records; the surface's contract ends at
 * the message boundary, and the parts a mock cannot reach are recorded as live evidence in
 * `openspec/changes/substrate-migration/tasks.md`.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, isHidden, settle, textOf } from "../helpers/surface.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type {
  ImportRecordOutcome,
  ImportReport,
  MessageResponse,
  RemapLookup,
} from "../../src/types/index.js";

const ACTOR = "browser-user";
const IMPORTED_AT = "2025-03-01T00:00:00.000Z";

/** The document's text, so the spec can assert it travelled and that none of it came back. */
const DOCUMENT_TEXT = '{"schema_version":1,"exported_at":"2025-03-01T00:00:00.000Z","records":[],"total":0}';
const CAPTURED_TEXT = "the kubernetes rollout stalled while the readiness probe was flapping";

function baseReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return { actor: ACTOR, imported: 0, refused: 0, failures: [], notes: [], outcomes: [], ...overrides };
}

function imported(index: number, recordId: string, previousId?: string): ImportRecordOutcome {
  return { index, outcome: "imported", recordId, previousId };
}

/** `bootSurface` for the options page: the controller reads settings on load, then nothing else. */
function boot(replies: Record<string, (message: Record<string, unknown>) => unknown>) {
  return bootSurface("options", { GET_SETTINGS: () => ({ success: true, data: DEFAULT_SETTINGS }), ...replies });
}

/**
 * Put a file on the picker.
 *
 * jsdom will not let a spec set `files` from markup, and the controller only ever calls `.text()` on
 * the chosen entry, so a real `File` is unnecessary — the part of the shape the surface uses is what
 * is supplied. The fake holds the document's text so the assertion can be about what crossed the
 * boundary.
 */
function chooseFile(text: string): void {
  const input = document.getElementById("import-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [{ text: async () => text }], configurable: true });
}

async function click(id: string): Promise<void> {
  document.getElementById(id)?.dispatchEvent(new Event("click", { bubbles: true }));
  await settle();
}

function sentOf(mock: { runtime: { sendMessage: { mock: { calls: unknown[][] } } } }, type: string) {
  return mock.runtime.sendMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message["type"] === type);
}

/** Mount the page, choose a file, import, and hand back the panel's text and class. */
async function importFile(
  text: string,
  report: MessageResponse<ImportReport> | undefined
): Promise<{ panel: string; mock: Awaited<ReturnType<typeof boot>>; message: Record<string, unknown> | undefined }> {
  const mock = await boot({ IMPORT_DOCUMENT: () => report });
  chooseFile(text);
  await click("btn-import");
  return {
    panel: textOf("import-report"),
    mock,
    message: sentOf(mock, "IMPORT_DOCUMENT")[0],
  };
}

describe("the options page imports a core export — G4.2 (tasks 2.1, 2.5)", () => {
  it("sends the chosen file's text to the worker, and only that", async () => {
    const { mock, message } = await importFile(DOCUMENT_TEXT, {
      success: true,
      data: baseReport({ imported: 1, outcomes: [imported(0, "core-9", "evt-1")] }),
    });

    // The whole document travels as text. The surface did not parse it, and it could not have: the
    // version gate and the field gate are the worker's, so a surface that understood the file would
    // be a second implementation of both.
    expect(message).toEqual({ type: "IMPORT_DOCUMENT", text: DOCUMENT_TEXT });
    expect(sentOf(mock, "IMPORT_DOCUMENT")).toHaveLength(1);
  });

  it("reports a complete import as done, naming the count and each new id", async () => {
    const { panel } = await importFile(DOCUMENT_TEXT, {
      success: true,
      data: baseReport({
        imported: 2,
        outcomes: [imported(0, "core-9", "evt-1"), imported(1, "core-10")],
      }),
    });

    expect(panel).toContain("Imported 2 records");
    expect(panel).toContain("imported 2 · refused 0 · failed 0 of 2 records in this file · actor browser-user");
    expect(panel).toContain("#0 imported as core-9 (was evt-1)");
    // A record that carried no id of its own has none to report, and the line says so by omission
    // rather than by printing "was undefined".
    expect(panel).toContain("#1 imported as core-10");
    expect(panel).not.toContain("undefined");
  });

  it("prints no captured text, at all", async () => {
    const document = JSON.stringify({ schema_version: 1, records: [{ target: CAPTURED_TEXT }], total: 1 });

    const { panel } = await importFile(document, {
      success: true,
      data: baseReport({ imported: 1, outcomes: [imported(0, "core-9", "evt-1")] }),
    });

    expect(panel).toContain("core-9");
    expect(panel).not.toContain(CAPTURED_TEXT);
    expect(panel).not.toContain("kubernetes");
  });

  it("reports a refused document as nothing written, quoting the reader's reason", async () => {
    const { panel } = await importFile(DOCUMENT_TEXT, {
      success: false,
      error: "import refused (UNSUPPORTED_VERSION): the document declares schema_version 99",
      data: baseReport({
        failures: [
          {
            kind: "UNSUPPORTED_VERSION",
            index: null,
            detail: "the document declares schema_version 99; this build understands 1",
          },
        ],
      }),
    });

    expect(panel).toContain("Import refused — nothing was written");
    expect(panel).toContain("refused UNSUPPORTED_VERSION at the document");
    expect(panel).toContain("schema_version 99; this build understands 1");
    expect(panel).toContain("imported 0 · refused 0 · failed 0 of 0 records");
  });

  it("reports a run the runtime partly refused as incomplete, with both counts", async () => {
    const { panel } = await importFile(DOCUMENT_TEXT, {
      success: false,
      error: "import incomplete: 1 imported, 1 not",
      data: baseReport({
        imported: 1,
        refused: 1,
        outcomes: [
          imported(0, "core-9", "evt-1"),
          {
            index: 1,
            outcome: "refused",
            reason: "NOT_ACKNOWLEDGED",
            detail: "the runtime refused the record - precondition blocked: PII risk=0.90",
          },
        ],
      }),
    });

    expect(panel).toContain("Import incomplete — 1 of 2 records written");
    expect(panel).toContain("imported 1 · refused 1 · failed 0 of 2 records");
    // The runtime's own words, because a count with no reason is a user who cannot decide what to
    // change about the record that was refused. They arrive inside the outcome's `detail`, which is
    // where the transport put them — the report keeps no second copy under the queue's name (G2.1).
    expect(panel).toContain(
      "#1 not imported (refused): NOT_ACKNOWLEDGED — the runtime refused the record - " +
        "precondition blocked: PII risk=0.90"
    );
  });

  it("renders a refusal with the failing class rather than the success one", async () => {
    const mock = await boot({
      IMPORT_DOCUMENT: () => ({
        success: false,
        error: "import refused",
        data: baseReport({
          failures: [{ kind: "MALFORMED_DOCUMENT", index: null, detail: "the file is not JSON" }],
        }),
      }),
    });

    chooseFile("not json at all");
    expect(isHidden("import-report")).toBe(true);

    await click("btn-import");

    expect(isHidden("import-report")).toBe(false);
    expect(document.getElementById("import-report")?.className).toContain("err");
    expect(document.getElementById("import-report")?.className).not.toContain("ok");
    expect(mock.runtime.sendMessage.mock.calls.length).toBeGreaterThan(0);
  });

  it("carries the reader's notes and the overlap advisory to the surface", async () => {
    const { panel } = await importFile(DOCUMENT_TEXT, {
      success: true,
      data: baseReport({
        imported: 1,
        notes: [
          { kind: "CORE_FIELD_DROPPED", detail: 'dropped "integrity" from record 0: the core issues it' },
          { kind: "VERSION_DEFAULTED", detail: "the document declared no schema_version; read as 1" },
        ],
        outcomes: [
          {
            ...imported(0, "core-9", "evt-1"),
            duplicated: true,
            detail: "the core reports this overlaps record core-4",
          },
        ],
      }),
    });

    expect(panel).toContain("note CORE_FIELD_DROPPED");
    expect(panel).toContain("note VERSION_DEFAULTED");
    // An advisory is not a refusal, and a run that duplicated everything it was given is still a run
    // that imported everything (design decision 4).
    expect(panel).toContain("the core reports this overlaps record core-4");
    expect(panel).toContain("Imported 1 record");
  });

  it("says so when the worker answers without a report", async () => {
    const { panel } = await importFile(DOCUMENT_TEXT, { success: false, error: "the runtime is unreachable" });

    expect(panel).toContain("No report came back");
    expect(panel).toContain("the runtime is unreachable");
  });

  it("imports nothing when no file has been chosen, and says which control to use", async () => {
    const mock = await boot({ IMPORT_DOCUMENT: () => ({ success: true, data: baseReport() }) });

    await click("btn-import");

    expect(sentOf(mock, "IMPORT_DOCUMENT")).toEqual([]);
    expect(textOf("import-report")).toContain("No file chosen");
  });
});

describe("the options page resolves an id from before an import — G4.2 (tasks 2.4, 2.5)", () => {
  async function resolve(
    field: string,
    reply: MessageResponse<RemapLookup> | undefined
  ): Promise<{ panel: string; className: string; mock: Awaited<ReturnType<typeof boot>> }> {
    const mock = await boot({ RESOLVE_PREVIOUS_ID: () => reply });
    (document.getElementById("remap-id") as HTMLInputElement).value = field;
    await click("btn-remap");
    const panel = document.getElementById("remap-result");
    return { panel: textOf("remap-result"), className: panel?.className ?? "", mock };
  }

  it("asks the worker for the id it was given, and names what it became", async () => {
    const { panel, mock } = await resolve("evt-migrate-1", {
      success: true,
      data: {
        previousId: "evt-migrate-1",
        found: true,
        recordId: "core-9",
        action: "captured",
        importedAt: IMPORTED_AT,
        imports: 2,
      },
    });

    expect(sentOf(mock, "RESOLVE_PREVIOUS_ID")).toEqual([
      { type: "RESOLVE_PREVIOUS_ID", previousId: "evt-migrate-1" },
    ]);
    expect(panel).toContain("Remapped to core-9");
    expect(panel).toContain("as \"captured\"");
    expect(panel).toContain(IMPORTED_AT);
    expect(panel).toContain("newest of 2 imports");
  });

  it("answers a miss with the import count rather than treating it as a failure", async () => {
    const { panel, className } = await resolve("nobody-imported-this", {
      success: true,
      data: { previousId: "nobody-imported-this", found: false, imports: 3 },
    });

    expect(panel).toContain("Not remapped: nobody-imported-this");
    expect(panel).toContain("3 imports recorded");
    // A miss is an answer. The panel is styled as one rather than as an error, because the remap
    // holds only what this browser migrated and an absent id is the expected answer for anything else.
    expect(className).toContain("err");
  });

  it("resolves nothing when the field is empty, and sends nothing", async () => {
    const { panel, mock } = await resolve("  ", {
      success: true,
      data: { previousId: "", found: false, imports: 0 },
    });

    expect(sentOf(mock, "RESOLVE_PREVIOUS_ID")).toEqual([]);
    expect(panel).toContain("Nothing to resolve");
  });
});
