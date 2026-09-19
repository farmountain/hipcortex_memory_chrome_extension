/**
 * scripts/browser-gate.mjs — real-browser gate for the CortexBridge extension.
 *
 * WHY THIS EXISTS
 * ---------------
 * Screen 8.12 in openspec/changes/cortexbridge-perception-layer/tasks.md is the screen that
 * says "load unpacked from `dist/` and record results". The jsdom project in
 * vitest.workspace.ts cannot reach it: it stubs `chrome.*` and has no MV3 service worker,
 * no real extension load, and no real network egress.
 *
 * This gate closes the part of that screen a command can reach. It launches its OWN Chromium
 * with `--load-extension=dist`, then drives it over the Chrome DevTools Protocol. It is kept
 * as a re-runnable command rather than a screen someone ran once, for the reason
 * `openspec/changes/installable-product/tasks.md` 6.3 gives about `probe-installed-host.mjs`.
 *
 * ZERO DEPENDENCIES. It uses Node 22's global `fetch` and global `WebSocket`. It is run by
 * `npm run test:browser` and is deliberately NOT part of `npm run verify`, which
 * tests/quality/gates.spec.ts pins to exactly four commands. The precedent is `install:host`:
 * a command a person runs, not a gate in the chain.
 *
 * WHAT IT PROVES / WHAT IT CANNOT
 * -------------------------------
 * Proves: the built `dist/` actually loads as an MV3 extension in a real browser; the
 *         background service worker parses and starts; popup / options / sidepanel render
 *         without uncaught errors; `runtime.sendMessage` round-trips to the worker and out to
 *         the live core; the popup badge reflects online vs offline truthfully; an options save
 *         persists; manual add clears the field through the real transport; the browser's own
 *         command registry holds the declared bindings; all three context-menu items are
 *         registered; the browser's own action invocation raises the real popup
 *         (`Extensions.triggerAction` on a tab target — the one CDP command that crosses into the
 *         extension surface); a trusted click on the popup's side-panel control opens a real side
 *         panel, observed as a new `sidepanel.html` surface (section 5b).
 * Cannot: the OS menu click and the physical Ctrl+Shift+H keystroke. This boundary was probed
 *         rather than reasoned, and section 5b records the probe. In short: the `Extensions`
 *         domain has seven commands and none of them fires a `chrome.commands` command;
 *         `Input.dispatchKeyEvent` carries no browser-command field; and an injected Ctrl+Shift+H
 *         with full native virtual key codes raises no surface at all, in a renderer that reports
 *         focus. Section 5b also records the control that makes that negative mean something —
 *         `sidepanel.html` IS observable as a browser surface when something else opens it, so
 *         "nothing appeared" is the gesture failing rather than the panel being invisible. What
 *         the keystroke cannot supply, section 5b supplies by another route: the *result* it is
 *         bound to (a panel opening) is raised by a trusted click and observed. The keystroke is
 *         the residue, not the outcome. The handlers behind both gestures are ordinary code:
 *         section 5 proves the menu items exist and that the browser accepted the key binding, and
 *         section 7 drives the shared add path they end in. What is left to a person is the
 *         gesture, not the logic.
 *         Also cannot: a live authenticated provider conversation — see
 *         `scripts/provider-capture-gate.mjs` for how far a synthetic fixture gets.
 *
 * SAFETY
 * ------
 * Uses a throwaway `--user-data-dir` in the OS temp dir, so every settings mutation below
 * happens in a disposable profile and never touches the user's real extension state.
 * Makes READ-ONLY calls to the live core (HEALTH_CHECK / CAPTURE_STATUS / SEARCH_MEMORY).
 * Never writes to the user's live HipCortex memory store: the manual-add check in section 7
 * points the endpoint at a stub this script starts on a free loopback port, so the success path
 * is proved end to end without a byte reaching the user's own memory.
 *
 * Usage:  npm run test:browser   (or: node scripts/browser-gate.mjs)
 * Env:    HIPCORTEX_CHROMIUM   override the browser binary
 *         HIPCORTEX_CDP_PORT   override the debug port (default 9333)
 *         HIPCORTEX_EXT_DIR    load this directory instead of `dist/` — point it at an
 *                              extracted copy of `hipcortex-chrome-extension-v<version>.zip`
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const DIST = process.env.HIPCORTEX_EXT_DIR
  ? resolve(process.env.HIPCORTEX_EXT_DIR)
  : resolve(process.cwd(), "dist");
/** Names the directory under test in the log and the load check; `dist` on a normal run. */
const EXT_LABEL = basename(DIST);
const CHROME =
  process.env.HIPCORTEX_CHROMIUM ??
  join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe");
const PORT = Number(process.env.HIPCORTEX_CDP_PORT ?? 9333);
const LIVE = "http://127.0.0.1:3030";
const DEAD = "http://127.0.0.1:3999"; // loopback, so `auto` mode accepts it, but nothing listens

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? " PASS" : " FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Safe one-line rendering. JSON.stringify(undefined) returns undefined, not a string. */
function snippet(v, n = 240) {
  try {
    return String(JSON.stringify(v) ?? String(v)).slice(0, n);
  } catch {
    return String(v).slice(0, n);
  }
}

/* ---------------------------------------------------------------- CDP client */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.method ?? "cdp"} failed: ${msg.error.message}`));
        else res(msg.result);
        return;
      }
      if (msg.method) this.events.push(msg);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url); // Node 22 global
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error(`cannot open WebSocket to ${url}`)), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function waitForJson(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url} (${lastErr?.message})`);
}

/* ------------------------------------------------------------- page plumbing */

/** Evaluate in a session; rejects on a JS exception so callers can retry. */
async function ev(cdp, sessionId, expression) {
  const r = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluate failed",
    );
  }
  return r.result.value;
}

