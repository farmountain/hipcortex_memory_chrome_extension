## Context

The repository is a single MV3 extension compiled by `tsc` with **no bundler**: `src/*.ts`
emit ESM into `dist/`, and `scripts/copy-assets.js` copies `public/*` plus generates 1×1
placeholder icons. `public/manifest.json` loads `background.js` from the dist root.

Verified current state (commands actually run against this checkout):

| Fact | Evidence |
|------|----------|
| `node_modules/` absent | `Test-Path node_modules` → `False` |
| No tests | `vitest run` has no spec files; `package.json` `test` script exists but nothing matches |
| No lint config | no `eslint.config.*` or `.eslintrc*` in the repo; `eslint src --ext .ts` cannot work |
| `rootDir: "src"` | `tsconfig.json` |
| `clean` is POSIX-only | `rm -rf` raises `NamedParameterNotFound` under PowerShell 5.1 |
| `package` is POSIX-only | `cd dist && zip` needs a POSIX shell and `zip` |
| `content_scripts: []` | `public/manifest.json` |
| Grok/DeepSeek hosts missing | `optional_host_permissions` lists only chatgpt.com, claude.ai, gemini.google.com, chat.openai.com |
| Settings flags inert | `autoCapture` and `injectIntoAiChats` are read in `options.ts` and used nowhere |

The existing code that must be preserved: `HipCortexClient`'s resilient endpoint ladder
(4 add endpoints, 4 search endpoints, dual `/health`), the two-step "add a `MessageType` +
router `case`" pattern, and the split of durable settings in `chrome.storage.sync` versus
ephemeral handoff (`pendingSearch`) in `chrome.storage.session`.

## Goals / Non-Goals

**Goals:**
- Capture AI conversations from five providers without user action.
- One versioned, provider-agnostic contract between this repo and HipCortex core.
- Two transport modes over one codebase: Consumer (Native Messaging) and Developer (HTTP), with automatic fallback so the extension is never dead on arrival.
- Provider volatility contained to one file per provider.
- Every claim provable by a command: typecheck, lint, tests, build, manifest invariants.

**Non-Goals:**
- Any cognitive function: memory, goals, beliefs, world model, consolidation, causal reasoning.
- Injecting context back into AI chat composers — deferred to a follow-up change
  `capture-context-injection`; this change keeps `injectIntoAiChats` as an inert, default-off gate.
- Cloud sync, telemetry, or uploading captured conversations anywhere other than the local runtime.
- Firefox/Edge/Safari ports — the adapter/transport seams are designed to allow them, but not built here.
- Renaming the user-facing product away from "HipCortex".

## Decisions

### D1 — Contract lives at `src/schema/`, not a repo-root `schema/`

`tsconfig.json` sets `rootDir: "src"`, so a root-level `schema/` imported from `src/**` fails
with *"is not under rootDir"*. Widening `rootDir` moves `dist/` output to
`dist/src/background.js`, silently breaking `public/manifest.json`'s `background.js` path.
**Chosen:** `src/schema/` — zero config change, manifest untouched.
*Alternative rejected:* separate `schema/` package — correct eventually for a published
contract, but adds a workspace for one consumer.

### D2 — Add `esbuild`, scoped to content scripts only

MV3 content scripts are **classic scripts**: the manifest has no `type: "module"` for
`content_scripts`, and `tsc` emitting ESM cannot produce one. Options considered:

| Option | Verdict |
|--------|---------|
| Multiple non-module files listed in order sharing globals | Rejected — implicit load-order coupling, no type safety across files |
| `tsc` `outFile` with `module: "amd"`/`"system"` | Rejected — Chrome has no AMD/SystemJS loader |
| `chrome.scripting.executeScript({ func })` | Rejected — activeTab-gesture scoped, cannot run passively on page load |
| **`esbuild --bundle --format=iife` for `src/content/entry.ts` only** | **Chosen** |

