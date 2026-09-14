/**
 * Capture-status specs (tasks 8.6 and 8.7) — G2.2, G2.3.
 *
 * G2.3: "reaching the spill limit produces a user-visible message naming the unacknowledged count
 * and the paused state". G2.2: "at the spill limit no existing entry is removed and **no loss
 * counter exists at all**".
 *
 * The first describe drives the worker, because the numbers the popup shows have to come from the
 * queue the core acknowledges against — a UI spec with canned numbers would prove nothing about the
 * spill limit. The second drives the shipped popup markup, because a payload nobody renders is not a
 * user-visible message.
 *
 * The two absence assertions are deliberately of different kinds: nothing in the payload may be
 * *named* like a loss counter, and nothing in the markup may be *labelled* like one. The phrase
 * "none of them has been discarded" is asserted positively — G2.3 asks for the paused message, and
 * that sentence *is* the no-loss message.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootSurface, settle, textOf, isHidden } from "../helpers/surface.js";
import { loadWorker } from "../helpers/worker.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { QUEUE_SPILL_LIMIT, QUEUE_STORAGE_KEY, pauseMessage, refusalMessage } from "../../src/capture/queue/queue.js";
import type { EntryOutcome, RetentionState } from "../../src/capture/queue/queue.js";
import type { CaptureStatus } from "../../src/types/index.js";

const T0 = "2025-01-15T00:00:00.000Z";

/** A queue entry the real `readQueue` accepts, shaped exactly as the queue writes one. */
function queueEntry(id: string, outcome: EntryOutcome = "pending", refusalReason: string | null = null) {
  return {
    event: makeCaptureEvent({ eventId: id }),
    attempts: 0,
    enqueuedAt: T0,
    nextAttemptAt: T0,
    outcome,
    refusalReason,
  };
}

function queueOf(count: number): readonly unknown[] {
  return Array.from({ length: count }, (_unused, index) => queueEntry(`evt-${index}`));
}

/** A complete retention state, so every spec states only the field it is about. */
function retentionOf(overrides: Partial<RetentionState> = {}): RetentionState {
  return { queued: 0, retrying: 0, refused: 0, paused: false, refusals: [], message: null, ...overrides };
}

async function captureStatus(options: { readonly entries?: readonly unknown[]; readonly autoCapture?: boolean } = {}) {
  const { send } = await loadWorker({
    sync: options.autoCapture === undefined ? {} : { autoCapture: options.autoCapture },
    local: { [QUEUE_STORAGE_KEY]: { entries: options.entries ?? [], paused: false } },
  });
  const { response } = await send({ type: "CAPTURE_STATUS" });
  expect(response.success).toBe(true);
  return response.data as CaptureStatus;
}

describe("the worker reports the queue and the pause — G2.3 (task 8.7)", () => {
  it("reports the queue length, and the retention state is one value", async () => {
    const status = await captureStatus({ entries: queueOf(3) });

    expect(status.retention).toMatchObject({
      queued: 3,
      retrying: 0,
      refused: 0,
      paused: false,
      message: null,
    });
    expect(Object.keys(status)).toEqual(["autoCapture", "retention", "needsAttention", "failures"]);
  });

  it("reports passive capture off by default and on when the setting asks for it", async () => {
    expect((await captureStatus()).autoCapture).toBe(false);
    expect((await captureStatus({ autoCapture: true })).autoCapture).toBe(true);
  });

  it("pauses at the spill limit and names the unacknowledged count", async () => {
    const status = await captureStatus({ entries: queueOf(QUEUE_SPILL_LIMIT) });

    expect(status.retention.paused).toBe(true);
    expect(status.retention.queued).toBe(QUEUE_SPILL_LIMIT);
    expect(status.retention.message).toBe(pauseMessage(QUEUE_SPILL_LIMIT));
    expect(String(status.retention.message)).toContain(String(QUEUE_SPILL_LIMIT));
    expect(String(status.retention.message)).toMatch(/paused/i);
    expect(String(status.retention.message)).toContain("none of them has been discarded");
  });

  it("carries no loss counter of any kind — G2.2", async () => {
    const status = await captureStatus({ entries: queueOf(QUEUE_SPILL_LIMIT) });

    expect(Object.keys(status)).not.toContain("lost");
    expect(JSON.stringify(status)).not.toMatch(/"lost"|"dropped"|"evicted"|discardedCount/i);
  });

  it("reports a refusal as its own value, carrying the runtime's reason — G2.2", async () => {
    const reason = 'precondition blocked: PII risk=0.90 patterns=["PII:1789355714"]';
    const status = await captureStatus({
      entries: [queueEntry("evt-refused", "refused", reason), queueEntry("evt-retrying", "transient")],
    });

    expect(status.retention.queued).toBe(2);
    expect(status.retention.refused).toBe(1);
    expect(status.retention.retrying).toBe(1);
    expect(status.retention.refusals).toMatchObject([
      { eventId: "evt-refused", provider: "chatgpt", attempts: 0, reason },
    ]);
    expect(String(status.retention.message)).toContain("refused");
  });

  it("does not report a transient failure as a refusal — G2.2", async () => {
    const status = await captureStatus({ entries: [queueEntry("evt-retrying", "transient")] });

    expect(status.retention.refused).toBe(0);
    expect(status.retention.refusals).toEqual([]);
    expect(String(status.retention.message ?? "")).not.toMatch(/refused/i);
  });
});

