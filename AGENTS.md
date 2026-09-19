# HipCortex CortexBridge — Agent Guide

**This repo is the perception layer.** CortexBridge observes AI conversations from browser
surfaces, normalizes them into a versioned contract, and forwards them to the HipCortex
cognitive substrate. It does **not** reason — no memory, goals, beliefs, world model, or
consolidation logic belongs here.

> Users see the product as **HipCortex**. *CortexBridge* is the architectural name for this
> sensory/browser layer only. The HipCortex core (Rust/server/REST/MCP/CLI) lives in a
> **separate repository** — never import, vendor, or reach into it from this code.

See [README.md](./README.md) for the feature list and [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)
for the requirement graph and acceptance criteria.

**The verified network contract is [docs/PROTOCOL.md](./docs/PROTOCOL.md).** It records what was
actually executed against a live runtime — including the endpoints that exist but must never be
used. Never add a network call that document does not list. Do not resurrect an endpoint from
`design.md` history or from the old client's ladders.

The implementation plan is the change set under
[`openspec/changes/`](./openspec/changes/).
[`cortexbridge-perception-layer`](./openspec/changes/cortexbridge-perception-layer/) is the base; the
changes it deferred are `cortexbridge-retention-boundary`, `cross-provider-search-index`,
`clarity-protocol`, `substrate-migration`, `capture-context-injection` and `installable-product`.
Every task in a `tasks.md` names the `G#.#` acceptance criterion it discharges and the test that
proves it. A task without a criterion is not part of the plan.

**Scope decisions live in [docs/END-STATE.md](./docs/END-STATE.md)** — the end-state goals G1–G9,
their measurable acceptance criteria, the locked interpretations, and the non-goals with reasons.
If a task in this repo appears to conflict with that document, that document wins until it is
formally amended. The single most important statement in it: **the core retains; the extension
guarantees acknowledged delivery.** The extension is not the retention boundary, and that is not
permission to discard an unacknowledged capture.

## Architecture boundary

```
AI site UI (ChatGPT / Claude / Grok / Gemini / DeepSeek)
   │   content script + provider adapter   ← volatile DOM lives ONLY here
   ▼
Service worker (src/background.ts)         ← the only message router
   │   transport: Native Messaging (consumer) | HTTP localhost (developer)
   ▼
HipCortex core (separate repo)             ← memory, goals, beliefs, provenance
```

| Layer | Location | Hard rule |
|-------|----------|-----------|
| UI surfaces | `src/popup.ts`, `src/sidepanel.ts`, `src/options.ts` | Talk to the worker via `chrome.runtime.sendMessage` only |
| Shared UI | `src/ui/` | Presentational helpers only; no state and no transport |
| Router | `src/background.ts` | Single dispatcher for every `MessageType` variant |
| Transport | `src/api/transport/` | The `http.ts` / `native.ts` pair is the only code allowed to touch the network; `factory.ts` is the only way to obtain one; `acknowledge.ts` holds the one acknowledgement rule |
| Contract | `src/types/index.ts` + `src/schema/` | Versioned, provider-agnostic shapes. The contract lives under `src/` because `rootDir` is `src` |
| Providers | `src/capture/providers/*` | One adapter per site; DOM drift stops here |
| Queue | `src/capture/queue/*` | Removal is acknowledged-only; reaching the spill limit pauses and reports |
| Migration | `src/migration/*` | Reads a HipCortex export and writes it back one record at a time; no network code of its own |
| Injection | `src/inject/*` | The only tree that writes into a provider page, and it never submits |
| Search index | `src/index/*` | Local lexical fallback only; not a network surface |

## Commands

`node_modules/` is not committed, so **run `npm install` first** — every gate command below
fails with a module-not-found error on a fresh clone.

