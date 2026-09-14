/**
 * Popup UI controller
 * Layer 6: Frontend specialist surface
 */

import type {
  MessageResponse,
  ExtensionSettings,
  HealthReport,
  CaptureStatus,
  SearchIndexReport,
  SearchIndexStatus,
  SearchResult,
  MemoryRecord,
} from "./types/index.js";
import type { ExportDocument } from "./schema/index.js";
import { DEFAULT_SETTINGS } from "./types/index.js";
import { hostOfUrl, isLoopbackUrl } from "./api/transport/endpoints.js";
import { badgeFor } from "./ui/connection-badge.js";

function send<T>(msg: unknown): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res as MessageResponse<T>));
  });
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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
  // The runtime answers with a report, not a bare status: the badge must read the nested health
  // field, or a healthy runtime would render as offline. Which of the failure states it is comes
  // from the shared mapping, so the popup cannot disagree with the options page about it (G9.1).
  const res = await send<HealthReport>({ type: "HEALTH_CHECK" });
  const state = badgeFor(res.success ? res.data : undefined);
  badge.textContent = state.text;
  badge.className = state.className;
}

/**
 * The persistent egress notice (G7.4).
 *
 * It is shown whenever the saved base URL is not on this machine, and it names the host. The
 * presence of the banner is driven by the same `isLoopbackUrl` predicate the transport uses, so the
 * notice and the actual egress decision cannot drift apart.
 */
async function refreshEgressBanner() {
  const banner = byId<HTMLDivElement>("egress-banner");
  const res = await send<ExtensionSettings>({ type: "GET_SETTINGS" });
  const apiUrl = res.data?.apiUrl ?? DEFAULT_SETTINGS.apiUrl;
  if (isLoopbackUrl(apiUrl)) {
    banner.textContent = "";
    banner.classList.add("hidden");
    return;
  }
  banner.textContent =
    `Captures leave this machine: every conversation captured from your AI chats is sent to ` +
    `${hostOfUrl(apiUrl)}, not to HipCortex on this computer.`;
  banner.classList.remove("hidden");
}

/**
 * The capture-status area (G2.3).
 *
 * It reports the queue length, the unacknowledged count, the refused count and the paused flag. There
 * is deliberately no loss counter: an unacknowledged capture is never discarded, so there is no
 * number to report and a zero-valued "lost" field would quietly contradict G2.2. A non-zero
 * unacknowledged count and a paused queue each get their own visible treatment, and the message comes
 * from the worker (it names the count) rather than being re-derived here.
 *
 * A reply without a `retention` object is treated exactly like a reply that never arrived, so an
 * older or partial worker cannot make this screen throw or show a number it did not receive.
 */
async function refreshCaptureStatus() {
  const res = await send<CaptureStatus>({ type: "CAPTURE_STATUS" });
  const status = res.data;
  if (!res.success || !status?.retention) {
    byId<HTMLSpanElement>("capture-passive").textContent = "unknown";
    byId<HTMLSpanElement>("capture-queued").textContent = "?";
    byId<HTMLSpanElement>("capture-unacknowledged").textContent = "?";
    byId<HTMLParagraphElement>("capture-paused").classList.add("hidden");
    return;
  }

  byId<HTMLSpanElement>("capture-passive").textContent = status.autoCapture ? "on" : "off";

  const queued = status.retention.queued;
  byId<HTMLSpanElement>("capture-queued").textContent = String(queued);

  const unacknowledged = byId<HTMLSpanElement>("capture-unacknowledged");
  unacknowledged.textContent = String(queued);
  const section = byId<HTMLElement>("capture-status");
  const attention = queued > 0;
  unacknowledged.classList.toggle("attention", attention);
  section.classList.toggle("attention", attention);

  // A refusal is shown in the runtime's own words, one line per refused entry, beside the summary the
  // worker composed. Both come from the same `retention` value, so the reason cannot describe a
  // different set of entries than the count does. The runtime's text is set with `textContent` — it
  // is a string from outside this program and is never parsed as markup.
  const paused = byId<HTMLParagraphElement>("capture-paused");
  paused.textContent = "";
  if (status.retention.message) {
    paused.append(document.createTextNode(status.retention.message));
  }
  for (const refusal of status.retention.refusals) {
    const line = document.createElement("span");
    line.className = "capture-refusal";
    line.textContent = `${refusal.provider} - captured ${refusal.capturedAt} - ${refusal.reason}`;
    paused.append(line);
  }
  if (paused.childNodes.length > 0) {
    paused.classList.remove("hidden");
  } else {
    paused.classList.add("hidden");
  }

  // The exit is offered exactly while there is something to exit from. A disabled button next to a
  // full backlog would be the same failure as a hidden one, so the enablement is derived from the
  // same count the rows above show (G4.1).
  byId<HTMLButtonElement>("btn-export-queue").disabled = queued === 0;
}