describe("the popup shows the capture status — G2.3 (task 8.6)", () => {
  function popupWith(status: Partial<CaptureStatus> | "unavailable") {
    const full: CaptureStatus = {
      autoCapture: true,
      retention: retentionOf({ queued: 3 }),
      needsAttention: [],
      failures: 0,
      ...(status === "unavailable" ? {} : status),
    };
    return bootSurface("popup", {
      GET_SETTINGS: () => ({ success: true, data: { apiUrl: "http://127.0.0.1:3030" } }),
      HEALTH_CHECK: () => ({
        success: true,
        data: {
          health: { healthy: true, status: "ok" },
          resolution: { mode: "auto", active: "http", fellBack: false, detail: "http://127.0.0.1:3030/health" },
        },
      }),
      CAPTURE_STATUS:
        status === "unavailable"
          ? () => ({ success: false, error: "the worker did not answer" })
          : () => ({ success: true, data: full }),
    });
  }

  it("shows passive capture, the queue length and the unacknowledged count", async () => {
    await popupWith({ autoCapture: true, retention: retentionOf({ queued: 2 }) });

    expect(textOf("capture-passive")).toBe("on");
    expect(textOf("capture-queued")).toBe("2");
    expect(textOf("capture-unacknowledged")).toBe("2");
  });

  it("distinguishes a non-zero unacknowledged count visually", async () => {
    await popupWith({ retention: retentionOf({ queued: 1 }) });

    expect(document.getElementById("capture-unacknowledged")?.classList.contains("attention")).toBe(true);
    expect(document.getElementById("capture-status")?.classList.contains("attention")).toBe(true);
  });

  it("leaves a drained queue unmarked", async () => {
    await popupWith({ autoCapture: false, retention: retentionOf() });

    expect(textOf("capture-passive")).toBe("off");
    expect(textOf("capture-unacknowledged")).toBe("0");
    expect(document.getElementById("capture-unacknowledged")?.classList.contains("attention")).toBe(false);
    expect(document.getElementById("capture-status")?.classList.contains("attention")).toBe(false);
  });

  it("shows the paused message only while paused, and takes its wording from the worker", async () => {
    await popupWith({
      retention: retentionOf({
        queued: QUEUE_SPILL_LIMIT,
        paused: true,
        message: pauseMessage(QUEUE_SPILL_LIMIT),
      }),
    });

    expect(isHidden("capture-paused")).toBe(false);
    expect(textOf("capture-paused")).toBe(pauseMessage(QUEUE_SPILL_LIMIT));
    expect(textOf("capture-paused")).toContain("paused");
  });

  it("shows the runtime's own refusal reason, not a paraphrase — G2.2", async () => {
    const reason = 'precondition blocked: PII risk=0.90 patterns=["PII:1789355714"]';
    await popupWith({
      retention: retentionOf({
        queued: 1,
        refused: 1,
        message: refusalMessage(1, 1),
        refusals: [{ eventId: "evt-1", provider: "chatgpt", capturedAt: T0, attempts: 4, reason }],
      }),
    });

    expect(isHidden("capture-paused")).toBe(false);
    expect(textOf("capture-paused")).toContain(reason);
    expect(textOf("capture-paused")).toContain("chatgpt");
  });

  it("hides the paused message when the queue is not paused and nothing was refused", async () => {
    await popupWith({ retention: retentionOf() });

    expect(isHidden("capture-paused")).toBe(true);
    expect(textOf("capture-paused")).toBe("");
  });

  it("labels no row as a loss — G2.2", async () => {
    await popupWith({ retention: retentionOf({ queued: 1, message: pauseMessage(1) }) });

    const labels = Array.from(document.querySelectorAll("#capture-status .capture-label")).map((node) =>
      (node.textContent ?? "").trim()
    );
    expect(labels).toEqual(["Passive capture", "Queued", "Unacknowledged"]);
    expect(labels.join(" ").toLowerCase()).not.toMatch(/lost|dropped|evicted/);
  });

  it("degrades to unknown rather than showing zero when the worker cannot answer", async () => {
    await popupWith("unavailable");

    expect(textOf("capture-passive")).toBe("unknown");
    expect(textOf("capture-queued")).toBe("?");
    expect(textOf("capture-unacknowledged")).toBe("?");
  });
});

/**
 * The export control — G4.1 (task 3.1).
 *
 * jsdom implements neither `URL.createObjectURL` nor a real download, so both the blob handle and the
 * anchor click are captured here. That is the point of the spec rather than a workaround: it asserts
 * the *bytes the user is given*, which is the only artefact of this feature a person can check, and a
 * spec that only asserted "the button was clicked" would pass while writing an empty file.
 */