| Command | Status | Notes |
|---------|--------|-------|
| `npm install` | works | Required before any other command |
| `npm run build` | works | `tsc` → `dist/`, then `scripts/build-content.js` bundles the one content-script entry, then `scripts/copy-assets.js` copies `public/*` including `public/icons/` |
| `npm run watch` | partial | `tsc --watch` only — assets are **not** re-copied |
| `npm test` | works | `vitest run` across two projects (`node`, `jsdom`); 54 spec files / 832 tests, all passing on 2026-09-14. `passWithNoTests: false`, so a missing spec file fails the gate |
| `npm run lint` | works | Flat `eslint.config.js`, script is `eslint src tests`. `scripts/`, `docs/` and `public/` are outside the lint gate |
| `npm run typecheck` | works | `tsc --noEmit`, then `tsc -p tsconfig.test.json` so the `tests/**` tree is type-checked too |
| `npm run verify` | works | `typecheck && lint && test && build` — exactly these four, pinned by `tests/quality/gates.spec.ts`. Adding a fifth command fails that test |
| `npm run test:traceability` | works | `node scripts/traceability.js` — every criterion in `docs/END-STATE.md` must be cited inside `openspec/changes/*`, and every backticked `tests/...` path named there must exist |
| `npm run test:clarity` | works | `node scripts/clarity.js` — gates `docs/clarity-ledger.json`. Deliberately **not** folded into `verify`; see `docs/CLARITY.md` §6 for why |
| `npm run clean` | works | `node scripts/clean.js` — verified on Windows; the POSIX leg is unverified |
| `npm run package` | works | `npm run build && node scripts/package.js` — writes the zip in Node via `scripts/zip.js`, so there is no platform-specific leg left to distrust |
| `npm run install:host` | works | `node scripts/install-host.mjs` — registers the native messaging host for the current user; `npm run uninstall:host` reverses it. Deliberately **not** part of `verify`, because it writes to the real registry |

