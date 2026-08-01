/**
 * Popup UI controller
 * Layer 6: Frontend specialist surface
 */

import type { MessageResponse, ExtensionSettings, HealthStatus, SearchResult, MemoryRecord } from "./types/index.js";

function send<T>(msg: unknown): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res as MessageResponse<T>));
  });
}

function toast(text: string, kind: "success" | "error" = "success") {
  const el = document.getElementById("toast")!;
  el.textContent = text;
  el.className = `toast ${kind}`;
  setTimeout(() => el.classList.add("hidden"), 2200);
}

async function refreshHealth() {
  const badge = document.getElementById("status-badge")!;
  badge.textContent = "…";
  badge.className = "badge unknown";
  const res = await send<HealthStatus>({ type: "HEALTH_CHECK" });
  if (res.success && res.data?.healthy) {
    badge.textContent = "online";
    badge.className = "badge healthy";
  } else {
    badge.textContent = "offline";
    badge.className = "badge unhealthy";
  }
}

function renderResults(data: SearchResult) {
  const box = document.getElementById("search-results")!;
  box.innerHTML = "";
  if (!data.results?.length) {
    box.innerHTML = `<div class="result-item" style="color:var(--muted)">No results</div>`;
    return;
  }
  for (const r of data.results) {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <div><span class="actor">${escapeHtml(r.actor || "?")}</span>
      <span class="action"> ${escapeHtml(r.action || "")}</span></div>
      <div class="target">${escapeHtml(r.target || "")}</div>
    `;
    box.appendChild(item);
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshHealth();

  document.getElementById("btn-add")!.addEventListener("click", async () => {
    const text = (document.getElementById("memory-text") as HTMLTextAreaElement).value.trim();
    const action = (document.getElementById("memory-action") as HTMLInputElement).value.trim() || "noted";
    if (!text) {
      toast("Enter some text", "error");
      return;
    }
    const btn = document.getElementById("btn-add") as HTMLButtonElement;
    btn.disabled = true;
    const settingsRes = await send<ExtensionSettings>({ type: "GET_SETTINGS" });
    const actor = settingsRes.data?.defaultActor || "browser-user";
    const res = await send<MemoryRecord>({
      type: "ADD_MEMORY",
      record: { actor, action, target: text, metadata: { source: "popup" } },
    });
    btn.disabled = false;
    if (res.success) {
      toast("Memory added");
      (document.getElementById("memory-text") as HTMLTextAreaElement).value = "";
    } else {
      toast(res.error || "Failed", "error");
    }
  });

  document.getElementById("btn-search")!.addEventListener("click", async () => {
    const q = (document.getElementById("search-query") as HTMLInputElement).value.trim();
    if (!q) return;
    const btn = document.getElementById("btn-search") as HTMLButtonElement;
    btn.disabled = true;
    const res = await send<SearchResult>({ type: "SEARCH_MEMORY", query: q, limit: 8 });
    btn.disabled = false;
    if (res.success && res.data) {
      renderResults(res.data);
    } else {
      toast(res.error || "Search failed", "error");
    }
  });

  (document.getElementById("search-query") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-search")!.click();
  });

  document.getElementById("btn-sidepanel")!.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  });

  document.getElementById("btn-options")!.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
