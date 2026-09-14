/**
 * Router specs (task 8.11) — G6.5.
 *
 * G6.5 asks for two things about the only message router in the extension:
 *
 * - an unknown message type returns `success: false` **with the type named**, so a surface that sent
 *   a stale or misspelled message can say which one;
 * - async handlers keep the channel open, meaning the listener returns `true` *before* the reply
 *   arrives. A router that answered `undefined` after an `await` would look correct in a unit test
 *   that awaited the callback and fail in Chrome, where the channel is already closed.
 *
 * The ordering assertion is the one that actually pins "keeps the channel open": the callback must
 * be observed *after* the listener returned, and the returned value must still be `true`.
 */

import { describe, expect, it } from "vitest";

import { loadWorker } from "../helpers/worker.js";
import { QUEUE_STORAGE_KEY } from "../../src/capture/queue/queue.js";
import type { CaptureStatus, ExtensionSettings } from "../../src/types/index.js";

describe("an unknown message type is refused by name — G6.5 (task 8.11)", () => {
  it("names the type it did not understand and leaves the channel open", async () => {
    const { send } = await loadWorker();

    const { response, returned } = await send({ type: "NOT_A_REAL_TYPE" });

    expect(response.success).toBe(false);
    expect(String(response.error)).toContain("Unknown message type");
    expect(String(response.error)).toContain("NOT_A_REAL_TYPE");
    expect(returned).toBe(true);
  });

  it("still names the message when it carries no type at all", async () => {
    const { send } = await loadWorker();

    const { response } = await send({});

    expect(response.success).toBe(false);
    expect(String(response.error)).toContain("Unknown message type");
    expect(String(response.error)).toContain("undefined");
  });

  it("routes every type the surfaces actually send", async () => {
    const { send } = await loadWorker({ local: { [QUEUE_STORAGE_KEY]: { entries: [], paused: false } } });

    const settings = await send({ type: "GET_SETTINGS" });
    const saved = await send({ type: "SAVE_SETTINGS", settings: { defaultActor: "alice" } });
    const status = await send({ type: "CAPTURE_STATUS" });

    expect(settings.response.success).toBe(true);
    expect((settings.response.data as ExtensionSettings).defaultActor).toBe("browser-user");
    expect(saved.response.success).toBe(true);
    expect((saved.response.data as ExtensionSettings).defaultActor).toBe("alice");
    expect(status.response.success).toBe(true);
    expect((status.response.data as CaptureStatus).retention.queued).toBe(0);
  });
});

describe("async handlers keep the channel open — G6.5 (task 8.11)", () => {
  it("returns true before answering, and answers afterwards", async () => {
    const harness = await loadWorker({ local: { [QUEUE_STORAGE_KEY]: { entries: [], paused: false } } });
    const order: string[] = [];

    const returned = harness.router({ type: "CAPTURE_STATUS" }, {}, () => {
      order.push("answered");
    });
    order.push("returned");

    expect(returned).toBe(true);
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    expect(order).toEqual(["returned", "answered"]);
  });

  it("keeps the channel open for a message it will refuse", async () => {
    const harness = await loadWorker();

    const returned = harness.router({ type: "STALE" }, {}, () => undefined);

    expect(returned).toBe(true);
  });
});

describe("a handler that throws answers rather than hanging", () => {
  it("turns the thrown message into an error reply", async () => {
    const harness = await loadWorker();
    // The reply is still delivered: a rejected storage read must not leave the surface waiting on a
    // channel that never answers.
    harness.mock.storage.sync.get.mockRejectedValueOnce(new Error("storage unavailable"));

    const { response, returned } = await harness.send({ type: "GET_SETTINGS" });

    expect(returned).toBe(true);
    expect(response.success).toBe(false);
    expect(response.error).toBe("storage unavailable");
  });

  it("turns a non-Error rejection into an error reply too", async () => {
    const harness = await loadWorker();
    harness.mock.storage.sync.get.mockRejectedValueOnce("plain string failure");

    const { response } = await harness.send({ type: "GET_SETTINGS" });

    expect(response.success).toBe(false);
    expect(response.error).toBe("plain string failure");
  });
});