describe("the popup offers the user an exit from an undeliverable backlog — G4.1 (task 3.1)", () => {
  const T1 = "2025-02-01T12:00:00.000Z";

  /** Blobs handed to `createObjectURL`, and the download names of the anchors that were clicked. */
  const written: Blob[] = [];
  const downloads: string[] = [];

  let restoreCreate: (() => void) | undefined;
  let restoreClick: (() => void) | undefined;

  function installDownloadCapture(): void {
    const holder = URL as unknown as {
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
    const hadCreate = "createObjectURL" in holder;
    const hadRevoke = "revokeObjectURL" in holder;
    holder.createObjectURL = (blob: Blob) => {
      written.push(blob);
      return "blob:spec";
    };
    holder.revokeObjectURL = () => undefined;
    restoreCreate = () => {
      if (!hadCreate) delete holder.createObjectURL;
      if (!hadRevoke) delete holder.revokeObjectURL;
      else holder.revokeObjectURL = () => undefined;
    };

    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    restoreClick = () => {
      HTMLAnchorElement.prototype.click = original;
    };
  }

  async function popupWith(
    retention: RetentionState,
    queueReply: unknown = {
      success: true,
      data: { schema_version: 1, exported_at: T1, actor: "browser-user", records: [], total: 0 },
    }
  ) {
    return bootSurface("popup", {
      GET_SETTINGS: () => ({ success: true, data: { apiUrl: "http://127.0.0.1:3030" } }),
      HEALTH_CHECK: () => ({
        success: true,
        data: {
          health: { healthy: true, status: "ok" },
          resolution: { mode: "auto", active: "http", fellBack: false, detail: "http://127.0.0.1:3030/health" },
        },
      }),
      CAPTURE_STATUS: () => ({ success: true, data: { autoCapture: true, retention, needsAttention: [], failures: 0 } }),
      EXPORT_QUEUE: () => queueReply,
    });
  }

  function clickExport(): void {
    document.getElementById("btn-export-queue")?.dispatchEvent(new Event("click", { bubbles: true }));
  }

  beforeEach(() => {
    written.length = 0;
    downloads.length = 0;
    installDownloadCapture();
  });

  afterEach(() => {
    restoreClick?.();
    restoreCreate?.();
  });

  it("offers the export exactly while there is a backlog, and refuses it when there is none", async () => {
    await popupWith(retentionOf({ queued: 1 }));
    expect(document.getElementById("btn-export-queue") as HTMLButtonElement).toHaveProperty("disabled", false);

    await popupWith(retentionOf());
    expect(document.getElementById("btn-export-queue") as HTMLButtonElement).toHaveProperty("disabled", true);
  });

  it("writes the document the worker produced, named for when it was taken", async () => {
    const document = {
      schema_version: 1,
      exported_at: T1,
      actor: "browser-user",
      records: [{ actor: "browser-user", action: "capture:chatgpt", target: "user:\nhello" }],
      total: 1,
    };
    await popupWith(retentionOf({ queued: 1 }), { success: true, data: document });

    clickExport();
    await settle();

    // The file is the reply, parsed back out of the blob — not a re-render of it.
    expect(written).toHaveLength(1);
    expect(JSON.parse(await written[0]!.text())).toEqual(document);
    expect(downloads).toEqual(["cortexbridge-undelivered-2025-02-01T12-00-00-000Z.json"]);
  });

  it("says the captures were exported and are still queued, not that they were removed", async () => {
    await popupWith(retentionOf({ queued: 2 }), {
      success: true,
      data: { schema_version: 1, exported_at: T1, actor: "browser-user", records: [], total: 2 },
    });

    clickExport();
    await settle();

    expect(isHidden("capture-export-note")).toBe(false);
    expect(textOf("capture-export-note")).toContain("Exported 2 undelivered captures");
    expect(textOf("capture-export-note")).toMatch(/still queued and will still be delivered/);
    expect(textOf("capture-export-note").toLowerCase()).not.toMatch(/removed|cleared|deleted|lost/);
  });

  it("reports a failed export without touching the counts, because a failed read is not a queue state", async () => {
    await popupWith(retentionOf({ queued: 3 }), { success: false, error: "the worker did not answer" });

    clickExport();
    await settle();

    expect(written).toEqual([]);
    expect(downloads).toEqual([]);
    expect(textOf("capture-export-note")).toContain("the worker did not answer");
    expect(textOf("capture-export-note")).toContain("Nothing has been removed");
    // The backlog is still reported as it was: a failure to read it is not evidence about it.
    expect(textOf("capture-queued")).toBe("3");
  });

  it("keeps the control usable after a failure, so the user can try again", async () => {
    await popupWith(retentionOf({ queued: 1 }), { success: false, error: "transient" });

    clickExport();
    await settle();

    expect(document.getElementById("btn-export-queue") as HTMLButtonElement).toHaveProperty("disabled", false);
  });
});
