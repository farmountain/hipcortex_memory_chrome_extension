import type {
  ExtensionSettings,
  HealthReport,
  ImportReport,
  MessageResponse,
  RemapLookup,
  TransportMode,
} from "./types/index.js";
import { DEFAULT_SETTINGS, TRANSPORT_MODES } from "./types/index.js";
import { isLoopbackUrl } from "./api/transport/endpoints.js";

function send<T>(msg: unknown): Promise<MessageResponse<T>> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r as MessageResponse<T>)));
}

function showStatus(text: string, ok: boolean) {
  const el = document.getElementById("status")!;
  el.textContent = text;
  el.className = `status show ${ok ? "ok" : "err"}`;
}

function field<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/**
 * The base URL that is actually persisted.
 *
 * Kept so a declined confirmation can restore the field to the value that is still in effect, and so
 * the connection test can say which URL it probed when the form holds an unsaved edit. It is read
 * from `GET_SETTINGS` on load and updated only after a save the worker accepted — never from the
 * field, because the field is a draft.
 */
let persistedApiUrl = DEFAULT_SETTINGS.apiUrl;

function isTransportMode(value: string): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value);
}

function isUrl(raw: string): boolean {
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The host a base URL would send captures to, or `null` when the value cannot leave the machine.
 *
 * The loopback test is the transport's own predicate rather than a second list, so "this page asked
 * for a confirmation" and "the transport will send off-machine" can never disagree (G7.2). An
 * unparseable value returns `null`: it cannot carry a capture anywhere, and it is rejected by the
 * caller for a different reason — it is not a URL.
 */
function remoteHostOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || isLoopbackUrl(trimmed)) return null;
  try {
    return new URL(trimmed).hostname;
  } catch {
    return null;
  }
}

/**
 * The confirmation text.
 *
 * It names the exact host, and it says what will be sent there. A dialog that said only "are you
 * sure?" would be satisfied by a reflexive click, which is the outcome G7.2 exists to prevent.
 */
function confirmationText(host: string): string {
  return (
    `Send captured conversations to "${host}"?\n\n` +
    `"${host}" is not this machine. Every conversation the extension captures from your AI chat ` +
    `sessions will be sent to that host.\n\n` +
    `Choose Cancel to keep the base URL that is currently saved (${persistedApiUrl}).`
  );
}

function readForm(): ExtensionSettings {
  const mode = field<HTMLSelectElement>("transportMode").value;
  return {
    apiUrl: field<HTMLInputElement>("apiUrl").value.trim(),
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    defaultActor: field<HTMLInputElement>("defaultActor").value.trim() || DEFAULT_SETTINGS.defaultActor,
    autoCapture: field<HTMLInputElement>("autoCapture").checked,
    injectIntoAiChats: field<HTMLInputElement>("injectIntoAiChats").checked,
    headroomMode: field<HTMLInputElement>("headroomMode").checked,
    transportMode: isTransportMode(mode) ? mode : DEFAULT_SETTINGS.transportMode,
  };
}

function fillForm(s: ExtensionSettings): void {
  field<HTMLInputElement>("apiUrl").value = s.apiUrl;
  field<HTMLInputElement>("apiKey").value = s.apiKey;
  field<HTMLInputElement>("defaultActor").value = s.defaultActor;
  field<HTMLInputElement>("autoCapture").checked = s.autoCapture;
  field<HTMLInputElement>("injectIntoAiChats").checked = s.injectIntoAiChats;
  field<HTMLInputElement>("headroomMode").checked = s.headroomMode;
  field<HTMLSelectElement>("transportMode").value = isTransportMode(s.transportMode)
    ? s.transportMode
    : DEFAULT_SETTINGS.transportMode;
}

/**
 * The connection-test line.
 *
 * It names the resolved mode, whether a fallback happened, and — always — what was actually tried,
 * because "Unreachable" with no destination turns a misconfiguration into a mystery (tasks 8.2,
 * 8.3). A successful probe in `auto` mode is reported as a fallback rather than as plain success:
 * the desktop app is missing, and hiding that would make the next failure unexplainable.
 *
 * The two native failure states are reported separately rather than as one "Unreachable" (G9.1), and
 * each one names what ends it (G9.2). The not-installed case is the one that used to be actively
 * misleading: it told a user who had never installed HipCortex to check that HipCortex was running.
 *
 * The distinction is gated on `health.connection` rather than applied to every failure, because only
 * the native transport can make it. A host that is registered but whose core is down has an action
 * ("start it"); a transport that simply could not reach its endpoint has nothing to start and only a
 * destination to name. A transport that reports no `connection` — the HTTP path — keeps the endpoint
 * wording, and the `Unreachable` prefix is not retired: it is still the right word for it.
 */