`tsc` continues to compile `background.ts`, the UI controllers, `schema`, `capture` and `api`
as before. `esbuild` produces exactly one extra artifact, `dist/content.js`. This is a
deliberate, bounded exception to the repo's "no bundler" convention; the design intent is one
entry point, not a general bundling pipeline. `esbuild` is a **devDependency** — the shipped
extension still contains zero third-party runtime code.

### D3 — `Transport` interface replaces direct `fetch` call sites

```ts
interface SearchOptions { limit?: number; providerFilter?: string; actor?: string; recordType?: string }
interface Transport {
  readonly mode: "consumer" | "developer";
  health(): Promise<HealthStatus>;
  send(event: CaptureEvent): Promise<SendResult>;
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  queryStructured(options: SearchOptions & { action?: string }): Promise<SearchResult>;
  addMemory(record: MemoryRecord): Promise<MemoryRecord>;
}
```

`search` and `queryStructured` are separate because the runtime exposes them as separate
endpoints with different capabilities: `search` is semantic (`POST /memory/search`) and cannot
filter, while `queryStructured` is a filter (`GET /memory/query`). Collapsing them into one
signature is what produced the original defect, where a provider filter was promised on an
endpoint that accepts none. `providerFilter` is carried as a convenience and resolved by
`HttpTransport` to `action = capture:<providerId>` plus `record_type = Perception` on the
structured path; passing `providerFilter` to the semantic path is reported as a limitation, not
silently ignored.

`HttpTransport` is a near-verbatim move of today's `HipCortexClient` logic, including the
endpoint ladder and `AbortSignal.timeout` guards, so Developer Mode behavior is preserved and
the ported specs are a regression net — **except** where the ladder was verified dead. Probing
the live runtime showed that three of the four search branches do not exist and that the assumed
capture endpoint is absent entirely; D11 and D12 replace the dead branches with the verified
surface. `NativeTransport` uses
`chrome.runtime.connectNative("com.hipcortex.bridge")` with `sendNativeMessage`-style framing.

`connectNative` is unavailable in content scripts, so all transport use stays behind the
service-worker router — which the existing architecture already enforces.

**Fallback policy:** a `TransportFactory` resolves mode `auto` by attempting the native host
first and falling back to HTTP `127.0.0.1:3030` when the host is absent
(`chrome.runtime.lastError` set on connect). Fallback is recorded in state and surfaced in the
UI — never silent.

### D4 — `CaptureEvent` wraps `Conversation`; validation happens on egress

```
CaptureEvent { schemaVersion, eventId, capturedAt, provenance, conversation }
Provenance   { schemaVersion, provider, adapterVersion, source, conversationUrl, capturedAt }
Conversation { messages: Message[], attachments: Attachment[], title? }
Message      { role: "user"|"assistant"|"system", text, index }
```

`Provenance` is the single canonical list. `eventId` lives on `CaptureEvent`; `capturedAt`
appears on both because it is duplicated onto the reserved metadata object on egress (D14).
Any other mention of the provenance fields earlier in this document is superseded by this
block.

`validateCaptureEvent()` returns `{ valid, errors: { path, code }[] }` rather than throwing, so
callers can log field-level detail. The **pipeline** enforces the "reject before transport"
rule: `send()` is only reachable through a `valid === true` guard, and a spec asserts the
transport spy was never invoked for an invalid event. Returning errors instead of throwing
keeps one validation function usable in both the pipeline and the tests.

### D5 — Queue uses `chrome.alarms` and acknowledged delivery, not `setTimeout`

An MV3 service worker is terminated when idle, so a `setTimeout`-based retry dies with it.
**Chosen:** `chrome.alarms` (requires adding the `alarms` permission) with a minimum-period
drain, plus opportunistic drains on `onStartup`, on successful send, and on `onMessage`.

Storage: `chrome.storage.local` key `capture.queue` (never `sync` — `sync` has small quotas and
would leak conversation content across devices). Backoff `min(2000 * 2^attempts, 300000)` stored
as `nextAttemptAt` per entry so a terminated worker cannot lose the schedule.