Load the extension: `npm run build` → `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

## Conventions that differ from typical setups

- **No bundler.** `tsc` emits ESM directly into `dist/`. Keep the `.js` suffix on relative
  imports (e.g. `import ... from "./types/index.js"`) to match the existing code.
- **`public/manifest.json` is the source of truth** for permissions and entry points. It
  loads `background.js` at the dist root — relocating `background.ts` into a subfolder
  silently breaks the manifest.
- **`tsconfig.json` sets `rootDir: "src"`.** Anything that must compile lives under `src/`.
  A repo-root `schema/` folder cannot be imported by `src/**` without `tsc` failing with
  "is not under rootDir", so the contract was placed at `src/schema/` rather than at the root.
  That decision is made and settled; do not re-litigate it, and do not widen `rootDir`.
- **New HTML/CSS must be added to the file list in `scripts/copy-assets.js`**, otherwise it
  never reaches `dist/` and the packaged extension is broken.
- **Storage is split by lifetime:** durable config in `chrome.storage.sync` (shape defined by
  `DEFAULT_SETTINGS`); ephemeral handoff such as `pendingSearch` in `chrome.storage.session`.
  Conversation content never enters `chrome.storage.sync`.
- **Never discard an unacknowledged capture.** A queue entry is removed only after the runtime
  acknowledges it — and acknowledgement is *positive*: `success: true` plus a non-empty
  `record_id`. A bare 2xx is a failure. Reaching a storage ceiling is reported as a paused state
  and an unacknowledged count; there is **no loss counter at all**, and no oldest-entry eviction.
  A bounded lossy buffer is transport buffering, not retention, and the two must not be described
  as each other.
- **Capture does not leave the machine unless the user says so.** No non-loopback host may be
  declared in `host_permissions`. `auto` and `consumer` modes must refuse a non-loopback base
  URL, and a manually configured non-loopback URL requires a confirmation naming the host plus a
  persistent banner. Adding a remote host to the manifest is a G7 regression.
- **Provider DOM knowledge fails closed.** Every slot resolves through an ordered selector ladder
  after a structural landmark pre-check that returns `DOM_SHAPE_UNRECOGNIZED` **before any message
  text is read**. Observed turn count must equal produced message count. A typed failure is always
  preferable to a plausible wrong capture. Selectors and ladders are configured from code only —
  never fetched, never stored.
- **Adding a message** requires two edits: a `MessageType` union member in `src/types/index.ts`
  and a matching `case` in the background router.
- **Icons are committed artwork in `public/icons/`**, copied to `dist/icons/` like every other asset —
  not generated by the build. A build-time generator used to write one 1×1 transparent PNG to all four
  filenames, which satisfied the manifest's path check and would have been rejected by the store, so
  `tests/quality/manifest.spec.ts` now decodes each PNG and asserts its declared dimensions. These are
  still placeholders — replace the four files with real artwork; do not reintroduce a generator.
- **The store zip is written by `scripts/zip.js`**, not by an external packer. `Compress-Archive` on
  Windows PowerShell 5.1 emits `\`-separated entry names, which the ZIP specification forbids and
  which shipped in the `v0.1.0` release asset, so the writer is in-repo and `tests/quality/zip.spec.ts`
  pins the `/` separator, the root `manifest.json` and the recoverable contents.
- **The submission package is `docs/STORE.md`.** Chrome's agent guidance asks for a
  `CHROMEWEBSTORE.md` at the repository root; here that file is a pointer to `docs/STORE.md` and
  nothing else. The convention is satisfied by the information being tracked in the repository,
  which it already is and in more detail than the convention asks for. The pointer holds no version,
  size, hash, character count or paste-ready box, because a second copy of a manifest fact is a
  second thing to drift and the gate reads only `docs/STORE.md`. Edit the real document, then run
  `npx vitest run tests/quality`; `tests/quality/store.spec.ts` fails if the pointer stops being one.
- **`dist/` is not tracked** (see `.gitignore`, decision D8). A stale `dist/` used to be able to mask
  a broken build, so `git ls-files dist` returns nothing; run `npm run build` before claiming any
  change works.
- **MV3 service worker has no DOM** and can be terminated at any moment — keep no in-memory
  state that must survive an event.

## Working agreement (ReAct)

0. **Clarify** — resolve the question from the artifacts before asking anyone. Read the code, spec,
   `docs/PROTOCOL.md`, `docs/END-STATE.md`; run the command or the probe; inspect the environment;
   self-prompt a hypothesis and try to falsify it. Escalate only when the question is critical *and*
   the artifacts cannot reach it. Both loops are bounded: 5 self-prompt attempts, 1 escalation round,
   no re-open without new evidence. Record every question in `docs/clarity-ledger.json` — a question
   left open needs an exit condition naming what closes it. See `docs/CLARITY.md`; the gate is
   `npm run test:clarity`.
1. **Reason** — express the goal as one acceptance-criterion ID (see the alignment plan
   `/cortexbridge-align`), never as a vague task.
2. **Act** — make the smallest change that satisfies that one criterion.
3. **Observe** — run the real command (`npm run build`, `npm test`, load unpacked) and read
   the output.
4. **Evidence before claims** — never report "done", "fixed", or "passing" without command
   output. If a command fails, say so and paste the failure.
5. **No deferred verification** — if a criterion has no test, write the test in the same
   iteration you implement it.

## Related customizations

- `docs/END-STATE.md` — authoritative end-state goals, measurable acceptance criteria, locked
  interpretations, non-goals, and open risks. Scope questions are answered here.
- `docs/CLARITY.md` — how a question is resolved and how asking stops: the resolution order
  (artifacts before people), the four question states, the exit conditions, and the six lifecycle
  stages that must each record an entry. `docs/clarity-ledger.json` is the ledger;
  `npm run test:clarity` is the gate; `openspec/changes/clarity-protocol/` holds its criteria.
- `CHROMEWEBSTORE.md` — the root pointer that Chrome's agent guidance looks for. Names
  `docs/STORE.md` as the owner of the submission package and deliberately carries no copy of it.
- Chrome's guidance for coding agents on extensions ("Build extensions with coding agents") has
  three parts. The `CHROMEWEBSTORE.md` convention is the one that touches this repository, and it is
  satisfied by the pointer above. The other two are environment setup, not repository content: the
  Modern Web Guidance skills pack (`npx modern-web-guidance@latest install --choose`, an interactive
  wizard the user runs) and the Chrome DevTools MCP server, which exposes extension tools only when
  the `--categoryExtensions` option is set. Enabling that option is what would let an agent load the
  unpacked build and exercise the gesture the browser harnesses cannot reach — see the "Known
  limitations" section of `README.md` — but the option also carries a `--autoConnect` recommendation
  that attaches an agent to a real signed-in Chrome profile, so it is the user's decision and not
  something a repository should turn on.
- `docs/ARCHITECTURE.md` — the capture → normalize → forward → queue flow, the layer table with its
  hard rules, and the explicit non-goals. Read it before adding a layer.
- `docs/RETENTION.md` — what "retention" means for the queue (a pause with a count, never an
  expiry), the states an entry can be in, and the user's exit.
- `docs/REQUIREMENTS.md` — the index: which document owns what, and where each requirement area is
  proved. It is deliberately not a second specification.
- `.github/prompts/cortexbridge-align.prompt.md` — the ReAct plan: problem statements,
  objectives, target end state, and the measurable acceptance-criteria table.
- `.github/instructions/mv3-extension.instructions.md` — MV3 mechanics, worker, messaging, permissions.
- `.github/instructions/capture-perception.instructions.md` — the perception-only boundary and probe protocol.
- `.github/skills/capture-probe/SKILL.md` — how to discover and validate a provider's DOM/session surface.
- `.github/skills/add-capture-provider/SKILL.md` — the end-to-end workflow for adding a new AI provider.
