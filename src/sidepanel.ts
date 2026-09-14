import type {
  MessageResponse,
  HealthReport,
  SearchResult,
  MemoryRecord,
  ExtensionSettings,
  PlaceContextReport,
} from "./types/index.js";
import { DEFAULT_SETTINGS } from "./types/index.js";
import { hostOfUrl, isLoopbackUrl } from "./api/transport/endpoints.js";
import { badgeFor } from "./ui/connection-badge.js";

function send<T>(msg: unknown): Promise<MessageResponse<T>> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r as MessageResponse<T>)));
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function refreshHealth() {
  const el = document.getElementById("status")!;
  // The runtime answers with a report wrapping the status: reading `healthy` off the top level
  // would show "offline" for a healthy runtime. The failure states come from the shared mapping so
  // the side panel and the popup name the same state (G9.1).
  const r = await send<HealthReport>({ type: "HEALTH_CHECK" });
  const state = badgeFor(r.success ? r.data : undefined);
  el.textContent = state.text;
  el.className = state.className;
}

/**
 * The persistent egress notice (G7.4).
 *
 * Same predicate as the transport, same wording as the popup: while a non-loopback base URL is
 * saved, the side panel says which host receives captures.
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
 * What the panel says after a placement attempt — G4.5 (tasks 2.3, 3.1, 3.4).
 *
 * Two rules are encoded here. A refusal is never rendered as an absence: the code and the reason the
 * worker or the page gave are both printed, so the user can tell "injection is switched off in the
 * options" from "that page has no composer this extension recognises" instead of seeing a button
 * that appeared to do nothing. And a placement that was cut to fit says so with both lengths, because
 * a prefix presented as the whole context is worse than a refusal — the user would send it believing
 * it complete. The success line names the provider page the page itself reported, and it repeats that
 * nothing was sent, since this is the one action in the extension that writes into a page.
 */
function placementNote(
  ok: boolean,
  report: PlaceContextReport | undefined,
  error: string | undefined
): string {
  if (!ok || !report?.placed) {
    const code = report?.code ?? "ERROR";
    const why = report?.detail ?? error ?? "the worker did not report a reason";
    return `Not placed (${code}): ${why}`;
  }

  const where = report.providerId ?? "the open page";
  const placed = report.placedChars ?? 0;
  if (report.truncated) {
    const of = report.sourceChars !== undefined ? ` of ${report.sourceChars}` : "";
    const limit =
      report.maxChars !== undefined ? ` a ${report.maxChars}-character limit` : " the page's limit";
    return `Placed the first ${placed}${of} characters into ${where}, shortened to fit${limit}. Nothing was sent.`;
  }
  return `Placed ${placed} characters into ${where}. Nothing was sent.`;
}

