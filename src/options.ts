import type { ExtensionSettings, MessageResponse, HealthStatus } from "./types/index.js";
import { DEFAULT_SETTINGS } from "./types/index.js";

function send<T>(msg: unknown): Promise<MessageResponse<T>> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r as MessageResponse<T>)));
}

function showStatus(text: string, ok: boolean) {
  const el = document.getElementById("status")!;
  el.textContent = text;
  el.className = `status show ${ok ? "ok" : "err"}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const res = await send<ExtensionSettings>({ type: "GET_SETTINGS" });
  const s = res.data || DEFAULT_SETTINGS;

  (document.getElementById("apiUrl") as HTMLInputElement).value = s.apiUrl;
  (document.getElementById("apiKey") as HTMLInputElement).value = s.apiKey;
  (document.getElementById("defaultActor") as HTMLInputElement).value = s.defaultActor;
  (document.getElementById("autoCapture") as HTMLInputElement).checked = s.autoCapture;
  (document.getElementById("injectIntoAiChats") as HTMLInputElement).checked = s.injectIntoAiChats;
  (document.getElementById("headroomMode") as HTMLInputElement).checked = s.headroomMode;

  document.getElementById("settings-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings: Partial<ExtensionSettings> = {
      apiUrl: (document.getElementById("apiUrl") as HTMLInputElement).value.trim(),
      apiKey: (document.getElementById("apiKey") as HTMLInputElement).value.trim(),
      defaultActor: (document.getElementById("defaultActor") as HTMLInputElement).value.trim() || "browser-user",
      autoCapture: (document.getElementById("autoCapture") as HTMLInputElement).checked,
      injectIntoAiChats: (document.getElementById("injectIntoAiChats") as HTMLInputElement).checked,
      headroomMode: (document.getElementById("headroomMode") as HTMLInputElement).checked,
    };
    const r = await send({ type: "SAVE_SETTINGS", settings });
    if (r.success) showStatus("Settings saved", true);
    else showStatus(r.error || "Save failed", false);
  });

  document.getElementById("btn-test")!.addEventListener("click", async () => {
    // Temporarily save current form values for the test
    const settings: Partial<ExtensionSettings> = {
      apiUrl: (document.getElementById("apiUrl") as HTMLInputElement).value.trim(),
      apiKey: (document.getElementById("apiKey") as HTMLInputElement).value.trim(),
    };
    await send({ type: "SAVE_SETTINGS", settings });
    const r = await send<HealthStatus>({ type: "HEALTH_CHECK" });
    if (r.success && r.data?.healthy) {
      showStatus(`Connected — ${r.data.status}${r.data.service ? " (" + r.data.service + ")" : ""}`, true);
    } else {
      showStatus(r.error || "Unreachable. Is hipcortex start running?", false);
    }
  });
});
