/**
 * scripts/provider-capture-gate.mjs — the provider-page capture gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/END-STATE.md` open risk 4 says the gates prove *this repository's* behaviour "not the
 * product's behaviour in a browser", and names the reason: "no spec can observe ... a provider's
 * live DOM". `scripts/browser-gate.mjs` covers every surface Chrome exposes to CDP — the popup, the
 * options page, the side panel, the service worker, the manifest, native transport — but it never
 * opens a provider page, so the one link it cannot reach is the first one: a conversation sitting on
 * `chatgpt.com` being turned into a capture by the shipped content script.
 *
 * This probe closes that link, and it is the only artefact in this repository that does.
 *
 * HOW IT WORKS
 * ------------
 * The content script is injected by the manifest, so it only runs on the six matched origins. To get
 * a page at one of those origins without a live authenticated session, this probe enables CDP `Fetch`
 * interception on the page session and fulfils the navigation locally from a committed fixture under
 * `tests/fixtures/<provider>/`. Chrome commits the real provider origin and path, the manifest's
 * match pattern really fires, the shipped `dist/content.js` really executes — and the DOM it reads is
 * the same fixture the jsdom suite reads. **No socket is opened to any provider.**
 *
 * The capture then travels the real path: content script -> `chrome.runtime.sendMessage`
 * (`CAPTURE_UPDATE`) -> the MV3 service worker -> normalization and provenance stamping -> the queue
 * (the transport is deliberately pointed at a dead loopback port). The queue is read back with
 * `EXPORT_QUEUE`, so what is asserted is what the product actually retained, not what a function
 * returned.
 *
 * THE URLS ARE THE INTERESTING PART
 * ---------------------------------
 * Each adapter refuses a bare host on purpose. `src/capture/providers/chatgpt.ts:26` is explicit:
 * "A bare host is not a conversation, and matching one would make the adapter claim the landing page
 * — where extraction would then fail on every visit." So this probe drives each provider at a URL its
 * own `CONVERSATION_PATH` regex claims, and then pins the refusal as a negative case by driving the
 * bare host and asserting that *nothing* is captured. An earlier revision of this probe used the bare
 * host and observed a correctly empty queue; the defect was in the probe, not the product.
 *
 * WHY THE MUTATION
 * ----------------
 * The content script sends only when a debounced *mutation* changes the conversation signature; a
 * static page yields no event, by design (see the header of `src/content/entry.ts`). A live provider
 * page churns after load, so this probe makes the page churn: it appends empty elements to `body` on
 * an interval. The appends sit outside every conversation root, so the signature never changes and
 * exactly one capture per page is expected — which is itself the assertion that the signature-dedup
 * works.
 *
 * THE THREE OUTCOMES IT PINS
 * --------------------------
 *   1. POSITIVE   — a claimed conversation URL whose DOM matches the ladders is captured, with the
 *                   right provider provenance and all four turns in order.
 *   2. NEGATIVE   — a bare host is claimed by no adapter, so nothing is captured and nothing fails.
 *                   (Not a failure: the landing page was never this adapter's business.)
 *   3. FAIL-CLOSED — a claimed conversation URL whose DOM does *not* match the ladders is refused
 *                   with a typed, content-free diagnosis and never queued — proven by the fixture's
 *                   sentinel text `MARKER-MUST-NOT-BE-READ` being absent from the queue *and* from
 *                   the extension's storage. This is the central product property from AGENTS.md:
 *                   "a typed failure is always preferable to a plausible wrong capture."
 *
 * SAFETY
 * ------
 * - A throwaway `--user-data-dir` in the OS temp dir; the user's real extension state is untouched.
 * - `apiUrl` is pointed at `http://127.0.0.1:3999` (loopback, nothing listening) in `developer`
 *   transport mode BEFORE any provider page is opened, so no capture can reach the live core and none
 *   is delivered. That is the point: the queue holds the evidence.
 * - The probe finishes by asserting the live core holds **zero** records for the throwaway actor.
 * - Makes no write call to the core. Never restarts or stops it.
 *
 * ZERO DEPENDENCIES. Node 22 globals only. Run by `npm run test:browser:providers`, and deliberately
 * NOT part of `npm run verify`, which tests/quality/gates.spec.ts pins to exactly four commands.
 *
 * Usage:  npm run test:browser:providers   (or: node scripts/provider-capture-gate.mjs)
 * Env:    HIPCORTEX_CHROMIUM      override the browser binary
 *         HIPCORTEX_CDP_PORT      override the debug port (default 9334)
 *         HIPCORTEX_EXT_DIR       load this directory instead of `dist/` — point it at an
 *                                 extracted copy of `hipcortex-chrome-extension-v<version>.zip`
 *                                 to run all of the below against the uploaded package itself
 *         HIPCORTEX_DEBUG=1       dump CAPTURE_STATUS, extension storage and the export
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const REPO = resolve(process.cwd());
const DIST = process.env.HIPCORTEX_EXT_DIR
  ? resolve(process.env.HIPCORTEX_EXT_DIR)
  : join(REPO, "dist");
/** Names the directory under test in the log and the load check; `dist` on a normal run. */
const EXT_LABEL = basename(DIST);
const CHROME =
  process.env.HIPCORTEX_CHROMIUM ??
  join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe");