function render(data: SearchResult) {
  const box = document.getElementById("results")!;

  const path = document.createElement("div");
  path.className = "result-source";
  path.textContent =
    data.source === "core"
      ? "From the runtime (semantic search)"
      : `From captured conversations held here (${data.indexed ?? 0} searchable offline)`;
  box.appendChild(path);

  // A limitation the runtime reported is shown rather than swallowed: the results below are then not
  // scoped the way the user asked, and saying so is the difference between a caveat and a wrong
  // answer (G3.6).
  if (data.limitation) {
    const notice = document.createElement("div");
    notice.className = "result-limitation";
    notice.textContent = data.limitation;
    box.appendChild(notice);
  }

  if (!data.results?.length) {
    const empty = document.createElement("div");
    empty.className = "result";
    empty.style.color = "var(--muted)";
    // Some text is required, and "no matches" from the local index is a different statement from
    // "no matches" in the runtime: the first means nothing captured here contains that (G3.9).
    empty.textContent =
      data.source === "local" && (data.indexed ?? 0) === 0
        ? "No matches. Nothing captured here has been acknowledged by the runtime yet."
        : "No matches";
    box.appendChild(empty);
    return;
  }

  for (const r of data.results) {
    const div = document.createElement("div");
    div.className = "result";
    // A local hit is explained by the provider and capture time it came from plus the text that
    // matched — never by an inferred relationship.
    const where = r.provider ? escapeHtml(r.provider) : escapeHtml(r.actor || "?");
    const when = r.timestamp ? `captured ${escapeHtml(r.timestamp)}` : escapeHtml(r.action || "");
    div.innerHTML = `
      <div class="meta"><strong>${where}</strong> · ${when}</div>
      <div class="target">${escapeHtml(r.target || "")}</div>
    `;

    // Placement is offered only on a local hit. `PLACE_CONTEXT` resolves its id against the index
    // held in this browser, so a hit from the runtime's semantic search is a record the index may no
    // longer hold — a button whose only honest answer is `CONTEXT_NOT_FOUND` is worse than no button
    // (G3.9). The action is on the record the user is looking at rather than on a page-wide control,
    // so there is no way to place context without having chosen which context (task 3.1).
    if (data.source === "local" && r.id) {
      const actions = document.createElement("div");
      actions.className = "result-actions";

      const place = document.createElement("button");
      place.type = "button";
      place.className = "result-place";
      place.textContent = "Place in the open chat";
      place.title =
        "Writes this capture into the message box of the tab you are looking at. It is never sent.";

      const note = document.createElement("p");
      note.className = "result-note";

      place.addEventListener("click", async () => {
        place.disabled = true;
        const res = await send<PlaceContextReport>({
          type: "PLACE_CONTEXT",
          indexedId: String(r.id),
        });
        place.disabled = false;
        note.textContent = placementNote(res.success, res.data, res.error);
      });

      actions.append(place, note);
      div.appendChild(actions);
    }

    box.appendChild(div);
  }
}

async function doSearch(q: string) {
  if (!q.trim()) return;
  const scope = byId<HTMLSelectElement>("search-scope").value === "core" ? "core" : "local";
  const r = await send<SearchResult>({ type: "SEARCH_MEMORY", query: q.trim(), limit: 20, scope });
  if (r.success && r.data) render(r.data);
}

document.addEventListener("DOMContentLoaded", async () => {
  await refreshHealth();
  await refreshEgressBanner();

  // Pending search from context menu
  const session = await chrome.storage.session.get("pendingSearch");
  if (session.pendingSearch) {
    (document.getElementById("query") as HTMLInputElement).value = session.pendingSearch;
    await doSearch(session.pendingSearch);
    await chrome.storage.session.remove("pendingSearch");
  }

  document.getElementById("btn-search")!.addEventListener("click", () => {
    doSearch((document.getElementById("query") as HTMLInputElement).value);
  });
  (document.getElementById("query") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch((e.target as HTMLInputElement).value);
  });

  document.getElementById("btn-capture")!.addEventListener("click", async () => {
    const field = byId<HTMLTextAreaElement>("capture");
    const note = byId<HTMLParagraphElement>("capture-note");
    const text = field.value.trim();
    if (!text) return;
    const btn = byId<HTMLButtonElement>("btn-capture");
    btn.disabled = true;
    const settings = (await send<ExtensionSettings>({ type: "GET_SETTINGS" })).data;
    const r = await send<MemoryRecord>({
      type: "ADD_MEMORY",
      record: {
        actor: settings?.defaultActor || "browser-user",
        action: "noted",
        target: text,
        metadata: { source: "sidepanel" },
      },
    });
    btn.disabled = false;
    if (r.success) {
      field.value = "";
      note.textContent = "";
      note.classList.add("hidden");
    } else {
      // A failed store leaves the draft in place and says why (task 8.8). Silently doing nothing
      // would look identical to a successful capture.
      const reason = r.error || "the runtime did not acknowledge it";
      note.textContent = `Not stored: ${reason}. Your text is still here — you can retry.`;
      note.classList.remove("hidden");
    }
  });
});
