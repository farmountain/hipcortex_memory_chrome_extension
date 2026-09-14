/**
 * Drift-counter specs (task 6.15, G8.6).
 *
 * The product claim is narrow and worth stating exactly: after N consecutive typed failures for one
 * provider, *the user is told which provider and which part of the page stopped matching*. A status
 * that says "capture is broken" would satisfy a looser reading and be useless, so the assertions are
 * on the named slot and rung, and on the boundaries either side of the threshold.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import {
  DRIFT_STORAGE_KEY,
  DRIFT_THRESHOLD,
  describeDrift,
  displayNameFor,
  driftStatuses,
  readDrift,
  recordDriftFailure,
  recordDriftSuccess,
  toStatus,
} from "../../src/capture/drift.js";
import type { DriftSignal } from "../../src/capture/drift.js";

const NOW = new Date("2025-01-15T00:00:00.000Z");

function signal(patch: Partial<DriftSignal> = {}): DriftSignal {
  return { providerId: "chatgpt", code: "DOM_SHAPE_UNRECOGNIZED", slot: "turnContainer", rung: -1, ...patch };
}

async function fail(times: number, patch: Partial<DriftSignal> = {}): Promise<void> {
  for (let index = 0; index < times; index += 1) await recordDriftFailure(signal(patch), NOW);
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

describe("threshold", () => {
  it("reports nothing before the threshold is reached", async () => {
    await fail(DRIFT_THRESHOLD - 1);

    const statuses = await driftStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({
      providerId: "chatgpt",
      needsAttention: false,
      consecutiveFailures: DRIFT_THRESHOLD - 1,
      message: null,
    });
  });

  it("reports the provider and the failing slot at the threshold", async () => {
    await fail(DRIFT_THRESHOLD, { slot: "messageText", rung: 2 });

    const statuses = await driftStatuses();
    const status = statuses[0];
    expect(status?.needsAttention).toBe(true);
    expect(status?.consecutiveFailures).toBe(DRIFT_THRESHOLD);
    expect(status?.message).toBe(
      `Capture from ChatGPT needs updating: the "messageText" slot failed ${DRIFT_THRESHOLD} times ` +
        `in a row (DOM_SHAPE_UNRECOGNIZED) (selector rung 2).`
    );
  });

  it("stays reported past the threshold and keeps counting", async () => {
    await fail(DRIFT_THRESHOLD + 2);

    const status = (await driftStatuses())[0];
    expect(status?.needsAttention).toBe(true);
    expect(status?.consecutiveFailures).toBe(DRIFT_THRESHOLD + 2);
    expect(status?.message).toContain(`failed ${DRIFT_THRESHOLD + 2} times in a row`);
  });
});

describe("what the message names", () => {
  it("says no selector rung matched when rung is -1", async () => {
    await fail(DRIFT_THRESHOLD, { slot: "messageText", rung: -1 });

    const message = (await driftStatuses())[0]?.message ?? "";
    expect(message).toContain("(no selector rung matched)");
    expect(message).toContain('the "messageText" slot');
  });

  it("falls back to the conversation layout when the failure named no slot", async () => {
    await fail(DRIFT_THRESHOLD, { slot: undefined, rung: undefined });

    const message = (await driftStatuses())[0]?.message ?? "";
    expect(message).toContain("the conversation layout failed");
    expect(message).not.toContain("undefined");
  });

  it("falls back to the provider id when the provider has no adapter", async () => {
    expect(displayNameFor("chatgpt")).toBe("ChatGPT");
    expect(displayNameFor("not-a-provider")).toBe("not-a-provider");

    await fail(DRIFT_THRESHOLD, { providerId: "not-a-provider" });
    expect((await driftStatuses())[0]?.message).toContain("Capture from not-a-provider needs updating");
  });

  it("names the code so a fix has something to search for", async () => {
    await fail(DRIFT_THRESHOLD, { code: "MESSAGE_COUNT_MISMATCH" });
    expect((await driftStatuses())[0]?.message).toContain("(MESSAGE_COUNT_MISMATCH)");
  });

  it("renders a record with only the required fields", () => {
    const text = describeDrift({
      providerId: "chatgpt",
      code: "EMPTY_CONVERSATION",
      consecutiveFailures: 4,
      updatedAt: NOW.toISOString(),
    });
    expect(text).toBe(
      "Capture from ChatGPT needs updating: the conversation layout failed 4 times in a row (EMPTY_CONVERSATION)."
    );
  });
});

describe("a success clears the state", () => {
  it("reports nothing once the provider succeeds again", async () => {
    await fail(DRIFT_THRESHOLD + 1);
    expect((await driftStatuses())[0]?.needsAttention).toBe(true);

    const cleared = await recordDriftSuccess("chatgpt");

    expect(cleared).toEqual({
      providerId: "chatgpt",
      needsAttention: false,
      consecutiveFailures: 0,
      message: null,
    });
    expect(await driftStatuses()).toEqual([]);
    expect(await readDrift()).toEqual([]);
  });

  it("resets the consecutive count after a success", async () => {
    await fail(2);
    await recordDriftSuccess("chatgpt");
    await fail(1);

    const status = (await driftStatuses())[0];
    expect(status?.consecutiveFailures).toBe(1);
    expect(status?.needsAttention).toBe(false);
  });

  it("does not write when the provider had no state", async () => {
    mock.storage.local.set.mockClear();
    await recordDriftSuccess("gemini");
    expect(mock.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("per-provider state", () => {
  it("counts each provider separately", async () => {
    await fail(DRIFT_THRESHOLD, { providerId: "chatgpt" });
    await fail(1, { providerId: "claude" });

    const statuses = await driftStatuses();
    const byProvider = new Map(statuses.map((status) => [status.providerId, status]));

    expect(byProvider.get("chatgpt")?.needsAttention).toBe(true);
    expect(byProvider.get("claude")?.needsAttention).toBe(false);
    expect(byProvider.get("claude")?.consecutiveFailures).toBe(1);
  });

  it("stores one record per provider rather than appending a history", async () => {
    await fail(6);

    const stored = mock.storage.local.data[DRIFT_STORAGE_KEY] as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(["chatgpt"]);
  });

  it("keeps transcripts out of the drift store", async () => {
    const smuggled = {
      ...signal(),
      detail: "a private transcript line",
      event: { conversation: { messages: [{ text: "another private line" }] } },
    } as unknown as DriftSignal;

    await recordDriftFailure(smuggled, NOW);

    const serialised = JSON.stringify(mock.storage.local.data[DRIFT_STORAGE_KEY]);
    expect(serialised).not.toContain("private transcript");
    expect(serialised).not.toContain("conversation");

    const record = (await readDrift())[0];
    expect(Object.keys(record ?? {}).sort()).toEqual([
      "code",
      "consecutiveFailures",
      "providerId",
      "rung",
      "slot",
      "updatedAt",
    ]);
  });

  it("ignores an unreadable record instead of reporting it", async () => {
    mock.storage.local.data[DRIFT_STORAGE_KEY] = {
      chatgpt: { providerId: "chatgpt", code: "X", consecutiveFailures: 0, updatedAt: NOW.toISOString() },
      claude: "not a record",
      gemini: { providerId: "gemini", code: "X", consecutiveFailures: 3, updatedAt: NOW.toISOString() },
    };

    const statuses = await driftStatuses();
    expect(statuses.map((status) => status.providerId)).toEqual(["gemini"]);
  });
});

describe("toStatus", () => {
  it("treats a missing record as a clean provider", () => {
    expect(toStatus(null, "grok")).toEqual({
      providerId: "grok",
      needsAttention: false,
      consecutiveFailures: 0,
      message: null,
    });
  });
});