/**
 * The offline-search area (G3.9).
 *
 * Three things come from one read of the index: how many captured conversations are searchable with
 * the runtime stopped, which providers are in it, and whether there is anything for the clear action
 * to clear. The provider filter is rebuilt from the index's own contents, so it can never offer a
 * provider with nothing behind it and this surface never carries a list of provider names.
 *
 * The action offered here is one of two distinct clears, and the copy says which one: this removes
 * the offline copy only, and the undelivered captures are not touched (G3.9).
 */
async function refreshIndexStatus() {
  const note = byId<HTMLParagraphElement>("index-note");
  const select = byId<HTMLSelectElement>("search-provider");
  const clear = byId<HTMLButtonElement>("btn-clear-index");
  const chosen = select.value;

  const res = await send<SearchIndexStatus>({ type: "INDEX_STATUS" });
  const status = res.data;
  if (!res.success || !status) {
    note.textContent = res.error || "The local search index could not be read.";
    clear.disabled = true;
    return;
  }

  select.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = "Any provider";
  select.appendChild(any);
  for (const provider of status.providers) {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = provider;
    select.appendChild(option);
  }
  select.value = status.providers.includes(chosen) ? chosen : "";

  clear.disabled = status.indexed === 0;
  note.textContent =
    status.indexed === 0
      ? "Nothing is searchable offline yet. A capture becomes searchable here once the runtime acknowledges it."
      : `${status.indexed} captured conversation${status.indexed === 1 ? "" : "s"} searchable offline` +
        (status.providers.length > 0 ? ` (${status.providers.join(", ")})` : "") +
        ".";
}

/**
 * The file name an export lands under.
 *
 * The `exported_at` stamp with its punctuation removed, so two exports of the same backlog a second
 * apart are two files rather than one overwriting the other — and so the name says when the export
 * was taken, which is the only thing that distinguishes them.
 */
