/**
 * Remote egress specs (task 8.4) — G7.2.
 *
 * G7.2: "a non-loopback `apiUrl` cannot persist without a confirmation that **names the host**;
 * declining leaves the previous value and makes no request."
 *
 * Four things have to be true for that sentence to hold, and each gets an assertion rather than a
 * reading of the code:
 *
 * 1. the worker refuses a remote base URL that arrives without a confirmation, so no surface can
 *    persist one by skipping the dialog;
 * 2. the confirmation must name *that* host — confirming a different host must not authorise a save;
 * 3. declining makes no request at all and leaves the field showing the value still in effect;
 * 4. a loopback base URL still saves with no dialog, because a rule that fires on every save is a
 *    rule users learn to click through.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootSurface, submitForm } from "../helpers/surface.js";
import { loadWorker } from "../helpers/worker.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";

const LOCAL = "http://127.0.0.1:3030";
const REMOTE = "https://memory.example.com:8443/v1";
const REMOTE_HOST = "memory.example.com";
const OTHER_HOST = "telemetry.example.net";

interface SentMessage {
  type?: string;
  settings?: Record<string, unknown>;
  confirmRemoteHost?: string;
}

function sentMessages(mock: ChromeMock): SentMessage[] {
  return mock.runtime.sendMessage.mock.calls.map((call) => call[0] as SentMessage);
}

function savedBodies(mock: ChromeMock): SentMessage[] {
  return sentMessages(mock).filter((message) => message.type === "SAVE_SETTINGS");
}

/** Answer the two messages the options page sends, echoing back what it asked to save. */
function optionsReplies(apiUrl: string) {
  return {
    GET_SETTINGS: () => ({ success: true, data: { ...DEFAULT_SETTINGS, apiUrl } }),
    SAVE_SETTINGS: (message: Record<string, unknown>) => {
      const requested = (message["settings"] ?? {}) as Partial<typeof DEFAULT_SETTINGS>;
      return { success: true, data: { ...DEFAULT_SETTINGS, apiUrl, ...requested } };
    },
  };
}

/** Replace `window.confirm` and keep the spy, so the dialog can be asserted *and* its text read. */
function stubConfirm(answer: boolean) {
  const spy = vi.fn((_question?: string) => answer);
  (window as unknown as { confirm: unknown }).confirm = spy;
  return spy;
}

function typeApiUrl(value: string): void {
  (document.getElementById("apiUrl") as HTMLInputElement).value = value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the worker refuses a remote base URL without a named confirmation — G7.2 (task 8.4)", () => {
  it("refuses the save, names the host in the refusal, and writes nothing", async () => {
    const seed = { apiUrl: LOCAL };
    const { mock, send } = await loadWorker({ sync: seed });

    const { response } = await send({ type: "SAVE_SETTINGS", settings: { apiUrl: REMOTE } });

    expect(response.success).toBe(false);
    expect(String(response.error)).toContain("requires a confirmation naming the host");
    expect(String(response.error)).toContain(`'${REMOTE_HOST}'`);
    expect(String(response.error)).toContain("nothing was changed");
    // Not just "the URL is unchanged": a refusal must not have written any other key either.
    expect(mock.storage.sync.data).toEqual(seed);
  });

  it("refuses a confirmation that names a different host", async () => {
    const seed = { apiUrl: LOCAL };
    const { mock, send } = await loadWorker({ sync: seed });

    const { response } = await send({
      type: "SAVE_SETTINGS",
      settings: { apiUrl: REMOTE },
      confirmRemoteHost: OTHER_HOST,
    });

    expect(response.success).toBe(false);
    expect(String(response.error)).toContain(`'${REMOTE_HOST}'`);
    expect(mock.storage.sync.data).toEqual(seed);
  });

  it("accepts and persists it once the confirmation names that exact host", async () => {
    const { mock, send } = await loadWorker({ sync: { apiUrl: LOCAL } });

    const { response } = await send({
      type: "SAVE_SETTINGS",
      settings: { apiUrl: REMOTE },
      confirmRemoteHost: REMOTE_HOST,
    });

    expect(response.success).toBe(true);
    expect(mock.storage.sync.data["apiUrl"]).toBe(REMOTE);
  });

  it("saves a loopback base URL with no confirmation at all", async () => {
    const { mock, send } = await loadWorker();

    const { response } = await send({ type: "SAVE_SETTINGS", settings: { apiUrl: "http://127.0.0.1:4040" } });

    expect(response.success).toBe(true);
    expect(mock.storage.sync.data["apiUrl"]).toBe("http://127.0.0.1:4040");
  });
});

describe("declining the confirmation changes nothing — G7.2 (task 8.4)", () => {
  it("asks a question that names the host and the value it would keep", async () => {
    const confirm = stubConfirm(false);
    await bootSurface("options", optionsReplies(LOCAL));
    typeApiUrl(REMOTE);

    submitForm("settings-form");

    expect(confirm).toHaveBeenCalledTimes(1);
    const question = String(confirm.mock.calls[0]?.[0]);
    expect(question).toContain(REMOTE_HOST);
    expect(question).toContain(LOCAL);
  });

  it("makes no request at all and restores the value that is still in effect", async () => {
    stubConfirm(false);
    const mock = await bootSurface("options", optionsReplies(LOCAL));
    typeApiUrl(REMOTE);
    const before = sentMessages(mock).length;

    submitForm("settings-form");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(savedBodies(mock)).toEqual([]);
    expect(sentMessages(mock)).toHaveLength(before);
    expect((document.getElementById("apiUrl") as HTMLInputElement).value).toBe(LOCAL);
    expect(document.getElementById("status")?.textContent ?? "").toContain(REMOTE_HOST);
    expect(document.getElementById("status")?.textContent ?? "").toContain("Not saved");
  });

  it("sends the confirmed host back with the save when the question is accepted", async () => {
    stubConfirm(true);
    const mock = await bootSurface("options", optionsReplies(LOCAL));
    typeApiUrl(REMOTE);

    submitForm("settings-form");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saves = savedBodies(mock);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.settings?.["apiUrl"]).toBe(REMOTE);
    expect(saves[0]?.confirmRemoteHost).toBe(REMOTE_HOST);
    expect(document.getElementById("status")?.textContent ?? "").toContain(REMOTE_HOST);
  });

  it("does not ask at all for a loopback base URL", async () => {
    const confirm = stubConfirm(false);
    const mock = await bootSurface("options", optionsReplies(LOCAL));
    typeApiUrl("http://127.0.0.1:4040");

    submitForm("settings-form");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirm).not.toHaveBeenCalled();
    const saves = savedBodies(mock);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.confirmRemoteHost).toBeUndefined();
  });
});
