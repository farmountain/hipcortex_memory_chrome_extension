# HipCortex CortexBridge — Chrome Extension

**Captures your browser AI conversations into a local HipCortex substrate.**

This repository is the **perception layer** only. It captures from browser AI surfaces
(ChatGPT, Claude, Grok, Gemini, DeepSeek) and forwards normalized events to a local HipCortex
runtime, which owns all memory and reasoning. It does not retain or reason over cognitive state
itself, and it never discards an unacknowledged capture.

The retention boundary, the end-state goals, and their measurable acceptance criteria are
specified in [docs/END-STATE.md](./docs/END-STATE.md). Read that before changing behavior here.
The **verified** network contract — every endpoint that was actually executed against a live
runtime, including the ones that must never be used — is in [docs/PROTOCOL.md](./docs/PROTOCOL.md).
Do not add a network call that document does not list.

The implementation plan is the change set under
[`openspec/changes/`](./openspec/changes/).
[`cortexbridge-perception-layer`](./openspec/changes/cortexbridge-perception-layer/) is the base
change; `cortexbridge-retention-boundary`, `cross-provider-search-index`, `clarity-protocol`,
`substrate-migration`, `capture-context-injection` and `installable-product` discharge what it
deferred. Every task in a `tasks.md` names the `G#.#` acceptance criterion it discharges and the
test that proves it.