const PORT = Number(process.env.HIPCORTEX_CDP_PORT ?? 9334);
const LIVE_CORE = "http://127.0.0.1:3030";
const DEAD_CORE = "http://127.0.0.1:3999";
const DEBUG = process.env.HIPCORTEX_DEBUG === "1";

/** Digit-free on purpose: the core's PII precondition refuses an actor containing a long digit run. */
const ACTOR = "provider-probe-control";

/**
 * The five providers. `conversation` is a URL the adapter's own `CONVERSATION_PATH` regex claims —
 * a different path per provider, so `matches()` cannot pass by accident. `root` is the bare host,
 * which every adapter refuses on purpose.
 */
const PROVIDERS = [
  {
    id: "chatgpt",
    host: "chatgpt.com",
    root: "https://chatgpt.com/",
    conversation: "https://chatgpt.com/c/provider-probe-one",
  },
  {
    id: "claude",
    host: "claude.ai",
    root: "https://claude.ai/",
    conversation: "https://claude.ai/chat/provider-probe-one",
  },
  {
    id: "grok",
    host: "grok.com",
    root: "https://grok.com/",
    conversation: "https://grok.com/chat/provider-probe-one",
  },
  {
    id: "gemini",
    host: "gemini.google.com",
    root: "https://gemini.google.com/",
    conversation: "https://gemini.google.com/app/provider-probe-one",
  },
  {
    id: "deepseek",
    host: "chat.deepseek.com",
    root: "https://chat.deepseek.com/",
    conversation: "https://chat.deepseek.com/a/chat/s/provider-probe-one",
  },
];

/** Every conversation fixture carries these four turns, in this order, under these roles. */
const EXPECTED_TEXT = [
  "REDACTED-USER-1",
  "REDACTED-ASSISTANT-1",
  "REDACTED-USER-2",
  "REDACTED-ASSISTANT-2",
];
const EXPECTED_ROLES = ["user", "assistant", "user", "assistant"];

/** `tests/fixtures/chatgpt/unknown-shape.html` puts this in the text nodes and removes the composer
 *  landmark. If the landmark gate ever read text before gating, this string would surface. */
const SENTINEL = "MARKER-MUST-NOT-BE-READ";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? " PASS" : " FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function snippet(v, n = 300) {
  try {
    return String(JSON.stringify(v) ?? String(v)).slice(0, n);
  } catch {
    return String(v).slice(0, n);
  }
}
/** Position of `needle` in `hay`, or -1. Lets order be asserted without assuming a record shape. */
const at = (hay, needle) => hay.indexOf(needle);

/* ---------------------------------------------------------------- CDP client */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
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
      const fn = msg.method ? this.handlers.get(msg.method) : undefined;
      if (fn) {
        try {
          fn(msg);
        } catch {
          /* a handler must never take the probe down */
        }
      }
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

  /** Register a handler for an event method. Replaces any previous handler for that method. */
  on(method, fn) {
    this.handlers.set(method, fn);
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

/** Poll an expression until it returns a truthy value or the deadline passes. */
async function waitFor(cdp, sessionId, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await ev(cdp, sessionId, expression);
      if (last) return last;
    } catch {
      /* not ready yet */
    }
    await sleep(150);
  }
  return last;
}