**Superseded decision.** An earlier draft of this change bounded the queue at 500 entries with
drop-oldest on overflow. That silently destroys conversation content the user's browser observed
but the runtime never received, which contradicts the word *retain* in the product goal. **Chosen
instead:** an entry is removed only after the runtime acknowledges it, and reaching the spill
limit reports the condition rather than discarding. The boundary is also now explicit: cognition
and durable memory live in the core; the extension guarantees *acknowledged delivery*, not
retention. Rationale and falsification conditions are recorded in `docs/END-STATE.md` (G2).

### D6 — Adapters are siblings behind one registry

`ProviderAdapter` = `{ id, displayName, adapterVersion, verifiedAt, ladders, landmarks, matches(url), extract(input) }`.
`extract` returns a discriminated union: `{ ok: true, conversation, rungs }` or
`{ ok: false, error: { code: "EMPTY_CONVERSATION" | "NO_ROLE_SIGNAL" | "UNSUPPORTED_LAYOUT" | "DOM_SHAPE_UNRECOGNIZED" } }`.
`ladders` is the ordered candidate list per slot and `rungs` records which candidate satisfied
each slot when extraction succeeds. Adapters never import each other; the registry is the only
place that knows all providers, and adding one is a single line. The content entry point observes
DOM mutations with a debounce and re-runs `extract`, replacing the working conversation rather
than appending duplicates — the conversation is the unit of capture, not the message. See D15/D16
for why ladders, landmarks and `rungs` exist.

### D7 — Scan tests over conventional lint rules