function describeResult(report: HealthReport | undefined, error: string | undefined): [string, boolean] {
  const health = report?.health;
  const resolution = report?.resolution;
  const tried = resolution?.detail ?? "the configured base URL";
  const mode = resolution ? `${resolution.mode} mode` : "unknown mode";

  if (health?.healthy) {
    const service = health.service ? ` (${health.service})` : "";
    const fallback = resolution?.fellBack ? "fell back" : "no fallback";
    return [`Connected — ${health.status}${service} via ${mode} · ${fallback} · tried ${tried}`, true];
  }

  if (health?.connection === "host-not-registered") {
    return [
      `Not installed: ${tried}. Nothing to start — the browser has no HipCortex host registered yet.`,
      false,
    ];
  }

  const status = health?.status ? `${health.status} — ` : "";

  if (health?.connection === "core-unreachable") {
    return [
      `Installed but not running: ${status}tried ${tried} (${mode}). ${
        error ?? "The host is registered and its core did not answer. Start HipCortex, then test again."
      }`,
      false,
    ];
  }

  return [`Unreachable: ${status}tried ${tried} (${mode}). ${error ?? "no response"}`, false];
}

/**
 * Write a report into one of the two result panels.
 *
 * Everything goes in as text, and the earlier report is replaced wholesale: a second import that
 * succeeded must not leave the first one's refusals on screen. The class carries whether the answer
 * was a yes, which is what colours the border.
 *
 * The panel is never left empty on failure to arrive at an answer — "the answer did not come back" is
 * itself something the user has to be told, and an empty panel reads as success.
 */
function showReport(id: string, headline: string, lines: readonly string[], ok: boolean): void {
  const panel = field<HTMLDivElement>(id);
  panel.textContent = "";
  panel.className = `report ${ok ? "ok" : "err"}`;

  const head = document.createElement("div");
  head.className = "report-head";
  head.textContent = headline;
  panel.appendChild(head);

  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "report-note";
    row.textContent = line;
    panel.appendChild(row);
  }
}

/**
 * The import report, as a headline and its detail lines.
 *
 * The headline is built from the counts rather than from `success` alone, because the reply's flag
 * answers "did every record land", while the numbers answer "what happened" — and it is the numbers a
 * user has to act on. A run with a refusal is headed as incomplete and names the count: a migration
 * reported as complete while records were refused is the failure this feature exists inside (G4.2).
 *
 * Nothing printed here comes from captured text. The per-record lines name ids and the runtime's own
 * words, which is everything a person needs to decide what to do next and nothing they did not ask
 * to see again (G2.10).
 */
export function describeImport(
  report: ImportReport | undefined,
  error: string | undefined
): [string, string[]] {
  if (!report) return ["No report came back", [error ?? "The worker did not answer the import."]];

  const failed = report.outcomes.filter((outcome) => outcome.outcome === "failed").length;
  const lines: string[] = [];

  lines.push(
    `imported ${report.imported} · refused ${report.refused} · failed ${failed} of ` +
      `${report.outcomes.length} record${report.outcomes.length === 1 ? "" : "s"} in this file · ` +
      `actor ${report.actor}`
  );

  for (const failure of report.failures) {
    const where = failure.index === null ? "the document" : `record ${failure.index}`;
    const field = failure.field ? ` (field "${failure.field}")` : "";
    lines.push(`refused ${failure.kind} at ${where}${field}: ${failure.detail}`);
  }

  if (report.failures.length > 0) {
    lines.push("Nothing from this file was written.");
  }

  for (const outcome of report.outcomes) {
    if (outcome.outcome === "imported") {
      lines.push(
        `#${outcome.index} imported as ${outcome.recordId}` +
          (outcome.previousId ? ` (was ${outcome.previousId})` : "") +
          (outcome.detail ? ` — ${outcome.detail}` : "")
      );
      continue;
    }

    // The refusal reason the runtime gave is inside `detail`, which is where the transport already
    // put it: printing it a second time from a field of its own would be the queue's vocabulary in a
    // report about an import.
    const reason = outcome.reason ?? "no reason given";
    lines.push(`#${outcome.index} not imported (${outcome.outcome}): ${reason} — ${outcome.detail ?? ""}`);
  }

  for (const note of report.notes) lines.push(`note ${note.kind}: ${note.detail}`);

  const headline =
    report.failures.length > 0
      ? "Import refused — nothing was written"
      : report.refused + failed > 0
        ? `Import incomplete — ${report.imported} of ${report.outcomes.length} records written`
        : `Imported ${report.imported} record${report.imported === 1 ? "" : "s"}`;

  return [headline, lines];
}