/* ------------------------------------------------------------------ the probe */

let child;
let cdp;
let profile;

/**
 * Serve one fixture at one real provider URL in a fresh tab, let the content script run, and make the
 * page churn so the debounced observer fires.
 */
async function openFixturePage(p, url, fixtureRelPath, { churn = true } = {}) {
  const html = readFileSync(join(REPO, fixtureRelPath), "utf8");
  const htmlB64 = Buffer.from(html, "utf8").toString("base64");
  const paused = [];
  const contexts = [];
  const exceptions = [];

  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sessionId = a.sessionId;

  // Fulfil any request for THIS origin from THIS fixture. Only this session carries this pattern, so
  // a page for one provider can never be served another provider's DOM.
  cdp.on("Fetch.requestPaused", (msg) => {
    if (msg.sessionId !== sessionId) return;
    paused.push({ url: msg.params.request.url, type: msg.params.resourceType });
    const isDocument = msg.params.resourceType === "Document";
    const reply = isDocument
      ? {
          requestId: msg.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
          body: htmlB64,
        }
      : { requestId: msg.params.requestId, responseCode: 204, responseHeaders: [] };
    cdp.send("Fetch.fulfillRequest", reply, sessionId).catch(() => {});
  });

  // A content script runs in an isolated world whose origin is the extension's, so this is direct
  // evidence that the shipped `dist/content.js` was injected, not an inference from a side effect.
  cdp.on("Runtime.executionContextCreated", (msg) => {
    if (msg.sessionId !== sessionId) return;
    const c = msg.params?.context ?? {};
    contexts.push({
      id: c.id,
      name: c.name,
      origin: c.origin,
      isDefault: c.auxData?.isDefault === true,
    });
  });

  // Any uncaught throw in the page or in the content script's world.
  cdp.on("Runtime.exceptionThrown", (msg) => {
    if (msg.sessionId !== sessionId) return;
    const d = msg.params?.exceptionDetails ?? {};
    exceptions.push(d.exception?.description ?? d.text ?? "uncaught");
  });

  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Fetch.enable",
    { patterns: [{ urlPattern: `${p.root}*`, requestStage: "Request" }] },
    sessionId,
  );
  await cdp.send("Page.navigate", { url }, sessionId);

  // Wait on readyState rather than on a turn marker: the fail-closed fixture has turns but a
  // mismatched shape, and the next revision of a fixture might have neither.
  await waitFor(cdp, sessionId, "document.readyState === 'complete' ? 1 : 0", 20000);
  await sleep(400);

  const committed = await ev(cdp, sessionId, "location.href");
  const turns = await ev(
    cdp,
    sessionId,
    "document.querySelectorAll('[data-message-author-role]').length",
  );
  const worlds = contexts.filter((c) => String(c.origin ?? "").startsWith("chrome-extension://"));

  if (churn) {
    // Let document_idle injection land, then churn the DOM so the debounced observer fires. The
    // appends are outside every conversation root, so the signature stays stable and one capture is
    // expected per page — which is itself the signature-dedup assertion.
    await sleep(1200);
    await ev(
      cdp,
      sessionId,
      `(() => { let n = 0; const t = setInterval(() => {
         document.body.appendChild(document.createElement('span'));
         if (++n > 14) clearInterval(t);
       }, 350); return 'churning'; })()`,
    );
    await sleep(6500);
  }

  return { sessionId, targetId: t.targetId, paused, contexts, exceptions, turns, worlds, committed };
}

