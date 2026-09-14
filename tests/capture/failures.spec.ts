/**
 * Failure-log specs (task 6.8).
 *
 * The claim under test is a *safety* property, not a feature: the log can be bounded, and bounded
 * logs lose things, so a bounded log is only acceptable if what it holds cannot be content. These
 * specs therefore try to make the log hold content and assert that it does not — on the way in (a
 * caller passing extra fields) and on the way out (a hand-written wide record already in storage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import {
  FAILURE_LOG_KEY,
  FAILURE_LOG_LIMIT,
  readFailures,
  recordFailure,
} from "../../src/capture/failures.js";
import type { FailureRecord } from "../../src/capture/failures.js";

const AT = "2025-01-15T00:00:00.000Z";

function record(code: string, path: "validation" | "transport" = "validation"): FailureRecord {
  return { timestamp: AT, path, code, providerId: "chatgpt" };
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stored(): unknown {
  return mock.storage.local.data[FAILURE_LOG_KEY];
}

describe("record shape", () => {
  it("stores exactly the four diagnostic fields", async () => {
    await recordFailure(record("DOM_SHAPE_UNRECOGNIZED"));

    const records = await readFailures();
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(["code", "path", "providerId", "timestamp"]);
    expect(records[0]).toEqual({
      timestamp: AT,
      path: "validation",
      code: "DOM_SHAPE_UNRECOGNIZED",
      providerId: "chatgpt",
    });
  });

  it("drops fields a caller tries to smuggle in", async () => {
    const smuggled = {
      ...record("MESSAGE_COUNT_MISMATCH"),
      target: "the user asked about their medical results",
      event: { conversation: { messages: [{ text: "a private transcript line" }] } },
    } as unknown as FailureRecord;

    await recordFailure(smuggled);

    const serialised = JSON.stringify(stored());
    const records = await readFailures();

    expect(Object.keys(records[0] ?? {})).toHaveLength(4);
    expect(serialised).not.toContain("medical");
    expect(serialised).not.toContain("private transcript line");
    expect(serialised).not.toContain("target");
    expect(serialised).not.toContain("conversation");
  });

  it("distinguishes a validation refusal from a transport refusal", async () => {
    await recordFailure(record("EMPTY_CONVERSATION", "validation"));
    await recordFailure(record("NOT_ACKNOWLEDGED", "transport"));

    const paths = (await readFailures()).map((entry) => entry.path);
    expect(paths).toEqual(["transport", "validation"]);
  });

  it("never writes a diagnostic to chrome.storage.sync", async () => {
    await recordFailure(record("UNREACHABLE", "transport"));

    expect(mock.storage.sync.set).not.toHaveBeenCalled();
    expect(Object.keys(mock.storage.sync.data)).not.toContain(FAILURE_LOG_KEY);
  });
});

describe("bound", () => {
  it("keeps the newest entries up to the limit and drops nothing else", async () => {
    const overflow = 12;
    for (let index = 0; index < FAILURE_LOG_LIMIT + overflow; index += 1) {
      await recordFailure(record(`code-${index}`));
    }

    const records = await readFailures();
    expect(records).toHaveLength(FAILURE_LOG_LIMIT);
    expect(records[0]?.code).toBe(`code-${FAILURE_LOG_LIMIT + overflow - 1}`);
    expect(records[FAILURE_LOG_LIMIT - 1]?.code).toBe(`code-${overflow}`);
    expect(records.map((entry) => entry.code)).not.toContain(`code-${overflow - 1}`);
  });

  it("stays at the limit when it is already full", async () => {
    for (let index = 0; index < FAILURE_LOG_LIMIT * 2; index += 1) {
      await recordFailure(record(`code-${index}`));
    }

    expect(await readFailures()).toHaveLength(FAILURE_LOG_LIMIT);
  });

  it("reports bounded-ness on every persisted record, not just the first", async () => {
    for (let index = 0; index < FAILURE_LOG_LIMIT + 5; index += 1) {
      await recordFailure(record(`code-${index}`));
    }

    for (const entry of await readFailures()) {
      expect(Object.keys(entry).sort()).toEqual(["code", "path", "providerId", "timestamp"]);
    }
  });
});

describe("read", () => {
  it("returns nothing when the log is absent or not an array", async () => {
    expect(await readFailures()).toEqual([]);

    mock.storage.local.data[FAILURE_LOG_KEY] = { path: "validation" };
    expect(await readFailures()).toEqual([]);
  });

  it("drops a wide record that is already in storage instead of reading content back", async () => {
    mock.storage.local.data[FAILURE_LOG_KEY] = [
      { timestamp: AT, path: "validation", code: "REQUIRED", providerId: "chatgpt", target: "secret" },
      { timestamp: AT, path: "not-a-path", code: "REQUIRED", providerId: "chatgpt" },
      { timestamp: AT, path: "transport", code: "TIMEOUT" },
      "not an object",
      { timestamp: AT, path: "transport", code: "TIMEOUT", providerId: "claude" },
    ];

    const records = await readFailures();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      timestamp: AT,
      path: "transport",
      code: "TIMEOUT",
      providerId: "claude",
    });
    expect(JSON.stringify(records)).not.toContain("secret");
  });
});