/**
 * The answer to "what did this id become".
 *
 * A miss is reported as a miss rather than as a failure: the remap holds only what this browser
 * itself migrated, so an id the user never put through an import being absent is the expected answer
 * — and saying which of the two happened ("not remapped here" versus "the remap is empty") is what
 * stops a user hunting for a bug that is not there (G4.2).
 */
export function describeLookup(
  previousId: string,
  lookup: RemapLookup | undefined,
  error: string | undefined
): [string, string[]] {
  if (!lookup) return ["Could not read the remap", [error ?? "The worker did not answer the lookup."]];

  if (!lookup.found) {
    return [
      `Not remapped: ${previousId}`,
      [
        `${lookup.imports} import${lookup.imports === 1 ? "" : "s"} recorded in this browser. ` +
          "An id is only here if it was migrated on this machine; the core keeps the mapping on its side too.",
      ],
    ];
  }

  const when = lookup.importedAt ? ` recorded ${lookup.importedAt}` : "";
  const as = lookup.action ? ` as "${lookup.action}"` : "";

  return [
    `Remapped to ${lookup.recordId}`,
    [
      `${previousId} was migrated${as}${when}, in the newest of ${lookup.imports} import` +
        `${lookup.imports === 1 ? "" : "s"} this browser recorded.`,
      "The core issues a new id on import, which is why this side keeps the mapping it saw.",
    ],
  ];
}

document.addEventListener("DOMContentLoaded", async () => {
  const res = await send<ExtensionSettings>({ type: "GET_SETTINGS" });
  const s = { ...DEFAULT_SETTINGS, ...(res.data ?? {}) };
  fillForm(s);
  persistedApiUrl = s.apiUrl;

  field<HTMLFormElement>("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = readForm();

    if (!isUrl(settings.apiUrl)) {
      showStatus("Enter a valid base URL, for example http://127.0.0.1:3030", false);
      return;
    }

    const host = remoteHostOf(settings.apiUrl);
    if (host !== null && !window.confirm(confirmationText(host))) {
      // Declining leaves the previous value in place and makes no request (G7.2).
      field<HTMLInputElement>("apiUrl").value = persistedApiUrl;
      showStatus(`Not saved: "${host}" was not confirmed. The base URL is still ${persistedApiUrl}`, false);
      return;
    }

    const r = await send<ExtensionSettings>({
      type: "SAVE_SETTINGS",
      settings,
      confirmRemoteHost: host ?? undefined,
    });

    if (!r.success) {
      showStatus(r.error || "Save failed", false);
      return;
    }

    persistedApiUrl = r.data?.apiUrl ?? settings.apiUrl;
    showStatus(
      host === null
        ? "Settings saved"
        : `Settings saved — captured conversations go to ${host}, not this machine`,
      true
    );
  });

  field<HTMLButtonElement>("btn-test").addEventListener("click", async () => {
    const typed = readForm().apiUrl;
    if (!isUrl(typed)) {
      showStatus("Enter a valid base URL before testing, for example http://127.0.0.1:3030", false);
      return;
    }

    // The probe uses the saved configuration, and says so when the field holds an unsaved edit: a
    // connection test must not persist a remote host as a side effect of being clicked.
    const r = await send<HealthReport>({ type: "HEALTH_CHECK" });
    const [text, ok] = describeResult(r.data, r.error);
    showStatus(
      typed === persistedApiUrl ? text : `${text} · testing the saved URL ${persistedApiUrl}; save to test ${typed}`,
      ok
    );
  });

  field<HTMLButtonElement>("btn-import").addEventListener("click", async () => {
    const chosen = field<HTMLInputElement>("import-file").files?.[0];
    if (!chosen) {
      showReport("import-report", "No file chosen", ["Choose a memory export first."], false);
      return;
    }

    const button = field<HTMLButtonElement>("btn-import");
    button.disabled = true;
    try {
      const r = await send<ImportReport>({ type: "IMPORT_DOCUMENT", text: await chosen.text() });
      const report = r.data;
      const [headline, lines] = describeImport(report, r.error);
      showReport("import-report", headline, lines, r.success && report !== undefined);
    } finally {
      button.disabled = false;
    }
  });

  field<HTMLButtonElement>("btn-remap").addEventListener("click", async () => {
    const previousId = field<HTMLInputElement>("remap-id").value.trim();
    if (previousId.length === 0) {
      showReport("remap-result", "Nothing to resolve", ["Enter an id first."], false);
      return;
    }

    const r = await send<RemapLookup>({ type: "RESOLVE_PREVIOUS_ID", previousId });
    const [headline, lines] = describeLookup(previousId, r.data, r.error);
    showReport("remap-result", headline, lines, r.data?.found === true);
  });
});