Several invariants are project-shaped ("only `src/api/**` may call `fetch(`", "no provider
hostname outside `src/capture/**`", "no cognitive vocabulary in production code", "no
`<all_urls>`"). Implementing these as ESLint rules means writing custom plugins; implementing
them as a Vitest helper that reads `src/**` and asserts regex invariants is ~40 lines and
readable. **Chosen:** a `scanSource()` test helper for project invariants, with ESLint flat
config reserved for standard correctness rules.

### D8 — `dist/` stops being committed

`.gitignore` currently keeps `dist/` "for easy load-unpacked". A committed build output can
mask a broken build: the extension loads stale JavaScript that no gate produced. **Chosen:**
ignore `dist/` and make `npm run build` the single source of a loadable extension.
*Trade-off accepted:* contributors must build once before loading unpacked.

### D9 — Cross-platform scripts without new runtime deps

`scripts/clean.js` uses `fs.rmSync(dist, { recursive: true, force: true })`.
`scripts/package.js` detects the platform: `zip` on POSIX, PowerShell `Compress-Archive` on
Windows, failing with an actionable message if neither exists. Both are Node scripts, so they
behave identically regardless of the invoking shell.

### D10 — Testing seams

Vitest with two project environments: `node` for schema/transport/queue logic, and `jsdom` for
adapters (needs DOM parsing) reading redacted HTML fixtures from `tests/fixtures/<provider>/`.
`chrome.*` is mocked by `tests/helpers/chrome-mock.ts` exposing `storage.sync|local|session`,
`runtime.sendMessage|lastError|connectNative`, `alarms`, `contextMenus`, `action`. Transport
tests spy on `fetch`; the "reject before transport" spec asserts the spy was not called.

**Dev dependencies added:** `esbuild`, `jsdom`, `@types/chrome` (present), plus flat-config
ESLint packages. No runtime dependency is added.

## Risks / Trade-offs

- **Content scripts break on provider DOM changes** → adapter isolation (D6), a selector ladder
  per slot (D15) and a structural pre-check (D16), so drift surfaces as a typed `ExtractError`
  covered by tests rather than a silent wrong capture. Every adapter ships a degraded fixture per
  ladder rung plus one deliberately broken fixture that must fail. `adapterVersion` and
  `verifiedAt` are stamped into provenance so a core-side regression is traceable to one DOM
  assumption.
- **Native host absent on most machines** → `auto` mode falls back to HTTP and reports the mode
  in the UI; Consumer Mode is never a hard requirement for the extension to function.
- **Capture could store sensitive conversation content** → local-only storage by default, no
  telemetry, no non-loopback host pre-authorised in the manifest (D13), explicit confirmation
  before a non-loopback base URL can be saved, and `autoCapture` default-off.
- **esbuild widens the build surface** (D2) → scoped to one entry point and one artifact; every
  other file still goes through `tsc`, so type errors remain a hard gate.
- **A sustained outage grows the unacknowledged backlog without bound** → the queue never drops
  an entry (D5), so the risk is unbounded *growth*, not loss. Response: at the spill limit the
  pipeline pauses and reports the unacknowledged count and the paused state, never a silent
  discard. The user's remedy is to restore the runtime, not to accept data loss. Residual risk
  accepted: the UI can show a backlog that never drains if the runtime never returns.
- **`src/schema` is imported by both extension and (eventually) core** → the contract is
  versioned and validated on egress; a required-field addition is a breaking version bump, and
  `docs/PROTOCOL.md` records the version the core must accept.
- **Full passive capture on five providers is a large surface** → the five adapters are
  incrementally shippable; the pipeline, contract and gates are provider-independent and land
  first, so provider work is parallelizable and individually verifiable.

## Migration Plan

Order is dependency-driven; each step is independently verifiable.

1. **Harness first (blocking).** Vitest + one committed spec, ESLint flat config, scan-test
   helper, cross-platform `clean`/`package`, `dist/` un-committed. Gates green before any
   feature work — otherwise no later step can be proven.
2. **Positioning.** `README.md`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, manifest
   `description`. Docs only; no behavior change.
3. **Contract.** `src/schema/*` + validation spec. Nothing consumes it yet, so this is
   additive and safe.
4. **Transport.** Introduce `Transport`/`HttpTransport`/`NativeTransport` and port the existing
   client specs. Router migrates from `HipCortexClient.fromSettings()` to the factory; existing
   popup/sidepanel/context-menu/message behavior must remain byte-for-byte equivalent in
   Developer Mode (the ported specs are the proof).
5. **Adapter seam.** `ProviderAdapter`, registry, and one adapter (ChatGPT) with fixtures.
   Proves the seam end-to-end before the remaining four adapters exist.
6. **Pipeline.** Content entry point, content-script registration, queue, `alarms`, router
   capture messages. `autoCapture` becomes functional.
7. **Remaining providers.** Claude, Gemini, Grok, DeepSeek; each adds host permissions, an
   adapter, a ladder per slot, landmarks, fixtures and a spec.

**Rollback:** steps 1–4 are independently revertible (new files plus one router swap). Step 6
is the first step that can lose data, and its failure mode is bounded by acknowledged delivery:
an entry survives until the runtime acknowledges it (D5), and the worst case is a growing
unacknowledged backlog that is reported, not a silent discard. `autoCapture` remains default-off,
so a bad provider adapter cannot affect a user who has not enabled passive capture.

## Open Questions

1. **Native host name and message framing.** `com.hipcortex.bridge` is assumed. The exact
   request/response envelope must be confirmed against the HipCortex Desktop installer, which
   does not exist yet. Until then `NativeTransport` targets the assumed contract and is covered
   by mocked specs only — Consumer Mode cannot be verified end-to-end this change.
2. **Core-side endpoint for capture events — RESOLVED.** Probing the live runtime settled this:
   the assumed `POST /v1/capture/event` returns 404 and does not exist among its 123 documented
   paths. The only endpoint that accepts provenance metadata without destroying it is
   `POST /memory/add`. `POST /memory/ingest` accepts only `{actor, context, session_id, text}`,
   silently discards any `metadata` sent to it, replaces `action` and `record_type` with server
   defaults, and stamps `ttl_seconds: 86400` so the record self-deletes in 24 hours. **Decision:
   `HttpTransport.send()` targets `POST /memory/add` and `docs/PROTOCOL.md` pins the mapping; a
   gate asserts `/memory/ingest` appears nowhere in production sources.** Evidence is recorded in
   `docs/END-STATE.md` decisions E7–E9.
3. **Attachment representation.** Fixtures will only include attachments if a provider is
   observed to expose them. Otherwise `Attachment` ships as a defined-but-unpopulated shape,
   and the adapters report zero attachments.
4. **Semantic search with a provider filter.** `POST /memory/search` accepts only
   `{query, limit, embedding}` and has no filter field, so "find semantically similar messages
   from Gemini only" is not expressible against today's runtime. This is the single remaining
   cross-repo dependency, named `core: add filter to POST /memory/search`. Until it lands, the
   UI must present filtered retrieval as the structured path and must not imply the semantic
   path can be filtered.

## Decisions added after probing the live runtime

### D11 — Capture egress targets `POST /memory/add`

The endpoint ladder is replaced by the verified surface recorded in `docs/PROTOCOL.md`. An
earlier draft asserted *"the four add endpoints tried in order, the four search endpoints tried
in order"*; probing showed `GET /memory/search?q=` returns 405, `POST /search` returns 404, and
`GET /memory/query?query=` returns 405 because that route is GET-only and filters on `actor`,
`action`, `record_type`, `limit` and `as_of`. Keeping a ladder of non-existent endpoints is not
harmless: it converts a genuine misconfiguration into a retry that looks like progress.

### D12 — An acknowledgement is positive evidence, not a status code

`POST /memory/add` returns `{"success": true, "record_id": "<uuid>", "error": null}`.
Delivery is acknowledged only when the body parses to `success === true` **and** carries a
non-empty `record_id`. HTTP 200 alone is not acknowledgement, because the failure mode this
guards against (`/memory/ingest` returning 200 while discarding the payload) is exactly a
200-with-wrong-body. A non-empty `warning` array is the runtime's dedup advisory and does not
fail a delivery.

### D13 — The extension is not pre-authorised to leave the machine

The manifest previously declared `host_permissions: ["https://hipcortex.fly.dev/*"]` while
`apiUrl` was a freely editable setting. Editing one string in the options page would redirect
every captured conversation to a third party, and the extension was pre-authorised to do it.
**Chosen:** `host_permissions` contains loopback origins only; `auto`/`consumer` modes refuse a
non-loopback base URL; saving one requires a confirmation naming the host; and a persistent
banner shows while one is configured. Rationale and falsification condition in
`docs/END-STATE.md` (G7).

### D14 — `hipcortex.capture` is the reserved provenance key

Provenance travels on `metadata["hipcortex.capture"]` as a versioned object with discrete keys,
not as `target` text. This is a cross-repo contract: the core can index it and the extension can
assert it. `target` carries the transcript because that is the field the runtime indexes for
search. The key name is reserved — a second key or a renamed key is a defect.

### D15 — Every slot uses an ordered selector ladder

A single selector per slot means one provider markup change silently yields a wrong or empty
capture. Each slot declares ordered candidates; the first that resolves non-empty wins, and the
index used is recorded in `rungs`. `rungs` is what makes drift diagnosable: a failure report can
name *which* rung stopped working, not merely that something broke.

### D16 — A structural pre-check and a cardinality check bracket extraction

Before reading messages, the adapter validates required landmarks; their absence yields
`DOM_SHAPE_UNRECOGNIZED` and no message is read. After reading, the number of observed turn
containers must equal the number of messages produced. Together these make the default failure
mode *a typed error* rather than a partially correct capture, which is the invariant G8.7 states:
a typed failure is always preferable to a wrong capture. Adapters resolve all of this from
compiled code only — no remote or stored configuration (G8.4), because a remote config is both a
bypass of the local-egress promise and a way for one server to break every provider at once.
