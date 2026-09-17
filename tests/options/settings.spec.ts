/**
 * Settings specs (task 8.9) — G2.7.
 *
 * G2.7: "conversation content never reaches `chrome.storage.sync`" — so this file asserts the split
 * by *lifetime*, not by name: durable configuration goes to `sync`, and an ephemeral handoff such as
 * `pendingSearch` goes to `session`. The two are asserted together with the same secret, because
 * "the key is absent" is a weaker claim than "the text is nowhere in `sync`".
 *
 * The transport-mode assertions (task 8.1) live here too: the mode is a setting, so "defaults fill
 * missing keys" and "the control round-trips the mode" are the same question asked of the worker and
 * of the page.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, submitForm, textOf } from "../helpers/surface.js";
import { loadWorker } from "../helpers/worker.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { DEFAULT_SETTINGS, TRANSPORT_MODES } from "../../src/types/index.js";
import type { ExtensionSettings } from "../../src/types/index.js";

const SECRET = "the selection text must never reach sync storage";

interface SentMessage {
  type?: string;
  settings?: Record<string, unknown>;
}

function sentMessages(mock: ChromeMock): SentMessage[] {
  return mock.runtime.sendMessage.mock.calls.map((call) => call[0] as SentMessage);
}

describe("settings defaults and merge", () => {
  it("fills every missing key from the defaults, including the transport mode", async () => {
    const { send } = await loadWorker();

    const { response } = await send({ type: "GET_SETTINGS" });

    expect(response.success).toBe(true);
    expect(response.data).toEqual(DEFAULT_SETTINGS);
    expect((response.data as ExtensionSettings).transportMode).toBe("auto");
    expect(TRANSPORT_MODES).toEqual(["auto", "consumer", "developer"]);
  });

  it("merges a partial stored setting over the defaults", async () => {
    const { send } = await loadWorker({ sync: { defaultActor: "alice" } });

    const { response } = await send({ type: "GET_SETTINGS" });

    expect(response.data).toEqual({ ...DEFAULT_SETTINGS, defaultActor: "alice" });
  });

  it("round-trips a save: what the reply reports is what a later read returns", async () => {
    const { mock, send } = await loadWorker();

    const saved = await send({
      type: "SAVE_SETTINGS",
      settings: { apiKey: "k-1", transportMode: "developer" } satisfies Partial<ExtensionSettings>,
    });
    const read = await send({ type: "GET_SETTINGS" });

    expect(saved.response.success).toBe(true);
    expect(saved.response.data).toEqual({ ...DEFAULT_SETTINGS, apiKey: "k-1", transportMode: "developer" });
    expect(read.response.data).toEqual(saved.response.data);
    expect(mock.storage.sync.data["transportMode"]).toBe("developer");
    // Saving one key must not erase the others: the merged read above already proves it, and this
    // pins it to what was persisted rather than to what was reported.
    expect(mock.storage.sync.data["apiUrl"]).toBe(DEFAULT_SETTINGS.apiUrl);
  });
});

describe("ephemeral handoff never enters sync — G2.7", () => {
  it("writes the pending search to session, keeps it out of sync, and opens the side panel", async () => {
    const { mock } = await loadWorker();
    const onClicked = mock.contextMenus.onClicked.addListener.mock.calls[0]?.[0] as (
      info: Record<string, unknown>,
      tab: Record<string, unknown>
    ) => void;
    expect(typeof onClicked).toBe("function");

    onClicked(
      { menuItemId: "hipcortex-search-selection", selectionText: SECRET, pageUrl: "https://example.com/p" },
      { windowId: 7, url: "https://example.com/p", title: "Example" }
    );
    for (let index = 0; index < 60; index += 1) await Promise.resolve();

    expect(mock.storage.session.data["pendingSearch"]).toBe(SECRET);
    expect(Object.keys(mock.storage.sync.data)).not.toContain("pendingSearch");
    expect(JSON.stringify(mock.storage.sync.data)).not.toContain(SECRET);
    expect(mock.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
  });
});

describe("the transport mode control — task 8.1", () => {
  function optionsReplies(settings: Partial<ExtensionSettings>) {
    return {
      GET_SETTINGS: () => ({ success: true, data: { ...DEFAULT_SETTINGS, ...settings } }),
      SAVE_SETTINGS: (message: Record<string, unknown>) => ({
        success: true,
        data: { ...DEFAULT_SETTINGS, ...(message["settings"] ?? {}) },
      }),
    };
  }

  it("offers exactly the three modes the type declares", async () => {
    await bootSurface("options", optionsReplies({}));

    const select = document.getElementById("transportMode") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([...TRANSPORT_MODES]);
  });

  it("shows the saved mode and saves the chosen one", async () => {
    const mock = await bootSurface("options", optionsReplies({ transportMode: "consumer" }));
    const select = document.getElementById("transportMode") as HTMLSelectElement;
    expect(select.value).toBe("consumer");

    select.value = "developer";
    submitForm("settings-form");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saves = sentMessages(mock).filter((message) => message.type === "SAVE_SETTINGS");
    expect(saves).toHaveLength(1);
    expect(saves[0]?.settings?.["transportMode"]).toBe("developer");
  });

  it("shows the defaults when the worker reports nothing", async () => {
    await bootSurface("options", { GET_SETTINGS: () => ({ success: true, data: {} }) });

    expect((document.getElementById("apiUrl") as HTMLInputElement).value).toBe(DEFAULT_SETTINGS.apiUrl);
    expect((document.getElementById("transportMode") as HTMLSelectElement).value).toBe("auto");
    expect((document.getElementById("autoCapture") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("injectIntoAiChats") as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById("headroomMode") as HTMLInputElement).checked).toBe(true);
    expect(textOf("status")).toBe("");
  });
});