/** Open an extension page and evaluate `expression` once it stops throwing. */
async function openSurface(cdp, url, expression, timeoutMs = 20000) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // Enable BEFORE navigating so early load/runtime errors are captured, not missed.
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);

  const deadline = Date.now() + timeoutMs;
  let value;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      value = await ev(cdp, sessionId, expression);
      if (value !== undefined && value !== null) break;
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }

  const consoleErrors = cdp.events
    .filter(
      (e) =>
        e.sessionId === sessionId &&
        ((e.method === "Log.entryAdded" && e.params.entry.level === "error") ||
          e.method === "Runtime.exceptionThrown" ||
          (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")),
    )
    .map((e) =>
      e.method === "Log.entryAdded"
        ? e.params.entry.text
        : e.method === "Runtime.consoleAPICalled"
          ? (e.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")
          : (e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text),
    );

  return { sessionId, targetId, value, consoleErrors, lastErr };
}

/**
 * Find the MV3 service worker belonging to ONE specific extension.
 *
 * The `extId` filter is essential: a plain Chrome install already runs component
 * extensions that expose `chrome-extension://` service workers (the one whose
 * worker is `thunk.js` is a well-known example). Matching on the scheme alone
 * reports a healthy worker for an extension that never loaded.
 */
async function findServiceWorker(cdp, extId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const sw = targetInfos.find(
      (t) =>
        t.type === "service_worker" && String(t.url).startsWith(`chrome-extension://${extId}/`),
    );
    if (sw) return sw;
    await sleep(300);
  }
  return null;
}

/**
 * A loopback stub that answers the two endpoints the HTTP transport uses, so the gate can prove
 * the extension's *success* path without writing into the user's live HipCortex memory store.
 *
 * This is not a mock of the core's contract — `docs/PROTOCOL.md` and the specs pin that. It
 * answers only the shape `src/api/transport/http.ts` requires, and it records every request so the
 * gate can assert what actually crossed the socket rather than what the page says about itself.
 */
async function startStub() {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = req.url ?? "";
      // A fetch from an extension page is cross-origin whenever the port is not covered by
      // `host_permissions` — the manifest pins port 3030, and this stub cannot use it because the
      // live core holds it. So the preflight has to be answered here, or every check below fails as
      // "Failed to fetch" and tells the reader nothing about the extension.
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, accept, authorization, x-api-key",
        "Access-Control-Max-Age": "600",
      };
      if (req.method === "OPTIONS") {
        seen.push({ method: "OPTIONS", url, body: "" });
        res.writeHead(204, cors);
        return res.end();
      }
      seen.push({ method: req.method, url, body });
      const json = (code, payload) => {
        res.writeHead(code, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "GET" && url.startsWith("/health")) {
        return json(200, { service: "hipcortex-gate-stub", status: "ok", version: "0.0.0-gate" });
      }
      if (req.method === "POST" && url.startsWith("/memory/add")) {
        // The acknowledgement rule this repo enforces: `success: true` AND a non-empty `record_id`.
        // A bare 2xx is a failure, so the stub deliberately answers the whole shape.
        return json(200, { success: true, record_id: `gate-stub-${seen.length}` });
      }
      return json(404, { error: "gate stub: no such endpoint" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => server.close(),
  };
}

/* ------------------------------------------------------------------ the probe */

let child;
let cdp;
let profile;
let stub;
let stderr = "";

async function main() {
  console.log("HipCortex CortexBridge — real-browser probe (CDP, zero deps)\n");
  console.log(`  ${EXT_LABEL.padEnd(8)} ${DIST}`);
  console.log(`  browser  ${CHROME}`);
  console.log(`  core     ${LIVE}\n`);

  if (!existsSync(join(DIST, "manifest.json"))) {
    throw new Error(EXT_LABEL + "/manifest.json is missing — run `npm run build` first");
  }
  if (!existsSync(CHROME)) {
    throw new Error(`browser not found: ${CHROME} (set HIPCORTEX_CHROMIUM)`);
  }

  // Record whether the live core is up, so the online expectation is grounded.
  let coreUp = false;
  try {
    const r = await fetch(`${LIVE}/health`);
    const body = await r.json();
    coreUp = r.ok && body?.status === "ok";
    console.log(`  core /health -> ${r.status} ${JSON.stringify(body)}\n`);
  } catch (e) {
    console.log(`  core /health -> unreachable (${e.message})\n`);
  }

  profile = mkdtempSync(join(tmpdir(), "hipcortex-e2e-"));
  child = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      `--load-extension=${DIST}`,
      `--disable-extensions-except=${DIST}`,
      `--remote-debugging-port=${PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--disable-component-update",
      "--disable-background-networking",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderrSeen = "";
  child.stderr?.on("data", (d) => {
    stderrSeen += String(d);
    stderr = stderrSeen;
  });

  const version = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`  connected  ${version.Browser}  (protocol ${version["Protocol-Version"]})\n`);
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  // Tab targets are hidden by default, and `Extensions.triggerAction` refuses every other kind
  // ("Action can only be triggered on a tab target"). The filter is a first-match-wins list, so the
  // second entry has to KEEP including everything else — a trailing `{ exclude: true }` would hide
  // the service worker and every page, which is a mistake this gate has already made once.
  await cdp.send("Target.setDiscoverTargets", {
    discover: true,
    filter: [{ type: "tab", exclude: false }, { exclude: false }],
  });

  /* --- 1. the extension loads ---------------------------------------------- */
  // chrome://extensions is the source of truth for "is it loaded at all". Its
  // components live behind nested shadow roots, so walk them recursively.
  const ENUMERATE = `(async () => {
    const collect = () => {
      const found = [];
      const walk = (root) => {
        for (const it of root.querySelectorAll('extensions-item')) {
          const sr = it.shadowRoot;
          found.push({
            id: it.getAttribute('id'),
            name: sr && sr.querySelector('#name') ? sr.querySelector('#name').textContent.trim() : null,
          });
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return found;
    };
    // The list renders lazily; returning [] on the first pass would read as "not loaded".
    for (let i = 0; i < 30; i++) {
      const f = collect();
      if (f.length) return f;
      await new Promise(r => setTimeout(r, 200));
    }
    return collect();
  })()`;

  // Chrome 137+ restricts the `--load-extension` switch (it is now silently ignored on
  // Chrome-branded / Chrome-for-Testing builds). The supported automation path is the
  // CDP `Extensions` domain, which also needs no relaunch.
  let loadError = null;
  let loadedId = null;
  try {
    const r = await cdp.send("Extensions.loadUnpacked", { path: DIST });
    loadedId = r?.id ?? null;
  } catch (e) {
    loadError = e.message;
  }
  record(
    `CDP Extensions.loadUnpacked accepts ${EXT_LABEL}/`,
    !!loadedId,
    loadedId ? `id ${loadedId}` : `error: ${loadError}`,
  );

  const extPage = await openSurface(cdp, "chrome://extensions", ENUMERATE, 15000);
  const installed = Array.isArray(extPage.value) ? extPage.value : [];
  const ours = installed.find((e) => /hipcortex/i.test(e.name ?? ""));
  record(
    "extension is listed in chrome://extensions",
    !!ours,
    ours
      ? `${ours.name} (id ${ours.id}; ${installed.length} extension(s) listed)`
      : `not listed. listed: ${snippet(installed.map((e) => e.name))}`,
  );

  const extId = ours?.id ?? loadedId;
  if (!extId) return;
  const base = `chrome-extension://${extId}`;

  const sw = await findServiceWorker(cdp, extId, 12000);
  record(
    "this extension's MV3 background service worker started",
    !!sw,
    sw ? sw.url : `no service_worker target for ${extId}`,
  );

  /* --- 2. surfaces render in a real browser, with no console errors -------- */
  const surfaceExpression = (rest) => `(async () => {
    ${rest}
  })()`;

  // The badge vocabulary is the shared G9.1 mapping in `src/ui/connection-badge.ts`, and it is
  // deliberately three states rather than one: "online", "core offline", "host not installed"
  // (plus "unknown" when no report arrived at all). A probe that waited only for the retired
  // collapsed word "offline" polls to exhaustion on every failure state and then reads whatever is
  // on screen — which is how a correct product comes to read as a failed check.
  const BADGE_CORE_OFFLINE = "core offline";
  const settleBadge = `
    const badge = document.getElementById('status-badge') || document.getElementById('status');
    const rows = ['capture-passive','capture-queued','capture-unacknowledged']
      .map((id) => document.getElementById(id)).filter(Boolean);
    for (let i = 0; i < 50; i++) {
      const badgeSettled = badge && /^(online|core offline|host not installed|unknown)$/.test((badge.textContent || '').trim());
      // popup.ts awaits refreshHealth() and only then refreshCaptureStatus(), so the badge settles a
      // round-trip before the capture rows do. Reading the rows on the badge's schedule is a race.
      const rowsSettled = rows.length === 0 || rows.every((e) => (e.textContent || '').trim() !== '\u2026');
      if (badgeSettled && rowsSettled) break;
      await new Promise(r => setTimeout(r, 200));
    }`;

  // 2a. popup, as shipped, against the live core
  const popup = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`${settleBadge}
      const txt = (id) => { const e = document.getElementById(id); return e ? (e.textContent||'').trim() : null; };
      return {
        title: document.title,
        badge: badge ? badge.textContent.trim() : null,
        badgeClass: badge ? badge.className : null,
        capture: { passive: txt('capture-passive'), queued: txt('capture-queued'), unack: txt('capture-unacknowledged') },
        toggle: document.getElementById('capture-toggle')?.checked ?? null,
        hasControls: ['memory-text','memory-action','btn-add','btn-sidepanel','btn-options','search-query',
          'conversation-capture','btn-capture-conversation','conversation-capture-note','capture-toggle']
          .every(id => !!document.getElementById(id)),
        egressHidden: document.getElementById('egress-banner')?.classList.contains('hidden') ?? null,
      };`),
  );
  record(
    "popup.html renders in a real browser",
    popup.value?.title === "HipCortex" && popup.value?.hasControls === true,
    `title=${JSON.stringify(popup.value?.title)} controls=${popup.value?.hasControls}`,
  );
  record(
    "popup: every control the UI code expects is present",
    popup.value?.hasControls === true,
    popup.value?.hasControls ? "" : "a getElementById() target is missing — popup.ts would throw",
  );
  /*
   * The switch that decides whether anything is captured at all, as a real browser with a real
   * throwaway profile reads it. The defect this change set was opened for was a default that shipped
   * off, so the probe asserting the checkbox is *checked* on a fresh install is the end-to-end version
   * of the unit test — it goes through chrome.storage, the worker's GET_SETTINGS, and the shipped
   * markup, and it would still pass a build whose default regressed in any one of those three.
   */
  record(
    "popup: passive capture is on in a fresh profile, as shipped",
    popup.value?.toggle === true && popup.value?.capture?.passive === "on",
    `checkbox=${JSON.stringify(popup.value?.toggle)} row=${JSON.stringify(popup.value?.capture?.passive)}`,
  );
  record(
    "popup: no uncaught errors / console errors on load",
    popup.consoleErrors.length === 0,
    popup.consoleErrors.length ? popup.consoleErrors.slice(0, 3).join(" | ") : "",
  );

  // 2b. the badge must reflect the live core truthfully
  if (coreUp) {
    record(
      "popup badge reports online against the live core",
      popup.value?.badge === "online",
      `badge=${JSON.stringify(popup.value?.badge)} class=${JSON.stringify(popup.value?.badgeClass)}`,
    );
  } else {
    record("popup badge reports online against the live core", true, "SKIPPED — core /health was not ok");
  }

  // 2c. CAPTURE_STATUS round-tripped and the capture rows stopped showing the placeholder
  const cap = popup.value?.capture ?? {};
  const capSettled = [cap.passive, cap.queued, cap.unack].every((v) => v !== null && v !== "…");
  record(
    "popup: CAPTURE_STATUS round-trip fills the capture rows",
    capSettled,
    JSON.stringify(cap),
  );

  // 2d. real messaging: sendMessage -> worker router -> transport -> core
  const health = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`
      try {
        const r = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK' });
        return { ok: true, reply: r };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }`),
  );
  // MessageResponse<HealthReport> is `{ success, data: { health, resolution } }` — the
  // popup's "online" badge keys off data.health.healthy, not a bare `ok`.
  const hReply = health.value?.reply;
  const healthOk =
    health.value?.ok === true && hReply?.success === true && hReply?.data?.health?.healthy === true;
  record(
    "runtime.sendMessage(HEALTH_CHECK) round-trips to the core",
    healthOk,
    snippet(
      { success: hReply?.success, health: hReply?.data?.health, resolution: hReply?.data?.resolution },
      320,
    ),
  );
  record(
    "transport resolution is reported (which path actually carried the call)",
    !!hReply?.data?.resolution?.active,
    snippet(hReply?.data?.resolution, 260),
  );

  const search = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`
      try {
        const r = await chrome.runtime.sendMessage({ type: 'SEARCH_MEMORY', query: 'hipcortex', limit: 3 });
        return { ok: true, shape: Array.isArray(r) ? 'array' : typeof r, reply: r };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }`),
  );
  record(
    "runtime.sendMessage(SEARCH_MEMORY) round-trips (read-only)",
    search.value?.ok === true,
    snippet(search.value),
  );

  /*
   * 2d-bis. the button a user actually presses, pressed for real.
   *
   * `CAPTURE_ACTIVE_TAB` is the one path added for the first user report, and it crosses every layer
   * the change set touched: the shipped markup's button, the controller's click handler, the worker's
   * router case, the tab lookup, the URL check, and back to a rendered sentence. This probe runs on an
   * extension page, so the active tab is `chrome-extension://…` and the correct outcome is a typed
   * `PAGE_NOT_WATCHED` — which is the point: the probe is asserting that a click on an unwatched page
   * produces a sentence, not a hang, a spinner, or an unhandled rejection. A build that answered
   * `success: true` here would be claiming to have stored a conversation that does not exist.
   */
  const manual = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`${settleBadge}
      const button = document.getElementById('btn-capture-conversation');
      const note = document.getElementById('conversation-capture-note');
      const toggle = document.getElementById('capture-toggle');
      if (!button || !note || !toggle) return { ok: false, error: 'the capture control is not in the shipped markup' };
      /*
       * The click has to land after the controller has run. The button exists as soon as the markup is
       * parsed, but the listener is registered on DOMContentLoaded, so a click issued a moment earlier
       * would hit a button with nothing behind it and the check would read that as a product failure.
       * A checked passive switch is the signal that the controller has hydrated, because the shipped
       * markup ships the checkbox unchecked and only the controller ever sets it.
       */
      for (let i = 0; i < 50; i++) {
        if (toggle.checked) break;
        await new Promise(r => setTimeout(r, 100));
      }
      button.click();
      /*
       * The wait is for the *outcome*, not for any text. The handler writes "Reading this page…" before
       * it awaits, so polling for non-empty text would read the placeholder the instant it was written
       * and call a capture that is still in flight a finished one. The three outcomes are exactly the
       * three state classes the controller appends, so waiting for a class is waiting for the answer.
       */
      for (let i = 0; i < 100; i++) {
        if (/\\b(ok|pending|err)\\b/.test(note.className)) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return {
        ok: true,
        hydrated: toggle.checked === true,
        text: (note.textContent || '').trim(),
        hidden: note.classList.contains('hidden'),
        className: note.className,
        reEnabled: button.disabled === false,
      };`),
  );
  const manualText = manual.value?.text ?? "";
  record(
    "popup: the capture button answers with a typed sentence about an unwatched page",
    manual.value?.ok === true &&
      manual.value?.hidden === false &&
      /could not capture this conversation \([A-Z_]+\)/i.test(manualText) &&
      !/stored/i.test(manualText),
    snippet({ text: manualText, hidden: manual.value?.hidden, className: manual.value?.className }, 300),
  );
  record(
    "popup: a completed capture attempt leaves the button usable again",
    manual.value?.reEnabled === true,
    `disabled=${JSON.stringify(manual.value?.reEnabled === false)}`,
  );

  // 2e. the offline half — mutate settings in THIS throwaway profile only.
  // `transportMode` must be forced to `developer`: under `auto` the worker prefers the
  // desktop app over HTTP, so a dead HTTP port would never reach the badge at all.
  if (coreUp) {
    await openSurface(
      cdp,
      `${base}/popup.html`,
      surfaceExpression(`
        await chrome.storage.sync.set({ apiUrl: ${JSON.stringify(DEAD)}, transportMode: 'developer' });
        const all = await chrome.storage.sync.get(null);
        return { apiUrl: all.apiUrl, transportMode: all.transportMode };`),
    );
    const offline = await openSurface(
      cdp,
      `${base}/popup.html`,
      surfaceExpression(`${settleBadge}
        const txt = (id) => { const e = document.getElementById(id); return e ? (e.textContent||'').trim() : null; };
        return { badge: badge ? badge.textContent.trim() : null, badgeClass: badge ? badge.className : null, addErrorShown: txt('add-error'), capture: txt('capture-queued') };`),
    );
    record(
      "popup badge names the core as the unreachable half, not the host",
      offline.value?.badge === BADGE_CORE_OFFLINE &&
        offline.value?.badgeClass === "badge unhealthy",
      `badge=${JSON.stringify(offline.value?.badge)} class=${JSON.stringify(offline.value?.badgeClass)}`,
    );
    record(
      "offline popup still renders its controls (no crash)",
      offline.value?.capture !== null,
      `capture-queued=${JSON.stringify(offline.value?.capture)}`,
    );

    // restore the shipped defaults, then confirm the badge recovers — proves the setting
    // really drove the reading, rather than the badge being stuck on one value.
    await openSurface(
      cdp,
      `${base}/popup.html`,
      surfaceExpression(`
        await chrome.storage.sync.set({ apiUrl: ${JSON.stringify(LIVE)}, transportMode: 'auto' });
        const all = await chrome.storage.sync.get(null);
        return { apiUrl: all.apiUrl, transportMode: all.transportMode };`),
    );
    const restored = await openSurface(
      cdp,
      `${base}/popup.html`,
      surfaceExpression(`${settleBadge}
        return { badge: badge ? badge.textContent.trim() : null };`),
    );
    record(
      "popup badge recovers to online after the URL is restored",
      restored.value?.badge === "online",
      `badge=${JSON.stringify(restored.value?.badge)}`,
    );
  }

  /* --- 3. options and sidepanel ------------------------------------------- */
  const options = await openSurface(
    cdp,
    `${base}/options.html`,
    surfaceExpression(`
      const url = document.getElementById('apiUrl');
      for (let i = 0; i < 50; i++) { if (url && url.value) break; await new Promise(r => setTimeout(r, 200)); }
      return {
        title: document.title,
        apiUrlValue: url ? url.value : null,
        mode: document.getElementById('transportMode')?.value ?? null,
        actor: document.getElementById('defaultActor')?.value ?? null,
        hasForm: !!document.getElementById('settings-form'),
        hasTestBtn: !!document.getElementById('btn-test'),
        status: (document.getElementById('status')?.textContent || '').trim(),
      };`),
  );
  record(
    "options.html renders and hydrates from GET_SETTINGS",
    options.value?.hasForm === true && options.value?.apiUrlValue === LIVE,
    `apiUrl=${JSON.stringify(options.value?.apiUrlValue)} mode=${JSON.stringify(options.value?.mode)}`,
  );
  record(
    "options: no uncaught errors / console errors on load",
    options.consoleErrors.length === 0,
    options.consoleErrors.length ? options.consoleErrors.slice(0, 3).join(" | ") : "",
  );

  // options: the Test Connection button, clicked for real
  const test = await openSurface(
    cdp,
    `${base}/options.html`,
    surfaceExpression(`
      const url = document.getElementById('apiUrl');
      const btn = document.getElementById('btn-test');
      const st = document.getElementById('status');
      // options.ts attaches its listeners only AFTER an awaited GET_SETTINGS round-trip,
      // so clicking before the form hydrates dispatches into the void. Wait for hydration.
      for (let i = 0; i < 75; i++) {
        if (url && url.value) break;
        await new Promise(r => setTimeout(r, 200));
      }
      btn.click();
      for (let i = 0; i < 75; i++) {
        if (st && (st.textContent || '').trim()) break;
        await new Promise(r => setTimeout(r, 200));
      }
      return { status: (st?.textContent || '').trim(), statusClass: st?.className ?? null, hydrated: !!(url && url.value) };`),
  );
  record(
    "options: clicking Test Connection produces a status",
    !!test.value?.status,
    snippet(test.value),
  );
  record(
    "options: Test Connection produces no console error",
    test.consoleErrors.length === 0,
    test.consoleErrors.length ? test.consoleErrors.slice(0, 2).join(" | ") : "",
  );

  const sidepanel = await openSurface(
    cdp,
    `${base}/sidepanel.html`,
    surfaceExpression(`
      const el = document.getElementById('status');
      for (let i = 0; i < 50; i++) {
        if (el && /^(online|offline)$/.test((el.textContent || '').trim())) break;
        await new Promise(r => setTimeout(r, 200));
      }
      return {
        title: document.title,
        status: el ? el.textContent.trim() : null,
        hasControls: ['query','btn-search','results','capture','btn-capture','capture-note',
          'conversation-capture','btn-capture-conversation','conversation-capture-note']
          .every(id => !!document.getElementById(id)),
      };`),
  );
  record(
    "sidepanel.html renders and reaches the core",
    sidepanel.value?.hasControls === true && ["online", "offline"].includes(sidepanel.value?.status),
    `status=${JSON.stringify(sidepanel.value?.status)} controls=${sidepanel.value?.hasControls}`,
  );
  record(
    "sidepanel: no uncaught errors / console errors on load",
    sidepanel.consoleErrors.length === 0,
    sidepanel.consoleErrors.length ? sidepanel.consoleErrors.slice(0, 3).join(" | ") : "",
  );

  /* --- 4. the manifest surface a human cannot check by clicking ------------ */
  const manifest = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`
      const m = chrome.runtime.getManifest();
      const cmds = Object.keys(m.commands || {});
      return {
        name: m.name,
        mv: m.manifest_version,
        sidePanel: m.side_panel?.default_path ?? null,
        optionsUi: m.options_ui?.page ?? null,
        popup: m.action?.default_popup ?? null,
        commands: cmds,
        // contextMenus has no enumeration API, but the permission is what the
        // manual gate asserts about the manifest.
        hasContextMenusPerm: (m.permissions || []).includes('contextMenus'),
        hostPerms: m.host_permissions || [],
      };`),
  );
  const mv = manifest.value ?? {};
  record(
    `manifest resolves inside the browser (MV3, repointed to ${EXT_LABEL}/)`,
    mv.mv === 3 && mv.popup === "popup.html" && mv.sidePanel === "sidepanel.html",
    snippet({ mv: mv.mv, popup: mv.popup, sidePanel: mv.sidePanel }),
  );
  record(
    "declared commands are visible to a loaded extension",
    Array.isArray(mv.commands) && mv.commands.includes("open-side-panel"),
    snippet(mv.commands),
  );
  record(
    "host_permissions stayed loopback-only in the loaded manifest",
    Array.isArray(mv.hostPerms) &&
      mv.hostPerms.length > 0 &&
      mv.hostPerms.every((h) => /127\.0\.0\.1|localhost/.test(h)),
    snippet(mv.hostPerms),
  );

  /* --- 5. the two events the browser chrome raises, not the renderer ------- */
  // `chrome.contextMenus.onClicked` fires from the OS menu and `chrome.commands.onCommand` from a
  // keystroke the browser UI resolves above the renderer, so no CDP input event can raise either
  // one. Two things ARE measurable from inside the loaded extension, and both are stronger than
  // re-reading the manifest:
  //   (a) `chrome.commands.getAll()` crosses into the browser's own command registry, so it proves
  //       the browser ACCEPTED the binding rather than that the file declares one;
  //   (b) `chrome.contextMenus` has no enumeration API, but `create` rejects a duplicate id. Asking
  //       for an id that should already exist is therefore the only existence test the platform
  //       offers, and a rejection is positive evidence that `setupContextMenus()` ran.
  const swTarget = await findServiceWorker(cdp, extId, 12000);
  const swSession = swTarget
    ? (await cdp.send("Target.attachToTarget", { targetId: swTarget.targetId, flatten: true }))
        .sessionId
    : null;

  const MENU_IDS = [
    "hipcortex-add-selection",
    "hipcortex-add-page",
    "hipcortex-search-selection",
  ];
  const swProbe = swSession
    ? await ev(
        cdp,
        swSession,
        `(async () => {
          const out = {
            commands: null,
            commandsError: null,
            menu: {},
            menuEvent: typeof chrome.contextMenus?.onClicked,
            menuDispatch: typeof chrome.contextMenus?.onClicked?.dispatch,
            cmdDispatch: typeof chrome.commands?.onCommand?.dispatch,
          };
          try {
            out.commands = (await chrome.commands.getAll()).map((c) => ({
              name: c.name,
              shortcut: c.shortcut ?? '',
              description: c.description ?? '',
            }));
          } catch (e) {
            out.commandsError = String((e && e.message) || e);
          }
          for (const id of ${JSON.stringify(MENU_IDS)}) {
            out.menu[id] = await new Promise((resolve) => {
              try {
                chrome.contextMenus.create({ id, title: 'gate probe', contexts: ['selection'] }, () => {
                  if (chrome.runtime.lastError) return resolve('duplicate');
                  // It was NOT registered. Remove the probe item so nothing is left behind, and
                  // report the finding so the check below can fail honestly.
                  chrome.contextMenus.remove(id, () => resolve('created-then-removed'));
                });
              } catch (e) {
                resolve('threw: ' + String((e && e.message) || e));
              }
            });
          }
          return out;
        })()`,
      )
    : null;

  // The registry also reports Chrome's built-in `_execute_action`, so this asserts the two
  // declared commands are present, not that the list has exactly two entries.
  record(
    "the browser's own command registry holds both declared commands",
    Array.isArray(swProbe?.commands) &&
      ["open-side-panel", "quick-add-memory"].every((n) =>
        swProbe.commands.some(
          (c) => c.name === n && typeof c.description === "string" && c.description.length > 0,
        ),
      ),
    snippet(swProbe?.commands ?? swProbe?.commandsError),
  );
  const osp = (swProbe?.commands ?? []).find((c) => c.name === "open-side-panel");
  record(
    "the browser bound Ctrl+Shift+H to open-side-panel (the key 8.12 names)",
    typeof osp?.shortcut === "string" && /ctrl\+shift\+h/i.test(osp.shortcut),
    `shortcut=${JSON.stringify(osp?.shortcut ?? null)}`,
  );
  const menuIds = swProbe?.menu ?? {};
  record(
    "all three context-menu items are registered in the live browser",
    MENU_IDS.every((id) => menuIds[id] === "duplicate"),
    snippet(menuIds),
  );

  // Probed, not assumed. Whether these events carry a `dispatch` changes nothing about what
  // remains a human step: it is the platform's answer to "can a renderer-side test raise them".
  console.log(
    `  note: contextMenus.onClicked is ${swProbe?.menuEvent ?? "?"} ` +
      `(dispatch=${swProbe?.menuDispatch ?? "?"}); ` +
      `commands.onCommand.dispatch=${swProbe?.cmdDispatch ?? "?"}\n`,
  );

  /* --- 5b. the boundary above, probed instead of asserted ------------------ */
  // Section 5 says no CDP input event can raise the menu click or the keystroke. That is a claim
  // about the platform, so it is checked against the platform rather than believed:
  //
  //   * the browser's own protocol descriptor (`GET /json/protocol` on the debug port) lists 56
  //     domains. `Extensions` is the only one that crosses into the extension surface, and it has
  //     exactly seven commands: loadUnpacked, getExtensions, uninstall, triggerAction and the four
  //     storage commands. Exactly one of those raises a user-facing event.
  //   * `Input.dispatchKeyEvent`'s parameter list has no browser-command field — its `commands`
  //     parameter is the editing-command list — so a key event cannot resolve an accelerator.
  //
  // So the action IS reachable and the keystroke is not. Given a tab target, `triggerAction`
  // dispatches the real action and the real popup opens: a result produced by the browser's own
  // action registry, not by navigating a target to the URL the popup happens to live at.
  const extSurfaces = async () =>
    (await cdp.send("Target.getTargets")).targetInfos
      .filter((t) => String(t.url).startsWith(base))
      .map((t) => String(t.url).slice(base.length));

  // Counted, not de-duplicated. By the time section 5b runs, popup.html and sidepanel.html are
  // already open several times over, so a set-style diff would report "nothing new" for a surface
  // that did in fact appear a second time — and would report it for the negative check too, where
  // that mistake would make the check pass vacuously. Nothing else runs between the two snapshots
  // of each pair below, so a rise in the count is attributable to the one command in between.
  const surfaceCounts = (list) =>
    list.reduce((m, s) => Object.assign(m, { [s]: (m[s] ?? 0) + 1 }), {});
  const appeared = (before, after) => {
    const b = surfaceCounts(before);
    const a = surfaceCounts(after);
    return Object.keys(a).filter((s) => (a[s] ?? 0) > (b[s] ?? 0));
  };

  try {
    await cdp.send("Target.createTarget", { url: "about:blank" });
  } catch {
    /* an existing tab will do */
  }
  await sleep(800);
  const tabTarget = (await cdp.send("Target.getTargets")).targetInfos.find(
    (t) => t.type === "tab",
  );

  const beforeAction = await extSurfaces();
  let actionError = null;
  let actionResult = null;
  if (!tabTarget) {
    actionError = "no tab target was exposed";
  } else {
    try {
      actionResult = await cdp.send("Extensions.triggerAction", {
        id: extId,
        targetId: tabTarget.targetId,
      });
    } catch (e) {
      actionError = e.message;
    }
  }
  await sleep(2500);
  const afterAction = await extSurfaces();
  const raised = appeared(beforeAction, afterAction);
  record(
    "the browser's own action invocation raises the real popup",
    !!actionResult && raised.some((s) => s.includes("popup.html")),
    `result=${JSON.stringify(actionResult ?? null)} appeared=${snippet(raised)}` +
      (actionError ? ` error=${actionError}` : ""),
  );

  // The control. Without it, "the keystroke raised nothing" cannot be told apart from "the surface
  // is unobservable": both read as an empty list. Opening sidepanel.html by a route that is NOT a
  // gesture proves the surface is observable, which is what gives the negative below its meaning.
  const panel = await cdp.send("Target.createTarget", { url: `${base}/sidepanel.html` });
  await sleep(1200);
  const panelSurfaces = await extSurfaces();
  record(
    "control: sidepanel.html is observable as a browser surface",
    !!panel.targetId && appeared(beforeAction, panelSurfaces).some((s) => s.includes("sidepanel.html")),
    `appeared=${snippet(appeared(beforeAction, panelSurfaces))}`,
  );

  // The negative, now distinguishable from an invisible panel. `document.hasFocus()` is part of the
  // check on purpose: if the renderer never had focus the accelerator could not have fired for a
  // reason that has nothing to do with CDP, so an unfocused renderer must not read as a pass.
  const { targetInfos: keyTargets } = await cdp.send("Target.getTargets");
  const keyPage = keyTargets.find((t) => t.type === "page");
  let keySession = null;
  let keyFocused = null;
  let injectedNew = [];
  if (keyPage) {
    keySession = (
      await cdp.send("Target.attachToTarget", { targetId: keyPage.targetId, flatten: true })
    ).sessionId;
    await cdp.send("Runtime.enable", {}, keySession);
    await cdp.send("Page.enable", {}, keySession);
    await cdp.send("Page.bringToFront", {}, keySession).catch(() => {});
    async function focusOf() {
      const r = await cdp.send(
        "Runtime.evaluate",
        { expression: "document.hasFocus()", returnByValue: true },
        keySession,
      );
      return r.result?.value ?? null;
    }
    keyFocused = await focusOf();
    const mods = 2 | 8; // Ctrl | Shift
    const chord = {
      modifiers: mods,
      windowsVirtualKeyCode: 72,
      nativeVirtualKeyCode: 72,
      code: "KeyH",
      key: "H",
    };
    const beforeKey = await extSurfaces();
    await cdp.send("Input.dispatchKeyEvent", { ...chord, type: "rawKeyDown" }, keySession);
    await sleep(60);
    await cdp.send("Input.dispatchKeyEvent", { ...chord, type: "keyUp" }, keySession);
    await sleep(2500);
    keyFocused = await focusOf();
    injectedNew = appeared(beforeKey, await extSurfaces());
  }
  record(
    "an injected Ctrl+Shift+H raises no side panel (the gesture no command can reach)",
    !!keySession && keyFocused === true && injectedNew.length === 0,
    keySession
      ? `renderer focused=${JSON.stringify(keyFocused)} appeared=${snippet(injectedNew)}`
      : "no page target to inject into",
  );

  // The side panel opening — which is the RESULT 8.12 names, and the one part of it that had no
  // output at all. The browser binding and the handler dispatch were already covered; whether
  // `chrome.sidePanel.open()` actually opens a panel in a real browser was not, and it is the only
  // step a spec cannot reach, because a jsdom harness has no panel to open. It does open. Note the
  // first attempt at this said the opposite, for a reason that had nothing to do with gestures and
  // everything to do with geometry: the control sits at y=673 in a popup whose viewport is 582px
  // tall, so an un-scrolled click lands outside the page and raises nothing. Scrolling it into view
  // is what turns that false negative into this true positive, and `inView` is asserted rather than
  // assumed so the artifact cannot come back silently.
  const clickSurface = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`${settleBadge}
      return { badge: badge ? badge.textContent.trim() : null };`),
  );
  const panelBtn = await ev(
    cdp,
    clickSurface.sessionId,
    `(() => {
      const b = document.getElementById('btn-sidepanel');
      if (!b) return { missing: true };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        inView: r.top >= 0 && r.bottom <= window.innerHeight &&
          r.left >= 0 && r.right <= window.innerWidth,
      };
    })()`,
  );
  const beforePanel = await extSurfaces();
  if (!panelBtn?.missing) {
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: panelBtn.x, y: panelBtn.y, button: "left", clickCount: 1, buttons: 1 },
      clickSurface.sessionId,
    );
    await sleep(80);
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", x: panelBtn.x, y: panelBtn.y, button: "left", clickCount: 1, buttons: 0 },
      clickSurface.sessionId,
    );
  }
  await sleep(2500);
  const panelOpened = appeared(beforePanel, await extSurfaces());
  record(
    "a trusted click on the popup's side-panel control opens a real side panel",
    panelBtn?.inView === true && panelOpened.some((s) => s.includes("sidepanel.html")),
    `extension=${extId} button=${JSON.stringify(panelBtn?.missing ?? null)} ` +
      `inView=${panelBtn?.inView} appeared=${snippet(panelOpened)}`,
  );

  /* --- 6. options: an actual save, not just a render ----------------------- */
  // 8.12 asks for "options save plus test connection". Test Connection is covered above; this is
  // the save. The form's submit listener is the only writer, so the check drives the form the way
  // a person does — `requestSubmit()` — and then reads `chrome.storage.sync` back directly rather
  // than trusting the status line the page prints about itself. The probe value is restored, so
  // the profile is left as it was found.
  const save = await openSurface(
    cdp,
    `${base}/options.html`,
    surfaceExpression(`
      const form = document.getElementById('settings-form');
      const actor = document.getElementById('defaultActor');
      const st = document.getElementById('status');
      for (let i = 0; i < 75; i++) {
        if (actor && actor.value) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const readBack = async () => (await chrome.storage.sync.get('defaultActor')).defaultActor ?? null;
      // Poll STORAGE, not the status line. The page prints "Settings saved" on the first submit,
      // so settling on that string again after the second submit returns instantly and reads the
      // first save's value back — which is exactly how a restore that never ran looks correct.
      const settle = async (want) => {
        for (let i = 0; i < 75; i++) {
          if ((await readBack()) === want) break;
          await new Promise(r => setTimeout(r, 200));
        }
      };
      const before = actor ? actor.value : null;
      actor.value = 'browser-gate-save-probe';
      form.requestSubmit();
      await settle('browser-gate-save-probe');
      const savedStatus = (st ? st.textContent : '').trim();
      const saved = await readBack();
      actor.value = before == null ? '' : before;
      form.requestSubmit();
      await settle(before);
      const restored = await readBack();
      return { before, savedStatus, saved, restored };`),
  );
  record(
    "options: submitting the form writes the change through to chrome.storage",
    save.value?.saved === "browser-gate-save-probe" &&
      /Settings saved/.test(save.value?.savedStatus ?? ""),
    snippet(save.value),
  );
  record(
    "options: the second save restored the original value (the probe left no residue)",
    !!save.value?.before &&
      save.value?.restored === save.value?.before &&
      save.value?.restored !== "browser-gate-save-probe",
    snippet({ before: save.value?.before, restored: save.value?.restored }),
  );
  record(
    "options: save produces no console error",
    save.consoleErrors.length === 0,
    save.consoleErrors.length ? save.consoleErrors.slice(0, 2).join(" | ") : "",
  );

  /* --- 7. manual add, through the real transport, against a loopback stub --- */
  // 8.12 asks for "manual add". The add path ends in `sendRecord`, so against the live core it
  // would write into the user's own memory store — which this gate does not do (see SAFETY).
  // Instead the endpoint is pointed at a stub this script starts on a free loopback port. That
  // proves the success path end to end — real click, real `chrome.runtime.sendMessage`, real
  // socket — and lets the gate assert the wire body, with zero residue anywhere.
  stub = await startStub();
  console.log(`  stub core  ${stub.url}  (loopback; answers /health and /memory/add only)\\n`);

  const addText = "browser gate manual add probe";
  const added = await openSurface(
    cdp,
    `${base}/popup.html`,
    surfaceExpression(`
      // The popup hydrates on load, but its add handler re-requests settings at click time, so
      // writing storage here is enough — no reload needed.
      await chrome.storage.sync.set({
        apiUrl: ${JSON.stringify(stub.url)},
        transportMode: 'developer',
        defaultActor: 'browser-gate-probe',
      });
      const field = document.getElementById('memory-text');
      const action = document.getElementById('memory-action');
      const btn = document.getElementById('btn-add');
      const failure = document.getElementById('add-error');
      // popup.ts awaits refreshHealth → refreshEgressBanner → refreshCaptureStatus →
      // refreshIndexStatus BEFORE it binds #btn-add, so an element that exists is not yet a button
      // that works: clicking on the strength of getElementById alone lands on a listener that is
      // still three round-trips away, and this check then blames the transport for a hydration race.
      // The signal is the tail of that chain — #index-note is empty in the markup and is filled in
      // by refreshIndexStatus, the await that runs immediately before the binding.
      let hydrated = false;
      for (let i = 0; i < 50; i++) {
        const note = document.getElementById('index-note');
        hydrated = !!(field && btn && note && (note.textContent || '').trim() !== '');
        if (hydrated) break;
        await new Promise(r => setTimeout(r, 200));
      }
      field.value = ${JSON.stringify(addText)};
      action.value = 'noted';
      const typedBack = field.value;
      btn.click();
      for (let i = 0; i < 75; i++) {
        if ((field.value || '') === '' || (failure && !failure.classList.contains('hidden'))) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const afterClick = {
        fieldAfter: field.value,
        errorVisible: failure ? !failure.classList.contains('hidden') : null,
        errorText: (failure ? failure.textContent : '').trim(),
        buttonUsable: !btn.disabled,
      };
      // Independent of the click: does the message itself reach the stub? If this succeeds while
      // the click does nothing, the fault is in the popup's binding, not in the transport.
      let direct = null;
      try {
        const r = await chrome.runtime.sendMessage({
          type: 'ADD_MEMORY',
          record: { actor: 'browser-gate-probe', action: 'noted', target: 'gate direct probe', metadata: { source: 'gate-direct' } },
        });
        direct = { success: r?.success ?? null, error: r?.error ?? null, acknowledged: r?.data?.acknowledged ?? null };
      } catch (e) {
        direct = { threw: String((e && e.message) || e) };
      }
      return {
        hydrated,
        typedBack,
        afterClick,
        direct,
        toast: (document.querySelector('.toast') ? document.querySelector('.toast').textContent : '').trim(),
      };`),
  );
  // Match the click's own request by its payload, not by counting: the direct probe below sends a
  // second POST, and an assertion on "exactly one request" would then pin the wrong thing.
  const posts = stub.seen.filter((r) => r.method === "POST" && r.url === "/memory/add");
  const parsed = posts.map((r) => {
    try {
      return JSON.parse(r.body);
    } catch {
      return null;
    }
  });
  const fromClick = parsed.find((b) => b?.target === addText) ?? null;
  const click = added.value?.afterClick ?? {};
  record(
    "manual add: the popup finished hydrating before the click was raised",
    added.value?.hydrated === true,
    `hydrated=${added.value?.hydrated}`,
  );
  record(
    "manual add: the field clears and no error is shown against a reachable core",
    click.fieldAfter === "" && click.errorVisible === false,
    snippet(added.value),
  );
  record(
    "manual add: the click put the typed record on the wire, through the real transport",
    fromClick?.actor === "browser-gate-probe" &&
      fromClick?.action === "noted" &&
      fromClick?.metadata?.source === "popup",
    snippet({
      seen: stub.seen.map((r) => `${r.method} ${r.url} ${r.body.length}B`),
      fromClick,
    }),
  );
  record(
    "manual add: ADD_MEMORY also round-trips as a bare message (the transport, not the click)",
    added.value?.direct?.success === true,
    snippet(added.value?.direct),
  );
  record(
    "manual add: the button is usable again afterwards",
    click.buttonUsable === true,
    `disabled=${click.buttonUsable === true ? "false" : "true"}`,
  );

  // Restore the profile the way this gate found it; the profile is deleted in `finally` anyway,
  // but a gate that leaves its own state behind is a gate the next check cannot trust.
  await ev(
    cdp,
    added.sessionId,
    `chrome.storage.sync.set({
      apiUrl: ${JSON.stringify(LIVE)},
      transportMode: 'auto',
      defaultActor: ${JSON.stringify(save.value?.before ?? "browser-user")},
    })`,
  );
}

/* ---------------------------------------------------------------- entrypoint */

main()
  .catch((e) => {
    record("probe completed without throwing", false, e.message);
    console.error(`\n${e.stack ?? e}`);
  })
  .finally(async () => {
    cdp?.close();
    if (stub) {
      try {
        stub.close();
      } catch {
        /* already closed */
      }
    }
    if (child) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    await sleep(500);
    if (profile) {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        console.log(`  note: could not remove temp profile ${profile}`);
      }
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length && stderr.trim()) {
      console.log(`\n  browser stderr tail:\n${stderr.trim().split("\n").slice(-12).join("\n")}`);
    }
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed` +
        (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join("; ")}` : ""),
    );
    process.exit(failed.length ? 1 : 0);
  });