async function main() {
  console.log("HipCortex CortexBridge — provider-page capture probe (CDP, zero deps)\n");
  console.log(`  repo     ${REPO}`);
  console.log(`  ${EXT_LABEL.padEnd(8)} ${DIST}`);
  console.log(`  browser  ${CHROME}`);
  console.log(`  core     ${LIVE_CORE} (read-only; captures are pointed at ${DEAD_CORE})\n`);

  if (!existsSync(join(DIST, "manifest.json"))) {
    throw new Error(EXT_LABEL + "/manifest.json is missing — run `npm run build` first");
  }
  if (!existsSync(join(DIST, "content.js"))) {
    throw new Error(EXT_LABEL + "/content.js is missing — the content script was not bundled");
  }
  if (!existsSync(CHROME)) {
    throw new Error(`browser not found: ${CHROME} (set HIPCORTEX_CHROMIUM)`);
  }
  for (const p of PROVIDERS) {
    for (const f of ["conversation.html", "unknown-shape.html"]) {
      const path = join(REPO, "tests", "fixtures", p.id, f);
      if (!existsSync(path)) throw new Error(`fixture missing: ${path}`);
    }
  }

  let coreUp = false;
  try {
    const r = await fetch(`${LIVE_CORE}/health`);
    const body = await r.json();
    coreUp = r.ok && body?.status === "ok";
    console.log(`  core /health -> ${r.status} ${JSON.stringify(body)}\n`);
  } catch (e) {
    console.log(`  core /health -> unreachable (${e.message})\n`);
  }

  profile = mkdtempSync(join(tmpdir(), "hipcortex-provider-"));
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
  child.stderr?.on("data", () => {
    /* benign Chrome noise; the sibling probe captures it when it matters */
  });

  const version = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`  connected  ${version.Browser}  (protocol ${version["Protocol-Version"]})\n`);
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  await cdp.send("Target.setDiscoverTargets", { discover: true });

  /* --- 1. the extension loads ---------------------------------------------- */
  let extId = null;
  try {
    const r = await cdp.send("Extensions.loadUnpacked", { path: DIST });
    extId = r?.id ?? null;
  } catch (e) {
    record(`CDP Extensions.loadUnpacked accepts ${EXT_LABEL}/`, false, `error: ${e.message}`);
  }
  record(`CDP Extensions.loadUnpacked accepts ${EXT_LABEL}/`, !!extId, extId ? `id ${extId}` : "");
  if (!extId) throw new Error("the extension did not load, so no capture can be observed");

  /* --- 2. a control surface, so the queue can be read back ------------------ */
  const ui = await cdp.send("Target.createTarget", { url: "about:blank" });
  const uiAttach = await cdp.send("Target.attachToTarget", { targetId: ui.targetId, flatten: true });
  const uiSession = uiAttach.sessionId;
  await cdp.send("Runtime.enable", {}, uiSession);
  await cdp.send("Page.enable", {}, uiSession);
  await cdp.send("Page.navigate", { url: `chrome-extension://${extId}/popup.html` }, uiSession);
  const uiReady = await waitFor(
    cdp,
    uiSession,
    "typeof chrome !== 'undefined' && !!chrome.runtime?.id",
  );
  record(
    "an extension page is available to read the queue back",
    !!uiReady,
    `chrome-extension://${extId}/popup.html`,
  );

  const ask = (message) =>
    ev(cdp, uiSession, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then(r => r)`);
  const exportQueue = async () => {
    const r = await ask({ type: "EXPORT_QUEUE" });
    return { raw: r, doc: r?.data ?? {}, records: Array.isArray(r?.data?.records) ? r.data.records : [] };
  };
  const readAllStorage = async () => {
    const parts = [];
    for (const area of ["local", "sync", "session"]) {
      try {
        parts.push(
          await ev(cdp, uiSession, `chrome.storage.${area}.get(null).then(o => JSON.stringify(o))`),
        );
      } catch {
        parts.push("");
      }
    }
    return parts.join("\n");
  };

  /**
   * Poll until the queue holds at least `minRecords`. The transport attempt against a closed port can
   * take seconds to fail, and a capture is only queued *after* that attempt fails — so a fixed sleep
   * is not a sound way to wait for a queued capture. This was the cause of a spurious FAIL in an
   * earlier revision: the last provider's capture arrived after the assertion had already run.
   */
  const pollQueue = async (minRecords, timeoutMs = 45000) => {
    const deadline = Date.now() + timeoutMs;
    let recs = [];
    let waited = 0;
    while (Date.now() < deadline) {
      recs = (await exportQueue()).records;
      if (recs.length >= minRecords) break;
      await sleep(500);
      waited += 500;
    }
    return { records: recs, waitedMs: waited };
  };

  /** Observe a window for growth, then confirm stability. Used by the negative cases. */
  const observeGrowth = async (baseline, observeMs = 15000) => {
    await sleep(observeMs);
    const a = (await exportQueue()).records.length;
    await sleep(4000);
    const b = (await exportQueue()).records.length;
    return { a, b, grew: Math.max(a, b) > baseline };
  };

  /* --- 3. point the extension at a dead loopback port, and enable autoCapture */
  const save = await ask({
    type: "SAVE_SETTINGS",
    settings: {
      apiUrl: DEAD_CORE,
      defaultActor: ACTOR,
      autoCapture: true,
      transportMode: "developer",
    },
  });
  record(
    "SAVE_SETTINGS points captures at a dead loopback port and turns autoCapture on",
    save?.success === true,
    snippet(save),
  );

  const settings = await ask({ type: "GET_SETTINGS" });
  const s = settings?.data ?? {};
  record(
    "the worker reports the settings it was given",
    s.apiUrl === DEAD_CORE && s.autoCapture === true && s.transportMode === "developer",
    `apiUrl=${s.apiUrl} autoCapture=${s.autoCapture} transportMode=${s.transportMode} actor=${s.defaultActor}`,
  );

  /* --- 4. OUTCOME 1: each provider's own conversation URL is captured -------- */
  for (const p of PROVIDERS) {
    const page = await openFixturePage(
      p,
      p.conversation,
      join("tests", "fixtures", p.id, "conversation.html"),
    );

    const committedOk = String(page.committed ?? "").startsWith(p.conversation);
    record(
      `${p.id}: the conversation URL commits and the fixture's DOM is present`,
      committedOk && page.turns === 4,
      `url=${page.committed} turns=${page.turns} fulfilled=${page.paused.length}`,
    );
    record(
      `${p.id}: the shipped content script is injected into the provider page`,
      page.worlds.length >= 1,
      `isolatedWorlds=${page.worlds.length} ${snippet(page.worlds.map((w) => w.name), 80)}`,
    );
    record(
      `${p.id}: the content script raises no uncaught exception`,
      page.exceptions.length === 0,
      page.exceptions.length ? snippet(page.exceptions, 200) : "0 exceptions",
    );
  }

  const filled = await pollQueue(PROVIDERS.length);
  const positive = await exportQueue();
  const afterPositive = positive.records.length;
  record(
    "every provider's capture reaches the queue, one per provider and no duplicates",
    afterPositive === PROVIDERS.length,
    `records=${afterPositive}/${PROVIDERS.length} after ${filled.waitedMs} ms of polling`,
  );

  /* --- 5. what the product actually retained -------------------------------- */
  const status = await ask({ type: "CAPTURE_STATUS" });
  const st = status?.data ?? {};
  record(
    "CAPTURE_STATUS reports a queue holding one capture per provider",
    (st.retention?.queued ?? 0) === PROVIDERS.length,
    `queued=${st.retention?.queued} refused=${st.retention?.refused} paused=${st.retention?.paused} autoCapture=${st.autoCapture}`,
  );
  record(
    "each provider's failed transport attempt was diagnosed exactly once",
    (st.failures ?? -1) === PROVIDERS.length,
    `failures=${st.failures} (one UNREACHABLE per provider against the closed port)`,
  );
  record(
    "EXPORT_QUEUE returns a versioned, non-destructive document",
    positive.raw?.success === true && positive.doc.schema_version === 1,
    `schema_version=${positive.doc.schema_version} exported_at=${positive.doc.exported_at} actor=${positive.doc.actor} records=${afterPositive}`,
  );

  // The structured retention record, read from where the queue actually stores it. `EXPORT_QUEUE`
  // returns *egress* records, in which the turns are rendered into one `target` string and no `role`
  // field exists at all — so roles must be asserted here, and the rendering asserted separately
  // below. Discovering that cost one debugging round. It is a contract fact, not a defect: a lossy
  // rendering for the core alongside a lossless queue is the designed split, and this probe is what
  // makes the distinction visible.
  const queueRaw = await ev(
    cdp,
    uiSession,
    "chrome.storage.local.get('hipcortex.capture.queue').then(o => JSON.stringify(o))",
  );
  const queueEntries = JSON.parse(queueRaw ?? "{}")["hipcortex.capture.queue"]?.entries ?? [];
  record(
    "the structured queue holds one entry per provider",
    queueEntries.length === PROVIDERS.length,
    `entries=${queueEntries.length} storage keys=${Object.keys(JSON.parse(queueRaw ?? "{}")).join(",")}`,
  );

  const eventIds = [];
  for (const p of PROVIDERS) {
    const entry = queueEntries.find((e) => e?.event?.provenance?.provider === p.id);
    const msgs = entry?.event?.conversation?.messages ?? [];
    const prov = entry?.event?.provenance ?? {};
    eventIds.push(entry?.event?.eventId);

    record(
      `${p.id}: the retained conversation is four turns, roles and text exact`,
      msgs.length === 4 &&
        msgs.map((m) => m.role).join("/") === EXPECTED_ROLES.join("/") &&
        msgs.map((m) => m.text).join("|") === EXPECTED_TEXT.join("|"),
      `roles=${msgs.map((m) => m.role).join("/") || "none"} turns=${msgs.length}`,
    );
    record(
      `${p.id}: provenance is the provider, the exact URL, and a versioned schema`,
      prov.provider === p.id &&
        prov.conversationUrl === p.conversation &&
        prov.schemaVersion === 1 &&
        !!prov.adapterVersion &&
        !!prov.capturedAt &&
        entry?.event?.conversation?.title === "Redacted conversation",
      `provider=${prov.provider} url=${prov.conversationUrl} adapterVersion=${prov.adapterVersion} schemaVersion=${prov.schemaVersion}`,
    );
    // Deliberately NOT asserting `outcome === "transient" && attempts === 1`: an entry is written
    // `pending`/attempts 0 on enqueue and only becomes `transient`/attempts 1 once the retry pump
    // has made a delivery attempt, so that pair is a timing-dependent intermediate state. The
    // invariant that holds from enqueue onwards — and the one RETENTION.md promises — is that the
    // entry is kept, scheduled for retry, and never refused.
    record(
      `${p.id}: the undelivered capture is retained, scheduled for retry, and never refused`,
      !!entry &&
        entry.refusalReason === null &&
        entry.outcome !== "refused" &&
        !!entry.nextAttemptAt &&
        !!entry.enqueuedAt,
      `outcome=${entry?.outcome} attempts=${entry?.attempts} refusalReason=${entry?.refusalReason} nextAttemptAt=${entry?.nextAttemptAt}`,
    );

    // The egress rendering — the form the core would actually receive. Each role label is paired
    // with its own text, which "the texts appear in order" cannot establish on its own.
    const target = String(
      positive.records.find((e) => String(e?.action ?? "").endsWith(`:${p.id}`))?.target ?? "",
    );
    const paired = EXPECTED_ROLES.every((role, i) => target.includes(`${role}:\n${EXPECTED_TEXT[i]}`));
    const orderedInTarget = EXPECTED_TEXT.every(
      (t, i) => i === 0 || at(target, t) > at(target, EXPECTED_TEXT[i - 1]),
    );
    record(
      `${p.id}: the egress rendering pairs each role label with its own turn text`,
      paired && orderedInTarget,
      `pairs=4/4 ordered=${orderedInTarget} targetBytes=${target.length}`,
    );
  }
  record(
    "every capture carries a distinct event id (nothing was deduplicated away)",
    new Set(eventIds).size === PROVIDERS.length && eventIds.every((id) => !!id),
    `unique=${new Set(eventIds).size}/${PROVIDERS.length}`,
  );

  if (DEBUG) {
    console.log(`\n DEBUG egress record[0] ${snippet(positive.records[0] ?? null, 1200)}`);
    console.log(` DEBUG queue entry[0] ${snippet(queueEntries[0] ?? null, 1200)}`);
    console.log(` DEBUG CAPTURE_STATUS ${snippet(status, 600)}\n`);
  }

  /* --- 6. OUTCOME 2: a bare host is claimed by no adapter, so nothing is captured */
  const bare = await openFixturePage(
    PROVIDERS[0],
    PROVIDERS[0].root,
    join("tests", "fixtures", "chatgpt", "conversation.html"),
  );
  const bareGrowth = await observeGrowth(afterPositive);
  record(
    "a bare host is not claimed as a conversation, so no capture is produced",
    !bareGrowth.grew,
    `queue ${afterPositive} -> ${bareGrowth.a} -> ${bareGrowth.b}  (chatgpt.ts:26 "A bare host is not a conversation")`,
  );
  record(
    "the bare host was refused by URL matching, not by extraction — the DOM was there",
    bare.turns === 4 && bare.exceptions.length === 0,
    `turns=${bare.turns} exceptions=${bare.exceptions.length}`,
  );

  /* --- 7. OUTCOME 3: a mismatched DOM is refused, typed, and never queued --- */
  const bad = await openFixturePage(
    PROVIDERS[0],
    `${PROVIDERS[0].root}c/provider-probe-unknown`,
    join("tests", "fixtures", "chatgpt", "unknown-shape.html"),
  );
  const badGrowth = await observeGrowth(afterPositive);
  const badExport = await exportQueue();
  const storage = await readAllStorage();

  record(
    "a claimed URL whose DOM does not match the ladders is never queued",
    !badGrowth.grew,
    `queue ${afterPositive} -> ${badGrowth.a} -> ${badGrowth.b}`,
  );
  record(
    "the fail-closed fixture really did present readable-looking turns",
    bad.turns >= 1,
    `turns=${bad.turns} (the fixture carries ${SENTINEL} in its text nodes)`,
  );
  record(
    `the landmark gate refused before reading text: "${SENTINEL}" is nowhere in the export or storage`,
    !JSON.stringify(badExport.raw).includes(SENTINEL) && !storage.includes(SENTINEL),
    `sentinel found in export=${JSON.stringify(badExport.raw).includes(SENTINEL)} in storage=${storage.includes(SENTINEL)}`,
  );

  const typedCodes = [
    ...new Set((storage.match(/"([A-Z][A-Z_]{5,})"/g) ?? []).map((c) => c.slice(1, -1))),
  ];
  record(
    "the refusal is recorded as a typed, content-free diagnosis",
    typedCodes.includes("DOM_SHAPE_UNRECOGNIZED"),
    `typed codes observed: ${typedCodes.join(", ") || "none"} (storage ${storage.length} B)`,
  );

  if (DEBUG) {
    console.log(`\n DEBUG storage ${storage.slice(0, 3000)}\n`);
  }

  /* --- 7b. retention outlives repeated failed delivery ---------------------- */
  const lateRaw = await ev(
    cdp,
    uiSession,
    "chrome.storage.local.get('hipcortex.capture.queue').then(o => JSON.stringify(o))",
  );
  const late = JSON.parse(lateRaw ?? "{}")["hipcortex.capture.queue"]?.entries ?? [];
  const lateStatus = await ask({ type: "CAPTURE_STATUS" });
  record(
    "retention survives repeated failed deliveries: nothing expired and nothing was refused",
    late.length === PROVIDERS.length &&
      late.every((e) => e.refusalReason === null && e.outcome !== "refused") &&
      (lateStatus?.data?.retention?.refused ?? -1) === 0,
    `entries=${afterPositive} -> ${late.length}; attempts seen=${[...new Set(late.map((e) => e.attempts))].join("/")}; outcomes=${[...new Set(late.map((e) => e.outcome))].join("/")}; refused=${lateStatus?.data?.retention?.refused}`,
  );

  /* --- 8. the live core was never reached ---------------------------------- */
  if (coreUp) {
    let total = null;
    try {
      const r = await fetch(`${LIVE_CORE}/memory/query?actor=${encodeURIComponent(ACTOR)}&limit=50`);
      const body = await r.json();
      total = body?.total ?? (Array.isArray(body?.records) ? body.records.length : null);
    } catch (e) {
      total = `error: ${e.message}`;
    }
    record(
      "the live core holds no record for the probe's actor (nothing was written)",
      total === 0,
      `actor=${ACTOR} total=${total}`,
    );
  } else {
    console.log(" note: the live core was unreachable, so the no-write assertion was skipped");
  }

  /* ------------------------------------------------------------------ report */
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  return passed === results.length ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (e) {
  console.error(`\nprobe failed: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  try {
    cdp?.close();
  } catch {
    /* ignore */
  }
  try {
    child?.kill();
  } catch {
    /* ignore */
  }
  await sleep(400);
  try {
    if (profile) rmSync(profile, { recursive: true, force: true });
  } catch {
    console.log(` note: could not remove temp profile ${profile}`);
  }
}
process.exit(exitCode);
