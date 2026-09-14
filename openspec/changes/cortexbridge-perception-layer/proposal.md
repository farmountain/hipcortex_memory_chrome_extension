## Why

This repository is currently a thin CRUD client: a user must install and start HipCortex
separately, discover `127.0.0.1:3030`, and then manually paste text into a popup. No AI
conversation is captured, there is no contract between extension and core, and the repository
cannot prove any claim it makes — `npm test` finds no test files and `npm run lint` has no
config. The product story ("your AI conversations become persistent memory") is not
implemented, and no gate exists to prevent regressions.

This change realigns the repository as **CortexBridge**, the perception layer of a
single-install HipCortex product: capture from browser AI surfaces, normalize into a versioned
contract, forward over a dual transport, and prove all of it with enforced gates.

## What Changes

- **Reposition the repo as a perception layer.** Documentation, manifest metadata and code
  structure state the boundary: CortexBridge perceives, HipCortex core remembers and reasons.
  No cognitive logic (memory, goals, beliefs, world model, consolidation) lives here.
- **Make the harness real (blocking).** Add a Vitest setup with a committed spec, an ESLint
  flat config, and a source-scanning test helper, so `npm test`, `npm run lint` and
  `npx tsc --noEmit` become genuine gates instead of failing commands.
- **Introduce a versioned capture contract.** `CaptureEvent`, `Conversation`, `Message`,
  `Attachment`, `Provenance` plus `SCHEMA_VERSION` and a `validateCaptureEvent()` that returns
  field-level errors. Invalid events are rejected **before** any transport call, and the stored
  diagnostic carries no conversation content.
- **Introduce a transport abstraction with two modes.** A `Transport` interface with
  `HttpTransport` (Developer Mode) and `NativeTransport` (Consumer Mode — Native Messaging to a
  local runtime), with automatic fallback in `auto` mode and a user-visible mode/status. The
  HTTP surface is **not** today's endpoint ladders: it is the set verified against a live
  runtime and recorded in `docs/PROTOCOL.md`, where capture egress is `POST /memory/add` and the
  lossy `POST /memory/ingest` is forbidden. A delivery counts as acknowledged only on
  `success: true` **plus** a non-empty `record_id`. **BREAKING** for the internal
  `HipCortexClient` surface: callers migrate from `HipCortexClient.fromSettings()` to a
  `Transport` obtained from a transport factory.
- **Add retrieval through the two mechanisms the runtime actually has.** Semantic search
  (`POST /memory/search`, returning `{score, record}` pairs that must be unwrapped) and
  structured filtering (`GET /memory/query`, which already filters on `actor`, `action` and
  `record_type`). Provider filtering is `action = capture:<providerId>` combined with
  `record_type = Perception`, so no core change is required for G3.
- **Add passive capture with provider adapters.** Content scripts plus one adapter per provider
  (ChatGPT, Claude, Grok, Gemini, DeepSeek) behind a `ProviderAdapter` contract and a single
  registry. Each adapter resolves every slot through an **ordered selector ladder** after a
  structural pre-check, records which rung was used, and checks the produced message count
  against the observed page. Provider hostnames, selectors and ladders must not appear outside
  `src/capture/**`, and extraction configuration comes from code only — never from the network
  or from storage.
- **Add a durable outbound queue that never silently loses a capture.** Failed forwards persist
  to `chrome.storage.local` and are removed **only after the runtime acknowledges them**.
  Backoff is `min(2000 * 2^attempts, 300000)`. At the spill limit the queue reports a paused
  state and the unacknowledged backlog; it does not drop the oldest entry, and no loss counter
  exists at all.
- **Keep capture on the machine unless the user says otherwise.** No non-loopback host is
  pre-authorised in the manifest, `auto`/`consumer` refuse a non-loopback base URL, and a
  non-loopback URL requires a confirmation naming the host plus a persistent banner.
- **Wire the existing settings flags to real behavior.** `autoCapture` enables the pipeline and
  `injectIntoAiChats` gates context injection; both currently exist in the UI and do nothing.
- **Add release gates.** Manifest/permission invariants (least privilege, no `<all_urls>`, no
  remote code) become automated specs, and the Windows-incompatible `clean`/`package` scripts
  are replaced with cross-platform equivalents.

## Capabilities

### New Capabilities
- `capture-contract`: versioned conversation/event schema, provenance requirements, and egress validation semantics
- `capture-providers`: provider adapter contract, registry, per-provider matching and extraction with typed failures
- `capture-pipeline`: passive capture lifecycle, content-script orchestration, and the durable bounded outbound queue
- `transport-layer`: transport abstraction, Developer Mode HTTP behavior preservation, Consumer Mode native messaging, mode selection and fallback
- `extension-surfaces`: popup/sidepanel/options behavior including mode status, capture feedback, and injection gating
- `quality-gates`: build/typecheck/lint/test gates, source-scan invariants, manifest and permission constraints, cross-platform scripts

### Modified Capabilities
<!-- No existing specs in openspec/specs/ — this is the first change in the repository. -->

## Impact

**Code:** `src/background.ts` (router grows capture + status messages), `src/api/client.ts`
(replaced by `src/api/transport/*`), `src/types/index.ts` (extended, message union grows),
`src/popup.ts`, `src/sidepanel.ts`, `src/options.ts` (mode selection and capture UI), plus new
`src/capture/**`, `src/schema/**` and `tests/**` trees.

**Manifest:** `public/manifest.json` gains `content_scripts` entries, the `nativeMessaging` and
`alarms` permissions, and `optional_host_permissions` for Grok and DeepSeek. `host_permissions`
**narrows** to the loopback endpoints only — the currently committed non-loopback entry is
removed, because it is a standing pre-authorisation for capture to leave the machine.

**Every task in `tasks.md` names the `G#.#` acceptance criterion it discharges and the test path
that proves it.** Criteria live in `docs/END-STATE.md`; the network contract they encode lives in
`docs/PROTOCOL.md`. A traceability check fails the build when the two drift apart.

**Build:** `package.json` scripts for `clean`/`package` become cross-platform; new ESLint flat
config; Vitest config; `tsconfig.json` `rootDir` decision recorded in `docs/PROTOCOL.md`.

**Docs:** `README.md` repositioned to the dual-mode product story; `docs/REQUIREMENTS.md`
rewritten to the acceptance criteria; new `docs/PROTOCOL.md` (contract + core endpoint intent)
and `docs/ARCHITECTURE.md` (perception/cognition boundary).

**Dependencies:** adds `eslint` flat-config packages and keeps `vitest`. No runtime
dependencies are added — the extension ships zero third-party runtime code.

**Out of scope / not impacted:** HipCortex core (separate repository), cloud sync, telemetry,
any remote upload of captured conversations, and the user-facing "HipCortex" product name.