It is built so that every claim about it is provable by a command: see [Development](#development).

## Versions

| Component | Version | Declared in |
|-----------|---------|-------------|
| This extension | `0.1.0` | `package.json`, `public/manifest.json` |
| HipCortex core it was measured against | `3.11.0` | every observation in [docs/PROTOCOL.md](./docs/PROTOCOL.md) |

Those two numbers are deliberately independent, and the reason is worth stating because it looks
like drift otherwise. The extension **pins no core version**. It reads the runtime's version from
`GET /health` and reports it on the popup's health indicator; it does not gate on it, refuse a
capture because of it, or carry a copy of it (G7 — a pre-authorised remote host is the thing this
repository refuses, and a version allowlist is a different mechanism with the same failure mode:
the extension deciding, from a stale constant, that the user's own core is unacceptable).

So a core later than `3.11.0` is not refused — it is *unmeasured*. Every claim in
[docs/PROTOCOL.md](./docs/PROTOCOL.md) about what the runtime answers is a dated observation of
`3.11.0`, and re-running the probes against a newer core is a task, not an assumption.

## Install

**From source.** `npm install`, `npm run build`, then `chrome://extensions` → Developer mode →
Load unpacked → select `dist/`. This is the only install path that works today.

> **Chrome Web Store — not yet listed.** The submission archive is built and attached to the
> [`v0.1.0` release](https://github.com/farmountain/hipcortex_memory_chrome_extension/releases/tag/v0.1.0)
> as `hipcortex-chrome-extension-v0.1.0.zip`. The listing's short description is the manifest's
> `description`, and it reads:
>
> > **Stop losing your AI conversations.** Capture ChatGPT, Claude, Grok, Gemini and DeepSeek into a
> > memory you own, on your own machine.
>
> That is 129 characters against the store's 132-character limit, and it is the field the dashboard
> makes read-only after the first upload — so it was settled before submission rather than after.
> The full listing copy is in [docs/STORE.md](./docs/STORE.md) §3.
>
> Uploading the archive is a manual step a maintainer performs; until
> that happens there is no listing to install from, and this section will not pretend otherwise.
> The ID the local build uses is **not** the ID the listing will carry: the store assigns its own item
> ID and refuses the `key` field that pins the local one. §11 of that document is the step that
> reconciles the two, and skipping it breaks the native host for store-installed users.
>
> Everything the submission form asks for — the archive, the paste-ready listing copy, the
> per-permission justifications, the reviewer instructions, and an explicit list of what is still
> missing — is in [docs/STORE.md](./docs/STORE.md). The privacy policy is
> [docs/PRIVACY.md](./docs/PRIVACY.md).

**Loaded from source, the extension ID is `eklnpdcephecmddelagbablmeajoogkf`**, because
`public/manifest.json` pins a `key`. That is the ID of the unpacked build; the published item gets its
own ID, assigned by the store, which refuses a package containing the `key` at all — see
[docs/STORE.md §11](./docs/STORE.md). On first run the extension reports which of the two transport
modes it is in and what that mode needs.

The account that will publish it is the Chrome Web Store publisher
`742d17eb-82ee-46a9-9f3d-5cf0eee38065`. A publisher ID is account-level — it identifies the
developer account that owns the item, not the item — so it has no manifest field, appears nowhere in
the package, and is not the extension ID above. Google support asks for it; nothing in this
repository consumes it.

Either way, Consumer Mode needs the native messaging host registered before capture can reach
desktop. The extension cannot do that itself — no extension API can write a registry key — so it
reports *host not installed* and names the command that fixes it. See [Development](#development).

## The boundary

The single statement that settles most design questions here:

> **The core retains; the extension guarantees acknowledged delivery.**

The extension is not the retention boundary — and that is *not* permission to discard an
unacknowledged capture. A queue entry is removed only on positive acknowledgement from the
runtime (see [docs/PROTOCOL.md](./docs/PROTOCOL.md) §5). There is no loss counter, because there
is no path that loses anything.

What that rules out from this repository, permanently:

- No consolidation, belief formation, goal tracking, causal lineage, embeddings or retention
  policy — those are the core's surfaces, reachable at most as pass-through UI.
- No remote host pre-authorised in the manifest, and no non-loopback base URL that can be saved
  without a confirmation naming the exact host.
- No typed failure replaced by a plausible wrong capture.
- No conversation content in `chrome.storage.sync`.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the flow and the layer rules.

## Features (MVP)

- **Popup**: health indicator, quick-add memory, search
- **Side Panel**: richer search + capture (Ctrl/Cmd+Shift+H)
- **Context Menu**: “Add selection / page to HipCortex”, “Search selection”
- **Keyboard**: Ctrl/Cmd+Shift+M = quick-add current selection
- **Options page**: base URL, API key, default actor, transport mode, feature flags
- **Migration**: import a HipCortex export into the configured core — one record at a time through
  `POST /memory/add`, never `POST /memory/bulk`, because bulk is measured losing `tags`, `source` and
  `priority` while still reporting `failed: 0` — and resolve an id from before the import through the
  recorded remap
- **Transport**: Native Messaging (Consumer Mode) or verified localhost HTTP (Developer Mode)
- **Local-first**: default base URL `http://127.0.0.1:3030`; no non-loopback host is pre-authorised
  in `host_permissions`

## The two transport modes

| Mode | Transport | Requires |
|------|-----------|----------|
| **Consumer** *(default)* | Native Messaging to the host `com.hipcortex.bridge` | The HipCortex Desktop app, which registers the host |
| **Developer** | HTTP to a loopback base URL | A HipCortex server you started on `http://127.0.0.1:3030` |
| **`auto`** | Consumer first, Developer as fallback | Either one |

Explicitly choosing `consumer` or `developer` means exactly that mode: `consumer` does **not**
silently fall back to HTTP, so picking it is a statement about where your captures are allowed to
go, not a preference. `apiUrl` is refused in `auto` and `consumer` modes if it is not loopback,
and the refusal names the host.

## Prerequisites

- Chrome / Chromium / Edge (Manifest V3).
- **Consumer Mode**: the HipCortex Desktop app, which registers the native messaging host
  `com.hipcortex.bridge`. Nothing else — no separate server setup and no additional runtime.
- **Developer Mode**: a HipCortex server reachable on `http://127.0.0.1:3030`.

## Capture status

The popup reports passive capture on/off, queue length, the **unacknowledged count** and whether
the queue is **paused** at its spill limit. A non-zero unacknowledged count is a normal transient
state, not an error; a paused queue is a user-visible message naming the count, because the fix is
to bring the runtime back rather than to wait.

## Development

`npm install` is required first: `node_modules/` is not committed.

```bash
npm install
npm run build          # tsc → dist/, then copies public/ assets including the icons
npm run watch          # tsc --watch (does not re-copy assets)
npx tsc --noEmit       # typecheck only
npm run lint           # ESLint flat config over src/ and tests/
npm test               # Vitest: a node project and a jsdom project
npm run clean          # removes dist/
npm run package        # builds, then zips dist/ into hipcortex-chrome-extension-v<version>.zip
npm run install:host   # registers the native messaging host for this user (no elevation)
npm run uninstall:host # removes it again, per user
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

Consumer Mode needs one more step, because a browser extension cannot install a native program
itself — no extension API can write a registry key, and `permissions` in `public/manifest.json`
contains neither `downloads` nor `management`, deliberately. Run `npm run install:host` after `npm run
build` and reload the extension. `uninstall:host` reverses it; neither command needs administrator
rights. Without it the extension reports *host not installed* and names that command, rather than
telling you to check that something you have never installed is running. To check the install
actually took, run `node scripts/probe-installed-host.mjs`: it reads the registration back, spawns
the installed program the way Chrome does, and sends a side-effect-free health frame — it writes
nothing to your memory store.

An unpacked extension's ID is otherwise derived from its path, so it cannot be known before the first
load, which would make it impossible to register the host before loading the extension — the order the
install instructions above depend on. `public/manifest.json` therefore pins a `key`, and the ID of the
unpacked build is **`eklnpdcephecmddelagbablmeajoogkf`**. Because it is pinned,
`chrome://extensions` shows the same ID wherever the folder lives and across reloads, and the host's
`allowed_origins` is a value this repository determines rather than one it discovers.

That key must **not** be in the archive uploaded to the store, which rejects the whole package for
carrying it, and the store assigns the published item its own ID. The two are reconciled by replacing
the `key` with the store's public key after the first upload, which makes the unpacked build answer to
the store item's ID and keeps `allowed_origins` correct for store-installed users. The procedure, and
what breaks if it is skipped, is [docs/STORE.md §11](./docs/STORE.md).

`dist/` is built output and is **not** committed. Committing it used to let a stale build mask a
broken one, so `npm run build` before claiming a change works is a rule, not a suggestion.

### Known limitations

- `npm run clean` and `npm run package` are cross-platform scripts, but only the Windows legs have
  been executed. The POSIX legs are unverified and must not be reported as passing until a POSIX
  machine or CI runs them.
- Consumer Mode is **installed and answering on this machine, browser leg unrun**. The native
  messaging host ships from this repository (`host/bridge-host.mjs`) and `npm run install:host`
  registers it; the framing, the envelope, the health probe and the per-user registration are
  executed by specs, and the registered host has been spawned and answered a health frame against a
  live core. What no spec here can run is **Chrome itself** resolving a registered host and handing
  the port to a loaded extension — that needs a real browser with the extension loaded. Nothing has
  been run against a HipCortex Desktop app either; this host is this repository's own. See
  [docs/PROTOCOL.md](./docs/PROTOCOL.md) §9.
- Provider fixtures are structurally faithful but synthetic. They make the selector ladders
  regression-proof; they are not evidence that a rung matches today's live DOM.
- Every claim about a **rendered browser surface is unrun**. The specs boot the shipped HTML and the
  shipped controller under jsdom, which proves what the page sends and renders, not that Chrome
  paints it: the popup's online/offline indicator, the manual add, the context-menu capture, the side
  panel via Ctrl/Cmd+Shift+H, the options **Save** plus test connection, a live capture with
  `autoCapture` on, and a real cross-provider context injection all need an unpacked load of `dist/`.
- The migration's machine leg is executed and recorded — one capture read back by REST export, the
  `hipcortex backup` CLI and MCP `search_memory`, with the same messages in the same order — but the
  capture was produced by this repository's own egress code under Node, not by a real provider tab.
  That half is the same manual gate as above.

## Architecture Notes

- **Service worker** (`background.ts`) is the single message router and context-menu host.
- **Transport** (`src/api/transport/*`) is the only place allowed to touch the network. Capture
  egress is `POST /memory/add`; the lossy `POST /memory/ingest` is forbidden — see
  [docs/PROTOCOL.md](./docs/PROTOCOL.md) §3.1 for the evidence, which includes a 24-hour TTL that
  would delete the capture.
- **Providers** (`src/capture/providers/*`) hold all volatile DOM knowledge. Provider hostnames,
  selectors and ladders must not appear outside `src/capture/**`, and no selector or landmark is
  ever fetched from the network or read from `chrome.storage`.
- **Contract** (`src/schema/*`) is the versioned, provider-agnostic capture shape. It lives under
  `src/` rather than at the repository root because of `rootDir` — see
  [docs/PROTOCOL.md](./docs/PROTOCOL.md) §10.1.
- All UI surfaces talk only via `chrome.runtime.sendMessage`.
- Settings live in `chrome.storage.sync`; conversation content never does. Ephemeral handoff such
  as `pendingSearch` uses `chrome.storage.session`.

## Status

The feature list above describes the end state. What is actually implemented and verified today
is recorded per criterion in [docs/END-STATE.md](./docs/END-STATE.md) §Live verification. Anything
not listed there as executed is not yet done.

## Roadmap

The roadmap is the task list in the active OpenSpec change, not a separate document:

- [`openspec/changes/cortexbridge-perception-layer/tasks.md`](./openspec/changes/cortexbridge-perception-layer/tasks.md)
  — groups 1–10 deliver the perception layer.
- Group 11 of that file records the follow-up changes: `cortexbridge-retention-boundary`,
  `cross-provider-search-index`, `substrate-migration`, `capture-context-injection`, and the
  cross-repo dependency `core: add filter to POST /memory/search`.
- `cortexbridge-retention-boundary`, `cross-provider-search-index`, `clarity-protocol` and
  `substrate-migration` are fully ticked with their command output recorded. Three boxes stay unticked
  on purpose because they need a person at a browser or a real provider page, not because the work is
  missing: `cortexbridge-perception-layer` 8.12 and 8.13, and `capture-context-injection` 4.3. The
  fourth, `installable-product` 5.4, is a standing constraint rather than work — it is the instruction
  never to add a non-loopback host to `host_permissions`, and ticking it would turn a rule into a
  dated claim that someone checked it.
- [`openspec/changes/installable-product/tasks.md`](./openspec/changes/installable-product/tasks.md)
  — the native host and the per-user installer that make Consumer Mode installable, and the health
  surface that names which state the user is actually in (G9).

## License

Apache-2.0 (aligned with HipCortex core)