export function exportFileName(exportedAt: string): string {
  return `cortexbridge-undelivered-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

/**
 * Write a document to the user's downloads.
 *
 * Indented JSON, because the point of an export is that a person can open it and read it. A blob URL
 * is used rather than a data URL because the transcripts in a full queue are far past what a data URL
 * can carry, and the URL is released after the click has been dispatched so the popup does not hold
 * the backlog in memory for as long as it is open.
 */
export function saveDocument(exported: ExportDocument, name: string): void {
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderResults(data: SearchResult) {
  const box = document.getElementById("search-results")!;
  box.innerHTML = "";

  const path = document.createElement("div");
  path.className = "result-path";
  path.textContent = searchPathLabel(data);
  box.appendChild(path);

  // When the runtime answers that it could not honour the request as asked (a provider filter it has
  // no field for), that sentence is shown above the results — a scoped-looking list that is not
  // scoped is worse than no list (G3.6).
  if (data.limitation) {
    const notice = document.createElement("div");
    notice.className = "result-limitation";
    notice.textContent = data.limitation;
    box.appendChild(notice);
  }

  if (!data.results?.length) {
    // "No matches" rather than an error, and it says which path was empty: an empty local index and
    // a runtime with nothing in it are the same empty list and different situations (G3.9).
    const empty = document.createElement("div");
    empty.className = "result-item";
    empty.style.color = "var(--muted)";
    empty.textContent =
      data.source === "local" && (data.indexed ?? 0) === 0
        ? "No matches. Nothing captured here has been acknowledged by the runtime yet."
        : "No matches";
    box.appendChild(empty);
    return;
  }

  for (const r of data.results) {
    const item = document.createElement("div");
    item.className = "result-item";
    // A local hit is explained by the text that matched and by the provider and capture time it came
    // from — never by an inferred relationship, which is the one thing this path cannot produce.
    const where = r.provider ? escapeHtml(r.provider) : escapeHtml(r.actor || "?");
    const when = r.timestamp ? ` · captured ${escapeHtml(r.timestamp)}` : escapeHtml(r.action || "");
    item.innerHTML = `
      <div><span class="actor">${where}</span>
      <span class="action"> ${when}</span></div>
      <div class="target">${escapeHtml(r.target || "")}</div>
    `;
    box.appendChild(item);
  }
}

/**
 * Which path answered, in words a user can act on.
 *
 * A result set is only interpretable with this line: "captured conversations held here" and "the
 * runtime's semantic search" answer the same query with different kinds of evidence, and the offline
 * one is the one that keeps working when the other cannot (G3.9).
 */
function searchPathLabel(data: SearchResult): string {
  if (data.source === "core") return "From the runtime (semantic search)";
  const held = data.indexed ?? 0;
  return `From captured conversations held here (${held} searchable offline)`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshHealth();
  await refreshEgressBanner();
  await refreshCaptureStatus();
  await refreshIndexStatus();

  document.getElementById("btn-add")!.addEventListener("click", async () => {
    const field = document.getElementById("memory-text") as HTMLTextAreaElement;
    const text = field.value.trim();
    const action = (document.getElementById("memory-action") as HTMLInputElement).value.trim() || "noted";
    const failure = byId<HTMLParagraphElement>("add-error");
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
      field.value = "";
      failure.textContent = "";
      failure.classList.add("hidden");
    } else {
      // The draft is deliberately left in the box and the reason is left on screen: a toast that
      // vanishes after two seconds, next to an emptied field, would lose the user's text and the
      // only explanation for why (task 8.8).
      const reason = res.error || "the runtime did not acknowledge it";
      failure.textContent = `Not stored: ${reason}. Your text is still here — you can retry.`;
      failure.classList.remove("hidden");
      toast(reason, "error");
    }
    await refreshCaptureStatus();
  });

  document.getElementById("btn-search")!.addEventListener("click", async () => {
    const q = (document.getElementById("search-query") as HTMLInputElement).value.trim();
    if (!q) return;
    const btn = document.getElementById("btn-search") as HTMLButtonElement;
    const scope = byId<HTMLSelectElement>("search-scope").value === "core" ? "core" : "local";
    const provider = byId<HTMLSelectElement>("search-provider").value;
    btn.disabled = true;
    const res = await send<SearchResult>({
      type: "SEARCH_MEMORY",
      query: q,
      limit: 8,
      scope,
      ...(provider ? { provider } : {}),
    });
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

  document.getElementById("btn-clear-index")!.addEventListener("click", async () => {
    const note = byId<HTMLParagraphElement>("index-note");
    byId<HTMLButtonElement>("btn-clear-index").disabled = true;

    const res = await send<SearchIndexReport>({ type: "CLEAR_SEARCH_INDEX" });
    if (!res.success || !res.data) {
      note.textContent = res.error || "The local search index could not be cleared.";
      await refreshIndexStatus();
      return;
    }

    const { cleared, unacknowledged } = res.data;
    await refreshIndexStatus();
    // The counts are stated rather than implied: one clear action succeeded, and the other store is
    // where it was. Saying both is the difference between two stores and one ambiguous button.
    note.textContent =
      `Cleared the local search index (${cleared} record${cleared === 1 ? "" : "s"}). The stored ` +
      `records are untouched, and ${unacknowledged} undelivered capture` +
      `${unacknowledged === 1 ? "" : "s"} ${unacknowledged === 1 ? "is" : "are"} still queued.`;
  });

  document.getElementById("btn-export-queue")!.addEventListener("click", async () => {
    const btn = byId<HTMLButtonElement>("btn-export-queue");
    const note = byId<HTMLParagraphElement>("capture-export-note");
    btn.disabled = true;
    note.textContent = "";
    note.classList.add("hidden");

    const res = await send<ExportDocument>({ type: "EXPORT_QUEUE" });
    if (!res.success || !res.data) {
      // A failed export says nothing about the queue, so the counts above are left exactly as they
      // were. Nothing here is a reason to remove an entry, and nothing here is a number the user
      // should read as one (G2.2).
      note.textContent = `${res.error || "The undelivered captures could not be read."} Nothing has been removed.`;
      note.classList.remove("hidden");
      await refreshCaptureStatus();
      return;
    }

    const name = exportFileName(res.data.exported_at);
    saveDocument(res.data, name);
    note.textContent =
      `Exported ${res.data.total} undelivered capture${res.data.total === 1 ? "" : "s"} to ${name}. ` +
      "They are still queued and will still be delivered.";
    note.classList.remove("hidden");
    await refreshCaptureStatus();
  });
});
