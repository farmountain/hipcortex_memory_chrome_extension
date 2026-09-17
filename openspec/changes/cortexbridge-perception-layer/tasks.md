# Tasks �?CortexBridge Perception Layer

Verification convention: every task is "done" only when its verification command has been run
and its output recorded. `npm test` at group boundaries runs the full suite; `npx tsc --noEmit`
and `npm run lint` are re-run at the end of every group. `npm install` is a prerequisite for
all commands in this plan.

**Every task names the acceptance criteria it discharges** (`G#.#`, defined in
`docs/END-STATE.md`) **and the test path that proves it.** A task without a criterion is not part
of this change; a criterion cited here that does not exist in `docs/END-STATE.md` fails task 9.14.

**Ground truth for anything network-shaped is `docs/PROTOCOL.md`**, which records what was
actually executed against a live runtime. Do not reintroduce an endpoint that document does not
list.

## 1. Harness and gates (blocking �?nothing after this may be claimed until green)

- [x] 1.1 Run `npm install` and confirm `node_modules/` exists; record the exit code
- [x] 1.2 Add a Vitest configuration with a `node` project and a `jsdom` project, and set `passWithNoTests: false` �?*G6.3*, `tests/harness.spec.ts`
- [x] 1.3 Add a first committed spec asserting the test environment boots; verify `npm test` exits 0 with �? passing test �?*G6.3*, `tests/harness.spec.ts`
- [x] 1.4 Add an ESLint flat config covering TypeScript sources with type-aware parsing disabled for speed; verify `npm run lint` exits 0
- [x] 1.5 Update the `lint` script to reference the flat config and lint `src` plus `tests`
- [x] 1.6 Implement the `scanSource()` test helper that enumerates every file under `src/` and returns `{ path, content }` entries �?*G6.5*, `tests/helpers/scan.ts`
- [x] 1.7 Add a spec proving `scanSource()` covers the full `src/` tree and that violations report file path plus matched text �?*G6.5*, `tests/quality/source-scans.spec.ts`
- [x] 1.8 Add `scripts/clean.js` using `fs.rmSync(dist, { recursive: true, force: true })`; point the `clean` script at it
- [x] 1.9 Verify `npm run clean` exits 0 under PowerShell and is idempotent when run twice �?*G6.6*; record that the POSIX leg is unverified in this environment
- [x] 1.10 Add `scripts/package.js` that uses `zip` on POSIX and PowerShell `Compress-Archive` on Windows, failing with a message naming the missing tool; point the `package` script at it
- [x] 1.11 Add `dist/` to `.gitignore` and untrack the committed build output (`git rm -r --cached dist`)
- [x] 1.12 Add a `tests/helpers/chrome-mock.ts` exposing `storage.sync|local|session`, `runtime.sendMessage|lastError|connectNative`, `alarms`, `contextMenus`, `action`, and `sidePanel`
- [x] 1.13 Add a `tests/helpers/fixtures.ts` that reads HTML fixtures from `tests/fixtures/<provider>/`
- [x] 1.14 Add `esbuild` and `jsdom` as devDependencies; confirm no runtime dependency was added to `dependencies`
- [x] 1.15 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`

## 2. Positioning and documentation

- [x] 2.1 Rewrite `README.md` around the perception/cognition boundary and the two modes; remove the "install HipCortex first" prerequisite for Consumer Mode
- [x] 2.2 Add `docs/ARCHITECTURE.md` describing CortexBridge as the sensory layer, with the capture �?normalize �?forward �?queue flow and an explicit non-goals list
- [x] 2.3 Complete `docs/PROTOCOL.md` �?it already pins the verified contract; add the native host name `com.hipcortex.bridge`, the `SCHEMA_VERSION`, and the native framing section as the *assumed* parts �?*G5.2*
- [x] 2.4 Record the `rootDir` decision (`src/schema/`, no config change) in `docs/PROTOCOL.md` with the rejected alternative
- [x] 2.5 Rewrite `docs/REQUIREMENTS.md` to reference the acceptance criteria in this change rather than duplicating them
- [x] 2.6 Update `public/manifest.json` `description` and `name`/`short_name` so the product surface reads "HipCortex" while the repo identity is CortexBridge
- [x] 2.7 Add a spec asserting README contains no `pip install` in its prerequisites section and names both modes
- [x] 2.8 Update `AGENTS.md` to point at `openspec/changes/cortexbridge-perception-layer/` as the active plan
- [x] 2.9 Cross-reference `docs/END-STATE.md` from `AGENTS.md` and `docs/ARCHITECTURE.md` so every scope decision has one authority, and confirm the README already points at it

## 3. Capture contract (`capture-contract`)

- [x] 3.1 Create `src/schema/version.ts` exporting `SCHEMA_VERSION = 1` as a literal type plus the supported-versions list
- [x] 3.2 Create `src/schema/conversation.ts` defining `Conversation`, `Message`, `Attachment` with the role union and contiguous `index`
- [x] 3.3 Create `src/schema/capture-event.ts` defining `CaptureEvent` and `Provenance`. **`Provenance` carries exactly** `schemaVersion`, `provider`, `adapterVersion`, `source`, `conversationUrl`, `capturedAt`; `eventId` lives on `CaptureEvent` �?*G3.1*, *G5.1*
- [x] 3.4 Create `src/schema/validate.ts` implementing `validateCaptureEvent()` returning `{ valid, errors: { path, code }[] }` with codes `REQUIRED`, `INVALID_TIMESTAMP`, `UNSUPPORTED_VERSION`, `EMPTY_CONVERSATION`
- [x] 3.5 Create `src/schema/index.ts` re-exporting the public contract surface
- [x] 3.6 Add a spec table covering �? valid and �? invalid events, asserting the exact `path` and `code` for each error
- [x] 3.7 Add a spec proving validation never throws for `null`, a string, and an object missing required sections
- [x] 3.8 Add a spec asserting a six-message conversation round-trips through JSON with roles, indices and order unchanged
- [x] 3.9 Add specs for `capturedAt`: ISO-8601 UTC with `Z` passes; local time and unparseable values fail with `INVALID_TIMESTAMP` �?*G3.1*, `tests/schema/validate.spec.ts`
- [x] 3.10 Define `RESERVED_PROVENANCE_KEY = "hipcortex.capture"` as a **module constant** plus the versioned object shape it holds, and add a spec asserting the outbound payload carries separate `schemaVersion`, `provider`, `adapterVersion`, `source`, `conversationUrl`, `eventId` and `capturedAt` entries under exactly that key �?*G3.1*, `tests/schema/egress.spec.ts`
- [x] 3.11 Add a spec asserting provider identity is never conveyed only as free text, that the reserved object carries its own `schemaVersion`, and that provenance round-trips through a provider-filtered retrieval �?*G3.1*, `tests/schema/egress.spec.ts`
- [x] 3.12 Create `src/schema/egress.ts` mapping a validated `CaptureEvent` onto the runtime's add fields (`actor`, `action = capture:<providerId>`, `record_type = Perception`, `source = cortexbridge`, `target`, `tags`, `metadata`), and add specs asserting the mapping and asserting **no** `ttl_seconds` key is emitted �?*G5.3*, `tests/schema/egress.spec.ts`
- [x] 3.13 Add a spec asserting a rejected event's stored diagnostic contains no message text, no `target` text and no event body �?*G2.10*, `tests/schema/validate.spec.ts`
- [x] 3.14 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test` �?*G6.1*

## 4. Transport layer (`transport-layer`)

- [x] 4.1 Create `src/api/transport/types.ts` defining `Transport`, `SearchOptions`, `SendResult` and `TransportMode` �?*G3.3*
- [x] 4.2 Create `src/api/transport/http.ts` by moving `HipCortexClient` logic behind the `Transport` interface, **replacing the historical endpoint ladders with the verified surface in `docs/PROTOCOL.md`** �?capture egress is `POST /memory/add` only �?*G5.3*, *G6.1*
- [x] 4.3 Port the client behavior into specs against the verified surface: 404 advancing where a ladder still exists, plain-`ok` and JSON `/health`, unreachable �?`{ healthy: false }`, auth headers applied �?*G6.1*, `tests/api/transport.spec.ts`
- [x] 4.4 Add specs asserting `POST /memory/add` is the capture target and that `/memory/ingest` is never referenced �?*G5.5*, `tests/api/transport.spec.ts`
- [x] 4.5 Implement the **positive acknowledgement rule**: a delivery is acknowledged only when the body parses to `success === true` and carries a non-empty `record_id`; add specs for the ack case, the bare-2xx-without-`record_id` failure case, and the non-empty `warning` case that must still succeed �?*G2.9*, *G5.3*, `tests/api/transport.spec.ts`
- [x] 4.6 Add a spec asserting `addMemory` rejects with the last failure when no endpoint works �?*G6.1*, `tests/api/transport.spec.ts`
- [x] 4.7 Create `src/api/transport/native.ts` implementing `NativeTransport` over `chrome.runtime.connectNative("com.hipcortex.bridge")`, reading `chrome.runtime.lastError` after each operation
- [x] 4.8 Add specs for `NativeTransport` using a mocked `connectNative`: success resolves, host-unavailable produces a typed unavailable result without throwing
- [x] 4.9 Create `src/api/transport/factory.ts` resolving `auto` (native first, HTTP fallback), `consumer` (native only, no silent fallback) and `developer` (HTTP only, no native attempt) �?*G7.3*
- [x] 4.10 Add specs for all three modes plus the two fallback rules and the "explicit consumer does not fall back" rule �?*G7.3*
- [x] 4.11 Refuse a non-loopback base URL in `auto` and `consumer` modes, reporting an error naming the host and performing no request �?*G7.3*, `tests/api/transport.spec.ts`
- [x] 4.12 Add `transportMode` to `ExtensionSettings` and `DEFAULT_SETTINGS` with default `"auto"` �?*G6.5*
- [x] 4.13 Migrate `src/background.ts` from `HipCortexClient.fromSettings()` to the transport factory; keep every existing message type behavior equivalent
- [x] 4.14 Add `nativeMessaging` and `alarms` to manifest `permissions` �?*G6.5* (nativeMessaging done; alarms deferred to 6.10 where chrome.alarms is introduced - see 9.4)
- [x] 4.15 Add a spec asserting no file under `src/` outside `src/api/` contains `fetch(` or `connectNative` �?*G6.5*, `tests/quality/source-scans.spec.ts`
- [x] 4.16 Split retrieval into `search(query, options?)` (semantic, `POST /memory/search`) and `queryStructured(options)` (`GET /memory/query`). Resolve `providerFilter` to `action = capture:<providerId>` **and** `record_type = Perception` on the structured path �?*G3.3*, *G3.4*
- [x] 4.17 Add specs for the structured path: filter transmission, exclusion of other providers, empty-but-successful result for an uncaptured provider, and a reported limitation when semantic search is combined with a provider filter �?*G3.4*, *G3.5*, *G3.6*, `tests/api/transport.spec.ts`
- [x] 4.18 **Unwrap `{score, record}`** on the semantic path: expose `record` with `score` as a discrete optional field, and raise a typed error when a member has no `record` member �?*G3.2*, `tests/api/transport.spec.ts`
- [x] 4.19 Add a source-scan spec asserting `GET /memory/search-flat` is not used by any provenance-aware read path �?*G3.8*, `tests/quality/source-scans.spec.ts`
- [x] 4.20 Add a spec asserting returned records expose provider provenance as a discrete field �?*G3.1*, `tests/api/transport.spec.ts`
- [x] 4.21 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` �?*G6.1*

## 5. Provider adapter seam (`capture-providers`)

- [x] 5.1 Create `src/capture/providers/types.ts` defining `ProviderAdapter` (`id`, `displayName`, `adapterVersion`, `verifiedAt`, `ladders`, `landmarks`, `matches`, `extract`), `ExtractInput`, `ExtractResult` and the `ExtractErrorCode` union **including `DOM_SHAPE_UNRECOGNIZED`** �?*G8.1*, *G8.3*
- [x] 5.2 Create `src/capture/providers/registry.ts` with a single registration point, `byId()` and `byUrl()`
- [x] 5.3 Create `src/capture/providers/chatgpt.ts` with an **ordered selector ladder per slot** (conversation root, turn container, message text, role signal), declared `landmarks`, `adapterVersion` and `verifiedAt` �?*G8.1*, *G8.2*
- [x] 5.4 Implement the structural pre-check and the cardinality check in the shared extraction helper: a missing landmark returns `DOM_SHAPE_UNRECOGNIZED` **before any message text is read**, and observed turn-container count must equal produced message count �?*G8.3*, *G8.8*
- [x] 5.5 Record which ladder rung satisfied each slot and return it as `rungs` on success �?*G8.2*
- [x] 5.6 Add redacted fixtures `tests/fixtures/chatgpt/conversation.html` (�? messages, �? roles), one fixture **per ladder rung**, and `tests/fixtures/chatgpt/unknown-shape.html` �?*G8.5*
- [x] 5.7 Add `tests/capture/providers/chatgpt.spec.ts` covering canonical URL match, alternate subdomain match, unrelated URL non-match, successful extraction with complete provenance and reported `rungs`, each ladder rung selected by its fixture, and a typed `DOM_SHAPE_UNRECOGNIZED` failure on the unknown-shape fixture �?*G1.2*, *G1.3*, *G1.5*, *G8.2*, *G8.3*, *G8.5*
- [x] 5.8 Add a spec asserting extraction is side-effect free by comparing fixture DOM serialization before and after `extract()` �?*G1.6*
- [x] 5.9 Add a spec asserting a typed extraction failure results in zero transport calls �?*G1.4*
- [x] 5.10 Add a spec asserting no code path produces a partially-populated conversation as a success �?*G8.7*, *G1.4*
- [x] 5.11 Add a spec asserting a zero-message extraction yields a typed failure rather than an empty success �?*G7.6*
- [x] 5.12 Add a spec asserting no adapter imports another adapter, and that the registry returns exactly one adapter for a provider URL and none for an unsupported URL �?*G1.1*
- [x] 5.13 Add a source-scan spec asserting no provider hostname or provider selector appears in `src/background.ts` or under `src/api/` �?*G1.8*
- [x] 5.14 Add a source-scan spec asserting **no** selector, landmark or adapter configuration is fetched from the network or read from `chrome.storage` �?*G8.4*
- [x] 5.15 Add a spec asserting extraction behaves identically with the network unavailable �?*G8.9*
- [x] 5.16 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` �?*G6.1*

## 6. Capture pipeline (`capture-pipeline`)

- [x] 6.1 Create `src/capture/normalize/normalize.ts` converting an `ExtractResult` success into a validated `CaptureEvent` with `eventId`, `capturedAt` and provenance stamped �?*G1.5*
- [x] 6.2 Create `src/capture/queue/queue.ts` implementing FIFO storage in `chrome.storage.local` under one key, **removal only on acknowledged delivery**, a reported `paused` state at the spill limit with **no automatic discard and no loss counter at all**, and `nextAttemptAt` backoff `min(2000 * 2^attempts, 300000)` �?*G2.1*, *G2.2*, *G2.5*
- [x] 6.3 Add specs for the queue: enqueue on failure, acknowledgement removes only the acknowledged entry, **no entry discarded at the spill limit and no loss counter exists**, FIFO drain order, monotonic capped backoff, persisted `nextAttemptAt`, and no conversation content in `chrome.storage.sync` �?*G2.1*, *G2.2*, *G2.4*, *G2.5*, *G2.7*
- [x] 6.4 Add a spec asserting a 2xx response carrying no `record_id` leaves the entry unacknowledged �?*G2.9*
- [x] 6.5 Add a spec asserting the queue drains regardless of the value of `autoCapture`, so toggling it mid-flight loses nothing �?*G7.5*
- [x] 6.6 Create `src/capture/pipeline.ts` wiring extract �?validate �?send �?enqueue-on-failure, with the guard that an invalid event never reaches the transport �?*G2.10*
- [x] 6.7 Add a spec asserting the transport spy records zero calls for an invalid event and that the failure is recorded with a validation reason �?*G2.10*
- [x] 6.8 Add a failure log whose records hold **only** `{ timestamp, path, code, providerId }`, with a distinguishable `validation` vs `transport` reason and a bound �?add specs for both reasons, for the bound, and for the assertion that no record contains message text, `target` text or an event body �?*G2.10*, `tests/capture/failures.spec.ts`
- [x] 6.9 Produce a user-visible message naming the unacknowledged count and stating that capture is paused when the spill limit is reached �?*G2.3*, `tests/capture/queue.spec.ts`
- [x] 6.10 Create `src/capture/lifecycle.ts` registering `chrome.alarms` for the drain, plus drains on `onStartup` and after a successful send �?*G2.6*
- [x] 6.11 Add specs asserting a drain is attempted on worker start with due entries, and that the backoff schedule survives a simulated worker restart �?*G2.6*
- [x] 6.12 Create `src/content/entry.ts` as the content-script entry: resolve adapter via the registry, observe mutations with a debounce, and produce conversation-level updates
- [x] 6.13 Add specs for change detection: a new message yields an updated event containing the full conversation; an unchanged mutation yields no event; rapid mutations are debounced
- [x] 6.14 Add specs asserting **passive** capture is inert when `autoCapture` is false, that manual capture still works while it is false, and that unsupported pages select no adapter �?*G1.7*
- [x] 6.15 Implement the drift counter: N consecutive typed failures for one provider raises a "capture from `<provider>` needs updating" status naming the failing slot or rung, and a success clears it �?*G8.6*, `tests/capture/drift.spec.ts`
- [x] 6.16 Add the `esbuild` bundle step producing `dist/content.js` as an IIFE, and a spec asserting it contains no top-level `import` or `export` �?*G6.4*
- [x] 6.17 Register the content script in `public/manifest.json` with `matches` limited to supported provider hosts and `run_at: "document_idle"` �?*G1.9*
- [x] 6.18 Add router message types for capture status; keep `return true` for async handlers; add a spec asserting every declared `MessageType` has a handling case �?*G6.5*
- [x] 6.19 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` �?*G6.1*

## 7. Remaining providers (`capture-providers`)

Each of 7.1�?.4 adds: an adapter with a ladder per slot plus `landmarks`, `adapterVersion` and
`verifiedAt`; fixtures for every rung plus an unknown-shape fixture; and specs for the three
`matches()` cases, extraction with `rungs`, rung coverage, the typed unknown-shape failure, and the
cardinality check. Task 7.1 is the template the rest copy.

- [x] 7.1 Add `src/capture/providers/claude.ts` with full ladder/landmark/fixture/spec coverage �?*G8.1*�?G8.5*, `tests/capture/providers/claude.spec.ts`
- [x] 7.2 Add `src/capture/providers/gemini.ts` with the same coverage �?*G8.1*�?G8.5*, `tests/capture/providers/gemini.spec.ts`
- [x] 7.3 Add `src/capture/providers/grok.ts` with the same coverage, and add the Grok host to `optional_host_permissions` �?*G8.1*�?G8.5*, *G1.9*, `tests/capture/providers/grok.spec.ts`
- [x] 7.4 Add `src/capture/providers/deepseek.ts` with the same coverage, and add the DeepSeek host to `optional_host_permissions` �?*G8.1*�?G8.5*, *G1.9*, `tests/capture/providers/deepseek.spec.ts`
- [x] 7.5 Register all five adapters in the registry (one line each) and add a spec asserting all five providers resolve by URL �?*G1.1*
- [x] 7.6 Add a spec asserting `optional_host_permissions` contains all five provider hosts and `host_permissions` contains none of them �?*G1.9*
- [x] 7.7 Add a spec asserting every adapter declares a `verifiedAt` that is not in the future �?*G8.1*
- [x] 7.8 Add adapter `match` patterns to the content-script manifest entry for all five providers �?*G1.9*
- [x] 7.9 Gate check: record output of `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` �?*G6.1*

## 8. Surfaces (`extension-surfaces`)

- [x] 8.1 Add the transport mode control (`auto`/`consumer`/`developer`) to `public/options.html` and wire it in `src/options.ts` �?*G7.3*
- [x] 8.2 Update the connection test to report the resolved mode and whether a fallback occurred
- [x] 8.3 Update connection-test failure text to name the endpoint or native host that was tried
- [x] 8.4 Require an explicit confirmation **naming the exact host** before a non-loopback base URL can be saved; add specs asserting the confirmation is required, and that declining leaves the previous value and makes no request �?*G7.2*, `tests/options/remote-egress.spec.ts`
- [x] 8.5 Add a persistent banner to popup and side panel naming the host while a non-loopback base URL is configured, with a spec asserting it appears for a non-loopback host and is absent for loopback �?*G7.4*, `tests/surfaces/egress-banner.spec.ts`
- [x] 8.6 Add a capture status area to the popup showing passive-capture on/off, queue length, the **unacknowledged count** and the **paused** flag, with a visual distinction for a non-zero unacknowledged count and an explicit paused message �?*G2.3*, `tests/surfaces/capture-status.spec.ts`
- [x] 8.7 Add a `CAPTURE_STATUS` message type and specs asserting the UI receives queue length, unacknowledged count and paused flag, and that no loss counter is displayed �?*G2.3*, `tests/surfaces/capture-status.spec.ts`
- [x] 8.8 Preserve manual-capture input on failure and surface the failure reason; add specs for success clearing input and failure preserving it
- [x] 8.9 Add settings specs: defaults fill missing keys including `transportMode: "auto"`, partial settings merge over defaults, save/read round-trip, and `pendingSearch` written to session rather than sync �?*G2.7*
- [x] 8.10 Add a spec asserting `injectIntoAiChats` defaults to `false` and that no provider DOM node is mutated while it is `false`
- [x] 8.11 Add specs for the router: unknown message type returns `success: false` with the type named; async handlers keep the channel open �?*G6.5*
- [ ] 8.12 Manual gate: load unpacked from `dist/` and record results for popup online/offline, manual add, context-menu capture of a selection with page metadata, side panel opening via Ctrl+Shift+H, and options save plus test connection �?*G6.4*
- [ ] 8.13 Manual gate: with `autoCapture` enabled, open a supported provider conversation with �? messages and record whether a capture event is produced without user interaction �?*G1.7*

Gate evidence for 8.1–8.11 (run 2026-09-14, Windows, Node v22.18.0):

```
npm run typecheck   -> 0
npm run lint        -> 0
npm test            -> 33 files passed, 483 tests passed
npm run build       -> [build-content] wrote dist/content.js / Assets copied to dist/ / 0
```

Screens no. 8.12 and 8.13 are **manual** gates and are **not** discharged by the above. What can be
verified without a browser session *is* verified: `npm run build` then every path `dist/manifest.json`
references exists in `dist/` — `background.js True`, `content.js True`, `options.html True`,
`popup.html True`, `sidepanel.html True`, `icons/icon16|32|48|128.png True`. That is a static
loadability check, not evidence that the extension loads, that the popup renders online/offline, that
the context-menu capture carries page metadata, that Ctrl+Shift+H opens the side panel, or that
passive capture fires on a live provider conversation. Those need a human with a browser profile
signed in to the providers, and are recorded as open rather than inferred.

## 9. Production readiness (`quality-gates`)

- [x] 9.1 Add a spec validating `dist/manifest.json` after a build: every referenced path resolves under `dist/` �?*G6.5*, `tests/quality/manifest.spec.ts`
- [x] 9.2 Add a spec asserting required build outputs exist: `manifest.json`, `background.js`, `content.js`, the three HTML files, their scripts, and the four icon sizes �?*G6.4*
- [x] 9.3 Add a spec failing when an HTML file in `public/` is not referenced by the manifest, so a new surface cannot be silently missed �?*G6.4*
- [x] 9.4 Add manifest invariant specs: `manifest_version` is 3, no `<all_urls>` or `*://*/*` host pattern, **every `host_permissions` entry resolves to a loopback host**, and every declared permission has a corresponding API usage in source �?*G7.1*, *G6.5*, `tests/quality/manifest.spec.ts`
- [x] 9.5 Add a remote-code spec scanning all sources and HTML for `eval(`, `new Function(`, and `<script src="http` �?*G6.5*
- [x] 9.6 Add a spec asserting no committed spec contains `it.only`, `describe.only`, `it.skip` or `describe.skip` �?*G6.3*
- [x] 9.7 Add a spec asserting `tsconfig.json` still has `strict: true` and no `any`-suppressing compiler option �?*G6.1*
- [x] 9.8 Add a source-scan spec asserting production code outside schema/types implements no belief, goal, world-model or consolidation logic �?*G5.4*
- [x] 9.9 Add a source-scan spec asserting `/memory/ingest` appears nowhere under `src/` �?*G5.5*, `tests/quality/source-scans.spec.ts`
- [x] 9.10 Add a source-scan spec asserting no `chrome.storage.sync` write receives conversation text �?*G2.7*, `tests/quality/source-scans.spec.ts`
- [x] 9.11 Add a `.gitignore` spec asserting the build output directory is ignored and no built artifact is tracked �?*G6.7*
- [x] 9.12 Add a `README` spec asserting both transport modes are documented and Consumer Mode requires no separate server install �?*G6.5*
- [x] 9.13 Add an npm script that runs the full gate chain (typecheck �?lint �?test �?build) in order and exits non-zero on the first failure �?*G6.1*
- [x] 9.14 **Implement `npm run test:traceability`** (`scripts/traceability.js`): parse `G#.#` ids from `docs/END-STATE.md`, parse cited ids from every `openspec/changes/**/specs/*/spec.md` requirement heading, and verify every test path cited in this file exists on disk. Fail when a criterion is cited by no requirement, when a requirement cites a nonexistent criterion, or when a cited test path is missing. Wire it into the test run �?*G6.8*, `tests/quality/traceability.spec.ts`
- [x] 9.15 Run the full gate chain and record the complete output �?*G6.1*

Gate evidence for 9.1–9.15 (run 2026-09-14, Windows, Node v22.18.0):

```
npm run typecheck      -> 0
npm run lint           -> 0
npm test               -> 36 files passed, 543 tests passed
npm run build          -> [build-content] wrote dist/content.js / Assets copied to dist/ / 0
npm run test:traceability -> 0
   [traceability] criteria declared : 62 (docs/END-STATE.md)
   [traceability] criteria cited    : 62/62 by 50 requirement headings
   [traceability] test paths cited  : 45 in tasks.md
   [traceability] OK — every criterion is cited and every cited test path exists
npx openspec validate <change> --strict -> 0 for cortexbridge-perception-layer,
   cortexbridge-retention-boundary, cross-provider-search-index, substrate-migration,
   capture-context-injection
```

Three findings from running the gate rather than assuming it:

1. **The traceability gate failed honestly at first** — 38 unresolved claims, then 9, then 0. Every
   step was a real documentation gap being closed, never the gate being weakened. The last six were
   criteria G3.9 and G4.1–G4.5, which are owned by follow-up changes; they were anchored by drafting
   those changes (tasks 11.2–11.4) so that each criterion has a normative home, not by exempting
   them from the gate.
2. **Two mis-citations were found and corrected while reading the specs**: `transport-layer`
   attributed the verified HTTP surface to *G6.1* (which is the typecheck gate) and
   `capture-pipeline` attributed passive-capture opt-in to *G1.6* (which is extraction
   non-mutation, a `capture-providers` criterion). A criterion cited on the wrong requirement is a
   claim that looks traced and is not.
3. **A backticked test path in a `tasks.md` is a claim that the file exists today**, which is what
   the gate asserts. The follow-up changes' tasks therefore name the specs they will add in prose
   rather than in backticks. `scripts/traceability.js` documents that convention; it does not skip
   anything quietly.

## 10. Acceptance verification

- [x] 10.1 Verify `capture-contract`: every requirement has a passing spec; name the spec file per requirement �?*G3.1*, *G5.1*, *G5.3*, `tests/schema/`
- [x] 10.2 Verify `capture-providers`: every requirement has a passing spec, including all five providers' `matches()` coverage, rung coverage, containment scans and the drift threshold �?*G1.1*�?G1.9*, *G8.1*�?G8.9*, `tests/capture/`
- [x] 10.3 Verify `capture-pipeline`: acknowledged delivery, FIFO, backoff cap, persisted `nextAttemptAt`, no-loss-counter, content-free failure log, debounce, and passive-inert-when-disabled �?*G2.1*�?G2.10*, `tests/capture/`
- [x] 10.4 Verify `transport-layer`: the verified-surface scenarios, the positive-ack rule, both retrieval mechanisms, the `{score, record}` unwrap, and all three modes plus fallback and remote-refusal rules �?*G3.2*�?G3.6*, *G7.3*, *G5.3*, `tests/api/`
- [x] 10.5 Verify `extension-surfaces`: settings, mode control, capture status with unacknowledged/paused, the remote-egress confirmation and banner, capture feedback, and messaging-contract specs pass; record the two manual gates �?*G2.3*, *G7.2*, *G7.4*, `tests/surfaces/`
- [x] 10.6 Verify `quality-gates`: every gate command and invariant spec passes including traceability; record each command's exit code �?*G6.1*�?G6.8*
Spec-per-requirement audit for 10.1-10.6 (run 2026-09-14, Windows, Node v22.18.0).

**How the mapping was assigned, and what it is not.** The `### Requirement:` headings of each
capability were listed, every spec file's `describe()` titles were read, and each requirement was
assigned the file that exercises it. A scratch helper (`.scratch/audit-capabilities.mjs`) first
attempted the cheap version of the same audit - a requirement counts as covered only when a spec
file's text spells its `G#.#` id - and reported 26 of 55 requirements "unmapped". That list is
mostly false negatives and is not treated as evidence of a gap: `tests/api/transport.spec.ts`
proves the whole read and write surface through `describe` titles ("semantic search path",
"structured read path", "positive acknowledgement") without spelling a single criterion id, and
`tests/schema/egress.spec.ts` together with `tests/schema/validate.spec.ts` prove all eight
`capture-contract` requirements the same way. An id-presence heuristic measures how often criteria
are quoted, not whether behaviour is tested. The mapping below is the assigned one.

Machine-read counts (`npx vitest run --reporter=json` into `.scratch/vitest-results.json`, aggregated
by `.scratch/count-tests.mjs`). This replaced three failed PowerShell attempts to scrape the same
numbers out of decorated console text; the figures come from a machine-readable artifact:

```
scope            files  tests
api                  2     53
capture             14    256
options              4     25
quality              8    102
router               1      7
schema               2     71
surfaces             4     26
tests (root)         1      3
TOTAL               36    543
numPassedTests=543 numFailedTests=0
```

**10.1 `capture-contract` - 8 requirements, all proven under `tests/schema/` (71 tests).**

| Requirement | Spec that exercises it |
|---|---|
| Versioned contract identifiers | `tests/schema/validate.spec.ts` ("accepts what the contract allows", "JSON round trip") |
| Conversation and message shape | `tests/schema/validate.spec.ts` ("rejects exactly one thing at a time") |
| Provenance is mandatory on every event | `tests/schema/egress.spec.ts` ("the provenance payload is complete and nothing more") |
| Validation returns field-level errors | `tests/schema/validate.spec.ts` ("never throws", "the diagnostic carries no content") |
| Invalid events are rejected before transport | `tests/schema/validate.spec.ts` + `tests/capture/extraction-contract.spec.ts` |
| Provenance survives egress as structured metadata (G3.1, G3.5, G5.1) | `tests/schema/egress.spec.ts` ("the reserved key", "discrete, filterable provider identity", "provenance round-trips through a provider-filtered retrieval"); live corroboration under 10.7 |
| The capture record maps to the runtime's add contract (G5.3) | `tests/schema/egress.spec.ts` ("no TTL is ever emitted", "the transcript") |
| The verified protocol is documented as part of the contract (G5.2) | **No unit test can prove that a document describes a runtime.** The evidence is the live re-probe recorded under 10.9 plus `docs/PROTOCOL.md` 3.1 and 3.2. Recorded as such rather than dressed up as a passing spec. |

**10.2 `capture-providers` - 14 requirements.** Evidence: `tests/capture/` (256 tests) and
`tests/quality/providers.spec.ts`. All five providers are covered without five diverging copies:
`tests/capture/providers/chatgpt.spec.ts` is the deep implementation spec, and
`tests/capture/providers/claude.spec.ts`, `tests/capture/providers/grok.spec.ts`,
`tests/capture/providers/gemini.spec.ts` and `tests/capture/providers/deepseek.spec.ts` each run the
single shared contract written in `tests/helpers/adapter-contract.ts`, so `matches()`, ladder-rung
coverage, typed-failure codes and the observed-turn-count rule are exercised once per provider.

| Requirement | Spec that exercises it |
|---|---|
| Provider adapter contract (G8.1) | `tests/capture/providers/chatgpt.spec.ts` ("ChatGPT adapter identity", "verifies no date in the future") and `tests/quality/providers.spec.ts` ("adapter verification dates") |
| Single provider registry (G1.1) | `tests/capture/providers/registry.spec.ts` ("adapter isolation", "registry lookup") |
| URL matching for supported providers (G1.2) | `tests/capture/providers/chatgpt.spec.ts` ("ChatGPT URL matching") and the per-provider specs |
| Extraction produces a normalized conversation (G1.3, G1.5, G1.6) | `tests/capture/providers/chatgpt.spec.ts` ("extraction", "extraction purity") + `tests/capture/normalize.spec.ts` |
| Typed extraction failures (G1.4, G7.6, G8.7) | `tests/capture/providers/chatgpt.spec.ts` ("ChatGPT typed failures", "never returns a partially-populated conversation") + `tests/capture/failures.spec.ts` |
| Extraction is independent of the network (G8.9) | `tests/capture/extraction-contract.spec.ts` ("extraction is independent of the network") |
| Provider specifics are contained | `tests/quality/source-scans.spec.ts` ("provider containment") |
| Host permissions for every supported provider | `tests/quality/providers.spec.ts` ("provider host permissions") + `tests/quality/manifest.spec.ts` |
| Each slot resolves through an ordered selector ladder (G8.2) | `tests/capture/providers/chatgpt.spec.ts` and `tests/helpers/adapter-contract.ts` ("ladder rungs") |
| A structural pre-check runs before extraction (G8.3) | same two files ("returns DOM_SHAPE_UNRECOGNIZED when a landmark is missing", "reads no message text before deciding the shape is unrecognised") |
| Extracted message count is checked against the page (G8.8) | `tests/helpers/adapter-contract.ts` (line 312) and `tests/capture/providers/chatgpt.spec.ts` (line 261), both asserting `MESSAGE_COUNT_MISMATCH`; surfaced to the user by `tests/capture/drift.spec.ts` |
| Extraction is configured from code only (G8.4) | `tests/quality/source-scans.spec.ts` ("adapter configuration is inert") |
| Each ladder rung and a broken page have fixtures (G8.5) | "has at least one fixture selecting every declared rung of every slot" (both files) over `tests/fixtures/` |
| Repeated drift is surfaced to the user (G8.6) | `tests/capture/drift.spec.ts` (threshold, what the message names, a success clears the state, per-provider state, `toStatus`) |

Verified by search rather than assumed: the literal string `G8.8` appears nowhere under `tests/` -
that requirement is exercised by the `MESSAGE_COUNT_MISMATCH` assertions above, not quoted. `G8.6`
appears only in file-header comments in `tests/capture/drift.spec.ts` and
`tests/capture/pipeline.spec.ts`, not in a `describe` title. Neither fact is a gap; both are
recorded so the next audit does not mistake a missing id for missing coverage.

**10.3 `capture-pipeline` - 6 requirements, all proven under `tests/capture/`.**

| Requirement | Spec that exercises it |
|---|---|
| Passive capture is opt-in and provider-scoped (G1.7, G7.5) | `tests/capture/pipeline.spec.ts` ("inert", "toggling auto capture mid-flight strands nothing") + `tests/capture/content.spec.ts` ("adapter resolution") + `tests/capture/queue.spec.ts` ("nothing is skipped by a setting") |
| Conversation-level capture with observable change detection | `tests/capture/content.spec.ts` ("change detection", "`signatureOf`", "hand-over failure keeps the page as the only copy") |
| Durable queue with acknowledged delivery (G2.7, G2.8, G2.9) | `tests/capture/queue.spec.ts` ("acknowledgement is the only removal", "enqueue", "read") + `tests/quality/source-scans.spec.ts` ("conversation content never reaches sync storage") + `tests/options/settings.spec.ts` ("ephemeral handoff never enters sync") + the live run under 10.7 |
| Backoff survives service-worker termination (G2.6) | `tests/capture/lifecycle.spec.ts` ("the periodic alarm", "a drain on worker start", "the other two wake-ups", "`drainNow`") + `tests/capture/queue.spec.ts` ("backoff", "drain order survives a restart") |
| Unacknowledged backlog is reported and bounded (G2.2, G2.3, G2.4) | `tests/capture/queue.spec.ts` ("the spill limit is a pause, never a discard", "drain cost and honesty") + `tests/surfaces/capture-status.spec.ts` ("the worker reports the queue and the pause", "the popup shows the capture status") |
| Capture failures are recorded with a reason and no content (G2.5, G2.10) | `tests/capture/failures.spec.ts` ("record shape", "bound", "read") + `tests/capture/pipeline.spec.ts` ("rejection happens before the transport", "queued on a delivery failure", "delivered") |

Each behaviour named in 10.3 maps to a named assertion: acknowledged delivery ("acknowledgement is
the only removal"), FIFO and restart safety ("drain order survives a restart"), the backoff cap and
persisted `nextAttemptAt` ("backoff"), the absent loss counter ("the spill limit is a pause, never a
discard"), the content-free failure log (`tests/capture/failures.spec.ts` plus the source scan),
debounce ("change detection", "`signatureOf`") and passive-inert-when-disabled ("inert").

**10.4 `transport-layer` - 9 requirements, proven under `tests/api/` (53 tests).**

| Requirement | Spec that exercises it |
|---|---|
| Transport interface abstraction | `tests/api/transport.spec.ts` + `tests/api/native.spec.ts` |
| Developer Mode reproduces the verified HTTP surface | `tests/api/transport.spec.ts` ("`HttpTransport.health()`", "capture egress") + the live run under 10.7 and 10.9 |
| Capture egress uses only a positive-acknowledging endpoint (G2.1, G5.3) | `tests/api/transport.spec.ts` ("positive acknowledgement") + live `success=true record_id_present=true` under 10.7 |
| Remote egress is opt-in and never silent (G7.1, G7.3) | `tests/api/transport.spec.ts` ("non-loopback refusal") + `tests/options/remote-egress.spec.ts` + `tests/options/connection-test.spec.ts` |
| Retrieval uses the two mechanisms the runtime supports (G3.3, G3.4, G3.6, G3.7, G3.8, G5.6) | `tests/api/transport.spec.ts` ("semantic search path", "structured read path", "provider provenance on the read path") + live G3.4, G3.5 and G3.7 under 10.7 |
| Semantic search results are unwrapped (G3.2) | `tests/api/transport.spec.ts` ("semantic search path"); the `{score, record}` unwrap is asserted there, with no criterion id spelled in the file |
| Consumer Mode uses native messaging | `tests/api/native.spec.ts` (`addMemory`, `health`, `resolve`, retrieval) - mock-verified only; see 10.8 |
| Automatic mode selection with fallback | `tests/api/transport.spec.ts` ("transport mode resolution") + `tests/api/native.spec.ts` (`resolve`) + `tests/options/connection-test.spec.ts` ("names what was tried") |
| Resolved mode is reported | `tests/api/transport.spec.ts` ("transport mode resolution") + `tests/options/connection-test.spec.ts` ("reports the resolved mode and the fallback", "probing never persists anything") |

**10.5 `extension-surfaces` - 7 requirements, proven under `tests/surfaces/` (26), `tests/options/`
(25) and `tests/router/` (7).**

| Requirement | Spec that exercises it |
|---|---|
| Settings shape covers modes and capture | `tests/options/settings.spec.ts` ("settings defaults and merge") |
| Options page exposes transport mode | `tests/options/settings.spec.ts` ("the transport mode control") |
| Capture status is visible (G2.3, G2.4) | `tests/surfaces/capture-status.spec.ts` (both cases) + `tests/capture/queue.spec.ts` |
| Capture actions give feedback | `tests/surfaces/manual-capture.spec.ts` ("the popup keeps the draft when the store fails", "the side panel keeps the draft") |
| Injection is gated and inert by default | `tests/options/inject.spec.ts` ("`injectIntoAiChats` is off and unimplemented") |
| Remote egress requires confirmation and a banner (G7.2, G7.4) | `tests/options/remote-egress.spec.ts` (both cases) + `tests/surfaces/egress-banner.spec.ts` |
| Messaging contract stays in one place | `tests/router/router.spec.ts` ("an unknown message type is refused by name", "async handlers keep the channel open", "a handler that throws answers rather than hanging") + `tests/quality/message-types.spec.ts` ("every declared message is routed") |

**The two manual gates in this capability are not discharged and are recorded as open.** Tasks 8.12
and 8.13 are human gates: loading unpacked from `dist/` and observing popup online/offline, manual
add, context-menu capture with page metadata, Ctrl+Shift+H for the side panel, options save plus
test connection; and confirming that passive capture fires on a live provider conversation with no
user interaction. The specs above assert the state the worker computes and the banner the surface is
told to show. They do not observe a rendered banner or a real provider page, and nothing in this
audit claims otherwise. `tests/surfaces/egress-banner.spec.ts` exercises the banner decision, not a
browser.

**10.6 `quality-gates` - 11 requirements, proven under `tests/quality/` (102 tests) plus the gate
commands themselves.** Each command was just re-run; the exit codes are the command's own:

```
npm run typecheck         -> 0   (tsc --noEmit && tsc -p tsconfig.test.json, no output)
npm run lint              -> 0   (eslint src tests, no output)
npm test                  -> 0   Test Files  36 passed (36) / Tests  543 passed (543)
npm run build             -> 0   [build-content] wrote dist/content.js / Assets copied to dist/
npm run test:traceability -> 0   62/62 criteria cited by 51 requirement headings, 45 test paths cited, OK
```

| Requirement | Spec that exercises it |
|---|---|
| Typecheck gate (G6.1) | `tests/quality/gates.spec.ts` ("the typecheck gate keeps its strictness") + the command above |
| Test gate (G6.3) | `tests/quality/gates.spec.ts` ("the test gate cannot run a subset and call it green") + the command above |
| Lint gate (G6.2) | `tests/quality/gates.spec.ts` ("the lint gate is a real flat config") + the command above |
| Build gate produces a loadable bundle (G6.4) | `tests/quality/manifest.spec.ts` ("the build emits every file the package needs", "no page ships that nothing links to") + `tests/quality/content-bundle.spec.ts` + the command above |
| Manifest and permission invariants (G1.9, G6.5) | `tests/quality/manifest.spec.ts` ("manifest invariants - least privilege", "no remote code anywhere in the package", "every path in the packaged manifest resolves") + `tests/quality/message-types.spec.ts` + `tests/quality/providers.spec.ts` |
| The build output directory is never committed (G6.7) | `tests/quality/gates.spec.ts` ("the build output is ignored and untracked") |
| Cross-platform build scripts (G6.6) | `tests/quality/gates.spec.ts` ("cross-platform scripts"); both scripts run on Windows above, the POSIX leg remains unverified (see 10.13) |
| Source-level invariant scans (G1.8, G2.7, G5.4, G5.5) | `tests/quality/source-scans.spec.ts` ("network surface containment", "provider containment", "adapter configuration is inert", "no cognitive reasoning in the perception layer", "the silent-failure endpoint is absent", "conversation content never reaches sync storage") |
| One command runs the whole gate chain | `tests/quality/gates.spec.ts` ("one command runs every gate"); the script is `npm run verify`, which chains typecheck, lint, test and build in order |
| Criteria are traced to tests (G6.8) | `tests/quality/traceability.spec.ts` (5 describes, 15 tests) + the command above |
| Build output is not committed | `tests/quality/gates.spec.ts` and `tests/quality/manifest.spec.ts`; `dist/` is ignored, consistent with the G6.7 scenario |

**What this audit does not establish.** Four things are open after 10.1-10.6 and are carried into
10.13 rather than quietly folded into a pass: the two manual gates (8.12, 8.13) above, G5.2 whose
only possible evidence is a live probe rather than a unit test, Consumer Mode which is mock-verified
only (10.8), and the POSIX leg of the cross-platform scripts. Nothing else in the six capabilities
was left without a named file.

 �?stop the core, capture 10 conversations, restart it, confirm all 10 are delivered and `GET /memory/query?actor=…` returns 10 records; then capture from two different providers and confirm each provider filter returns only its own records. Record raw output �?*G2.8*, *G3.7*
- [x] 10.8 **Resolve Open Question 1**: confirm or correct the native host name and message framing against the HipCortex Desktop installer, or record that Consumer Mode remains mock-verified only
- [x] 10.9 **Open Question 2 was resolved by probing**: `POST /memory/add` is the capture endpoint and `/memory/ingest` is forbidden. Re-verify that the live runtime still behaves this way and update `docs/PROTOCOL.md` if any row changed �?*G5.2*
- [x] 10.10 Run `openspec validate "cortexbridge-perception-layer" --strict` and `openspec status --change "cortexbridge-perception-layer"`; record both outputs
- [x] 10.11 Replace every "not executed" marker in `docs/END-STATE.md` with quoted command output for the criteria this change covers (G1, G2, G3.1–G3.8, G5.1, G5.3–G5.5, G6, G7, G8)
- [x] 10.12 Record which goals remain unaddressed and name the follow-up change that owns each: `cross-provider-search-index` (G3.9), `substrate-migration` (G4.1–G4.4), `capture-context-injection` (G4.5), and the cross-repo dependency `core: add filter to POST /memory/search`
- [x] 10.13 Record the final residual-risk list: anything unverified, any gate skipped, any open question still unresolved, and the POSIX-portability limitation of task 1.9

Live evidence for 10.7 and 10.9 (2026-09-14, runtime 3.11.0). The driver is a scratch Node script
that imports the **shipped** `dist/capture/queue/queue.js`, `dist/api/transport/http.js` and
`dist/schema/index.js`, so what was exercised is the code that ships, not a re-implementation. Two
things were simulated and are named as simulated: the "runtime is down" leg points at a loopback
port nothing listens on (`127.0.0.1:3999`) because the core at 3030 belongs to another product and
stopping it is not this repository's to do, and `chrome.storage.local` is backed by a JSON file read
and written on every call, so a "restart" is genuinely the process starting again with nothing in
memory. Every write is scoped to a throwaway actor and deleted at the end.

```
RESULT precull records_deleted=0
RESULT events_constructed=10 invalid=0
RESULT A_runtime_down attempted=10 delivered=0 retained=10 unacknowledged=10 paused=false reasons=UNREACHABLE
RESULT A_persistence_file_bytes=5926
RESULT B_runtime_up attempted=10 delivered=10 retained=0 unacknowledged=0 reasons=
RESULT G3.7 round_trip actor=cortexbridge-e2e-probe status=200 total=10
RESULT G3.4 filter_chatgpt=5 filter_claude=5
RESULT G3.5 filter_no_captures status=200 total=0
RESULT G3.1 provider_recovered_after_round_trip=["chatgpt"]
RESULT G3.1 fields action=capture:chatgpt record_type=Perception target_chars=79 ttl=null
RESULT G2.9 memory_add status=200 success=true record_id_present=true
RESULT G2.9 ack_rule_detail=null
RESULT cleanup records_deleted=12 remaining_for_actor=0
live_e2e=0
```

What that discharges, criterion by criterion: **G2.8** — with the runtime absent, 10 captures were
attempted, 0 delivered, 10 retained, and the queue file on disk was 5926 bytes; when the runtime
returned, the same 10 were delivered and nothing was expired or rewritten in between. **G3.7** —
`GET /memory/query?actor=cortexbridge-e2e-probe` returned `total=10`. **G3.4** — the provider filter
is real and exclusive: `capture:chatgpt` returned 5 and `capture:claude` returned 5, which sums to
the 10 written, so neither filter is a no-op and neither leaks. **G3.5** — an empty result is a
success (`status=200 total=0`), not an error. **G3.1** — the provider recovered from the stored
record after the round trip (`metadata["hipcortex.capture"].provider`) is `["chatgpt"]`, the record
type is `Perception`, the action is `capture:chatgpt`, and `ttl` is `null` because the extension
omits `ttl_seconds`. **G2.9** — the capture endpoint really is `POST /memory/add`, 200 with
`success: true` and a non-empty `record_id`. **G5.2** — re-verified, and no row changed; see below.

Four findings from running it rather than assuming it:

1. **Two failures were the driver's, not the extension's, and both were caught by reading the
   shipped wiring instead of guessing.** Phase A first reported `attempted=0`: `enqueueEvent` sets
   `nextAttemptAt` one backoff step ahead, so a drain on the same instant is correctly not due — the
driver had to advance the clock. Phase B then reported `HTTP_ERROR` for all ten with detail
   `HTTP 422`, because the driver passed a `CaptureEvent` straight to `addMemory` where the pipeline
   passes `toEgressRecord(event, actor)` (`src/capture/pipeline.ts:126`); posting the same event
   through the egress builder returned 200. Neither was an extension defect, and neither would have
   been visible without executing the thing.
2. **`POST /memory/add` has a PII precondition, and it is a 403 that means "not acknowledged".** The
   throwaway actor ended in `Date.now()`, and the runtime answered
   `403 {"success":false,"error":"precondition blocked: PII risk=0.90 patterns=[\"PII:1789355714\"]"}`.
   Probed field by field: a dashed phone number, a bare 10-digit run and an email address in the
   transcript are each refused the same way, while a transcript with none of them is accepted. A
   refused capture is therefore retained and retried forever, and today it is indistinguishable from
   a transient failure. Recorded in `docs/PROTOCOL.md` §3.2 and owned by
   `cortexbridge-retention-boundary` (G2.2, G2.3). Nothing is discarded in the meantime, and the
   extension must not be taught to redact the user's text to get past it.
3. **`/memory/ingest` was re-verified and is worse-documented than it is dangerous.** It returned
   `200` while fabricating `{ "action": "noted", "record_type": "Temporal", "ttl_seconds": 86400,
   "working_memory": true }` from a body carrying our provenance. Two details are new relative to the
   existing row: `text` is its only required field (omitting it is the one input that errors, `422`),
   and a body with no `context` and no `session_id` is still accepted. Both were added to
   `docs/PROTOCOL.md` §3.1. No endpoint row changed, so G5.2 is confirmed rather than amended.
4. **`paused=false` while ten entries are unacknowledged is correct**, and was checked against the
   source rather than assumed: `QueueState.paused` is `entries.length >= QUEUE_SPILL_LIMIT`, i.e. it
   reports the storage ceiling, not a transport failure. The unacknowledged count is the signal for
   a transport failure, and the run shows both values independently.
### 10.8 - Open Question 1 resolved: Consumer Mode remains mock-verified only

> **Superseded 2026-09-14 by `installable-product`.** The escape hatch applied here was the right
> call given what this repository could reach at the time, but its conclusion was too modest. The
> host turned out to be this repository's own — `host/bridge-host.mjs`, registered as
> `com.hipcortex.bridge` by `npm run install:host` — so the name and the framing stopped being
> assumptions about a third-party installer. `docs/PROTOCOL.md` §9 and `README.md` now record what
> was executed. Read the paragraphs below as the record of the question, not as current status.

The question was whether the native host name and message framing in `src/api/transport/native.ts`
are correct. They cannot be confirmed from inside this repository, so the machine was inspected for
the installer that would confirm them (2026-09-14):

```
$ git ls-files dist                                      -> (empty; dist/ is not tracked)
HKCU  \SOFTWARE\Google\Chrome\NativeMessagingHosts       -> exists
HKLM  \SOFTWARE\Google\Chrome\NativeMessagingHosts       -> exists
   hosts present across both: com.anthropic.claude_browser_extension,
     com.google.drive.nativeproxy, com.microsoft.browsercore (x2),
     com.microsoft.defender.browser_extension.native_message_host,
     siteadvisor.mcafee.chrome.extension, webadvisor.mcafee.chrome.extension
   hosts matching HipCortex: none
$LOCALAPPDATA\Google\Chrome\User Data\NativeMessagingHosts -> does not exist
$LOCALAPPDATA\Programs  (names matching "hip")             -> none
```

Six native hosts are registered on this machine and none of them is HipCortex, and no installer is
present, so the assumption cannot be tested. Applying the escape hatch this task itself provides:
**Consumer Mode is recorded as mock-verified only.**

What that leaves verified is narrower than it sounds and is named here so it is not over-read.
`tests/api/native.spec.ts` asserts that `connectNative` is called with `NATIVE_HOST` and that the
outbound envelope is exactly `[{ actor, action, target, metadata }]`; that a missing host produces a
typed retained failure rather than a drop; and - because `interpretAcknowledgement` is shared with the
HTTP transport - that the acknowledgement rule is not re-implemented per transport. What is **not**
verified: the host name, the reply framing, and that any host answers at all. The correction point is
one constant and one protocol section, which is the whole of the exposure.

### 10.10 - `openspec validate --strict` and `openspec status`

```
$ npx openspec validate "cortexbridge-perception-layer" --strict
Change 'cortexbridge-perception-layer' is valid
validate_exit=0
```

```
$ npx openspec status --change "cortexbridge-perception-layer"
Change: cortexbridge-perception-layer
Schema: spec-driven
Progress: 4/4 artifacts complete

[x] proposal
[x] design
[x] specs
[x] tasks

All artifacts complete!
status_exit=0
```

Noted rather than hidden: the status command writes `- Loading change status...` to stderr, which
PowerShell 5.1 surfaces as a `NativeCommandError` line ahead of the table. The process exit code is
`0` and the artifact table is complete, so the line is cosmetic - but it is exactly the kind of
stderr noise a scripted gate would trip over, so it belongs in the record.

### 10.11 - Every "not executed" marker in `docs/END-STATE.md` replaced with output

Six statements asserted that nothing had been executed. Each was replaced by a claim the commands
above support, and none of the replacement sentences is weaker than the evidence behind it:

| Was | Is now |
|-----|--------|
| header: "no product criterion has been executed yet" | verified 2026-09-14, gate chain exit codes quoted, end-to-end round trip against the live core, and the four things that are *not* executed named in the same paragraph |
| goal summary: "specified, not implemented" for G1, G2, G6, G7, G8 | "verified by spec", "verified, including end-to-end against the live core", "verified - five commands, exit 0 each" |
| G3.7 verification cell: "manual gate, recorded with quoted output" | executed 2026-09-14, quoted under 10.7: the provider filter returned 5 and 5, summing to the 10 written |
| open risk 4: "Nothing in this document's product criteria has been executed. There are no test files, no lint config and no `node_modules/`." | "The gates prove this repository's behaviour, not the product's behaviour in a browser", with the four remaining gaps named |
| open risk 6: "`dist/` is currently committed" | closed by verification and moved to Closed risks; replaced by the PII-precondition risk |
| Section "Live verification": pre-execution | the 2026-09-14 round-trip paragraph plus five probe rows |

The criteria tables themselves were not touched, so the traceability gate still reads the same 62
declared criteria. Backing output, all re-run today:

```
npm run typecheck          -> 0
npm run lint               -> 0
npm test                   -> 0   Test Files 36 passed (36) / Tests 543 passed (543)
npm run build              -> 0
npm run test:traceability  -> 0   62/62 criteria cited by 51 requirement headings, 148 test paths cited, OK
live e2e driver            -> 0   (RESULT block under 10.7)
```

### 10.12 - Goals this change does not address, and who owns them

| Goal / criterion | State | Owning change |
|------------------|-------|---------------|
| G3.9 offline search over captured conversations | not implemented | `cross-provider-search-index` |
| G4.1-G4.4 export/import, recorded `id` remap, field-equivalence check, version-mismatch rejection | the export/import *mechanism* exists and was exercised live (10.7); the versioning guarantees are not implemented | `substrate-migration` |
| G4.5 writing captured context into a provider composer | not implemented; already gated by `injectIntoAiChats` | `capture-context-injection` |
| semantic search scoped by provider (the G3.6 combination) | not expressible: `POST /memory/search` has no filter field | cross-repo `core: add filter to POST /memory/search` |

All four follow-up changes exist, are drafted, and validate --strict (`cortexbridge-retention-boundary`,
`cross-provider-search-index`, `substrate-migration`, `capture-context-injection`, each `exit=0 :
Change '<name>' is valid`). They are listed here rather than implemented so this change stops at the
boundary it declared.

### 10.13 - Residual risk, after everything above ran

Nothing here is a gate that was skipped; it is what stays true after the gates passed.

1. **POSIX portability is unverified.** `scripts/clean.js` and `scripts/package.js` are cross-platform
   Node scripts and were run to completion on Windows; neither has been run on a POSIX host. This is
   the limitation task 1.9 named and it is unchanged.
2. **Two acceptance criteria are browser-manual gates and were not discharged**: 8.12 (the rendered
   remote-egress banner) and 8.13 (live capture from a provider page). The specs assert computed
   state; they do not render a banner in a browser or load ChatGPT. Recorded as open in group 8 and
   again under 10.5 rather than counted as passing.
3. **Consumer Mode is mock-verified only** (10.8): the host name and reply framing are unverified.
4. **A permanently-refused capture is indistinguishable from a transient failure.** `POST /memory/add`
   answers `403 precondition blocked: PII risk=0.90` for a transcript containing a phone number or an
   email, deterministically, so the retry never succeeds and never stops. Nothing is lost, but the
   queue reports it through the same `reasons` list as `UNREACHABLE`. Owned by
   `cortexbridge-retention-boundary`; deliberately not mitigated by rewriting the user's text.
5. **The "runtime is down" leg of 10.7 is a dead loopback port** (`127.0.0.1:3999`), not a stopped
   core. The core at 3030 belongs to another product and stopping it is not this repository's to do.
   The failure path is therefore exercised, but the exact socket error differs from a dropped listener.
6. **The end-to-end driver used a file-backed `chrome.storage.local`**, so persistence across a
   process restart is real but MV3 service-worker termination timing is exercised by spec, not by a
   browser.
7. **G5 (core-side behaviour) and part of G4 remain unspecified in this repository** - END-STATE open
   risks 1 and 3. This change documents what the runtime does; it does not specify what it should do.
8. **`openspec/` is untracked**, so plan-file changes cannot be reviewed with `git diff`. A reviewer
   reading a task diff is reading `docs/` only.
9. **G5.2 has no unit test and cannot get one.** The evidence is the live re-probe under 10.9 plus
   `docs/PROTOCOL.md` 3.1/3.2. Stated so the empty cell in 10.1 is not mistaken for an oversight.

### 10.14 - Independent re-verification: the transport move had left its source file behind

The gates above were green when they ran. Re-running them against the same tree later was not, and the
reason is the point of this section: **a green run is evidence about the tree it ran against, and
about nothing else.**

`src/api/client.ts` - the v0.1.0 `HipCortexClient` that task 4.2 was supposed to *move* - was still
present. It called `fetch(` directly, carried the historical endpoint ladder, and so failed three
containment specs:

| Spec | Assertion |
|------|-----------|
| `tests/api/transport.spec.ts` | never references a superseded capture path, in source or in a request |
| `tests/quality/source-scans.spec.ts` | keeps the only network call in `src/api/transport/http.ts` |
| `tests/quality/source-scans.spec.ts` | the silent-failure endpoint is absent - G5.5 |

`npm test` answered `numTotalTests=590 numPassedTests=587 numFailedTests=3 success=false`, exit `1`.
`git status` also showed every file under `src/` with a modification time later than the green run, so
the green result described an earlier tree.

The file was dead code: a search for `HipCortexClient` returned three hits, all inside the file itself,
and nothing imported `api/client`. Task 4.13 had already migrated the router to the transport factory.
It was removed with `git rm -f src/api/client.ts`; the 138-line original is recoverable from `HEAD`, so
the removal is reversible. **The three specs were not touched, weakened or skipped** - they police G5.5
and the single-network-file rule, and on this tree they were correct.

Re-run after the removal, same day:

```
npm run typecheck          -> 0
npm run lint               -> 0
npm test                   -> 0   Test Files 37 passed (37) / Tests 590 passed (590)
npm run build              -> 0
npm run test:clarity       -> 0   11 questions, all six stages covered
npm run test:traceability  -> 0   62/62 criteria cited, 151 test paths cited
npx openspec validate cortexbridge-perception-layer --strict -> 0   Change is valid
```

The counts quoted in 10.11 (36 files / 543 tests / 148 cited paths) are left as they stand, because
they reported that run accurately. They were superseded the same day by `tests/quality/clarity.spec.ts`
joining the suite, not by any change to what those tasks assert.

Two smaller findings from the same pass, corrected rather than merely noted:

- `.gitignore` claimed `dist/` "is still tracked in git today" and gave `git rm -r --cached dist` as
  outstanding work. `git ls-files dist` returns `0` files and `docs/END-STATE.md` G6.7 records the
  opposite. The comment now states the verified fact and keeps the reason.
- `package-lock.json` is ignored with no reason recorded anywhere in the repository. That gap is ledger
  question Q11 in `docs/clarity-ledger.json` with a named exit, rather than an invented rationale
  written into `.gitignore` to make it look settled.

What this pass did **not** establish: that the removed client behaved like the transport that replaced
it - only that it is absent, with equivalence being what `tests/api/transport.spec.ts` asserts - and
that any criterion has been executed in a browser, since 8.12 and 8.13 remain open.

### 10.15 - A real browser ran: 8.12 is partly executed, and both open gates stay open

**Question.** 10.14 closed with "no criterion has been executed in a browser, since 8.12 and 8.13
remain open." The follow-up was whether a Playwright-driven browser could discharge either gate
instead of a person. Recorded as ledger question Q12, and answered by running rather than by assuming.

**Why the Playwright MCP browser cannot do it, and what can.**

- The MCP browser is **real Chrome 152** launched with
  `--user-data-dir=...\ms-playwright-mcp\mcp-chrome-865f62f --remote-debugging-pipe` and **no
  `--load-extension`**. A browser that is already running cannot adopt an MV3 extension, and the MCP's
  launch arguments are not ours to change, so it cannot host `dist/`.
- `--load-extension=dist` **on a browser this probe launches itself** is silently ignored on Chrome
  137+: zero extensions are listed, `chrome.runtime` is `undefined` on
  `chrome-extension://.../popup.html`, and stderr carries no diagnostic for the refusal.
- The supported path is the CDP `Extensions` domain. `Extensions.loadUnpacked({ path: <dist> })`
  loads it at runtime and returns the id. That is what `.scratch/browser-e2e.mjs` uses.

**Evidence.** `.scratch/browser-e2e.mjs`, run 2026-09-14 on Windows with Node v22.18.0: **23/23 checks
passed, exit 0**, against the live core at `127.0.0.1:3030`. The probe is deliberately **not** wired
into `package.json` and lives under the gitignored `.scratch/`, so the four-command `verify` chain
pinned by `tests/quality/gates.spec.ts` is untouched. It makes read-only calls only.

| 8.12 sub-item | Result | Observation |
|---|---|---|
| load unpacked from `dist/` | **executed** | loads as MV3, listed in `chrome://extensions` as `HipCortex Memory`, id `okclkjijdcgimdclgohehndbllbkiemi`; `background.js` service worker starts |
| popup online/offline | **executed** | badge `online` / `badge healthy` against the live core; `offline` / `badge unhealthy` against a dead loopback port; back to `online` after restore |
| options test connection | **executed** | a real click returned `Connected - connected (com.hipcortex.bridge) via auto mode, no fallback` |
| options save | **not executed** | no form submit was driven; the probe wrote settings through `chrome.storage.sync` in a throwaway profile instead |
| manual add | **not executed** | `ADD_MEMORY` writes to the live store, and nothing authorised that |
| context-menu capture | **not executed** | `chrome.contextMenus.onClicked` originates from Chrome's OS-level menu, which CDP input does not reach; no API enumerates created menu items either |
| side panel via Ctrl+Shift+H | **not executed** | `sidepanel.html` renders correctly, but `chrome.commands.onCommand` is resolved by the browser UI layer above the renderer, so a CDP `keyDown` cannot fire it |

Also observed on the same run, without having gone looking for it: popup, options and sidepanel each
load with **zero** console errors or uncaught exceptions; all three reach the core; `CAPTURE_STATUS`
returned `passive: "off"`, `queued: "0"`, `unacknowledged: "0"`; `SEARCH_MEMORY` returned real records
from the live store, read-only; and the in-browser manifest reports MV3 with `popup.html`,
`sidepanel.html`, both declared commands, and loopback-only `host_permissions`.

**8.12 stays `[ ]`. 8.13 stays `[ ]` and was not approached.** Three of 8.12's sub-items are now
executed with output, but 8.12 as written asks for load unpacked *and* results for five named
surfaces. The remainder is not a matter of finding a better tool: the context menu and the hotkey
both live above the renderer. Flipping 8.12 on a partial run would turn a precise open item into a
false one.

**A finding this pass did not go looking for.** `resolution` reports `active: "native"` with
`fellBack: false` and `detail: "com.hipcortex.bridge reachable; captures are delivered over Native
Messaging"`, and the options connection test agreed. Consumer Mode had been recorded as mock-verified
only (10.8); here a real Chrome selected the native path and reported the host reachable. What that
does **not** establish: that a capture completed the native round-trip and was acknowledged by the
core. The probe captured nothing, on purpose, because an unacknowledged capture is a correctness
matter under the retention boundary rather than a test detail.

**One small observation, not claimed as a defect.** `options.ts` attaches its listeners only after an
awaited `GET_SETTINGS` round-trip, so the settings controls exist but are inert for that window. The
probe tripped over it - a click that went nowhere - which is how it was found. The window is one local
message round-trip and no claim is made that a person could hit it.

**One sentence of 10.14 that this supersedes.** Its closing claim that no criterion has been executed
in a browser was true of that run and is no longer true. It is left standing as the record of that
run; this section carries the browser evidence.

### 11.x - Follow-up changes: raised, drafted, validated, not implemented here

11.1-11.4 were reported as drafted by an earlier run; that is now backed by their own gate rather than
by assertion - all four (plus this change) answer `exit=0 : Change '<name>' is valid` to
`openspec validate <name> --strict`.

**11.5 is not implemented here and must never be.** The task is cross-repo: adding a filter to
`POST /memory/search` is a change to the HipCortex core, which lives in a separate repository that
`AGENTS.md` forbids this code from reaching into. What this repository owes is raising the dependency
so it is not lost, and that is done - it is recorded in `docs/END-STATE.md` (open risk 5), in this
change's task 10.12, and in the `cross-provider-search-index` change that would consume it. The
checkbox is closed on that basis and on nothing more.

### 12 - The clarification mechanism is its own change, not a goal of this one

One part of the same mandate is not dischargeable here and is recorded rather than quietly dropped: how
a question is resolved before anyone is asked, and how asking stops. It is a property of how work is
done, not of the perception layer, so it adds no criterion to `docs/END-STATE.md` and nothing under
`src/` may know it exists. It now has its own change, `openspec/changes/clarity-protocol/`, its own
document, `docs/CLARITY.md`, its own ledger, `docs/clarity-ledger.json`, and its own gate,
`npm run test:clarity`, proved by `tests/quality/clarity.spec.ts` (47 tests). The ledger's entries are
questions this work actually raised - including the two answered by inspecting the machine instead of
asking (10.8), the five failed attempts at a measurement (10.1), and the decision not to widen the lint
gate to reach the gate script itself.

## 11. Follow-up changes (not part of this change �?recorded so they are not lost)

- [x] 11.1 Draft `cortexbridge-retention-boundary`: what the extension retains, for how long, and why it is not a second substrate �?*G2*, *G4*
- [x] 11.2 Draft `cross-provider-search-index`: local offline search over captured conversations with its own retention rule �?*G3.9*
- [x] 11.3 Draft `substrate-migration`: versioned export/import with a recorded `id` remap, field-equivalence verification, and version-mismatch rejection �?*G4.1*�?G4.4*
- [x] 11.4 Draft `capture-context-injection`: writing captured context into a provider composer, gated by `injectIntoAiChats` �?*G4.5*
- [x] 11.5 Raise the cross-repo dependency `core: add filter to POST /memory/search` so semantic search can be provider-scoped �?*G3.6*
## 12. Making capture reachable (added after the first user report)

The first person to install this reported that it stored nothing from a ChatGPT or a Claude
conversation. The extractors were not at fault. The switches that decide whether anything happens at
all were either unreachable or invisible, and no criterion in `docs/END-STATE.md` could fail on that —
which made it a hole in the plan before it was a defect in the code. Four criteria were added (G1.10 to
G1.13) and the tasks below discharge them.

The reconciliation with the review document that prompted this work is written into the rationale
paragraph under the G1 criteria table in `docs/END-STATE.md`: the document asked to keep
`autoCapture` default `false` **unless** a consent prompt and a site-permission flow shipped with the
flip. Both shipped, so the default is `true` and stays `true`. Its non-goals are respected — no Desktop
installer, no new provider, no selector rewrite.

- [x] 12.1 Resolve site access from `contains` **or** `getAll`, in one place, with an unanswerable query counting as not allowed — *G1.10* — `tests/ui/site-access.spec.ts`
- [x] 12.2 Read the declared origins from the manifest rather than a second list, so no surface can promise a host the build never asks for — *G1.10* — `tests/ui/site-access.spec.ts`
- [x] 12.3 State the missing hosts on the options page, with one control that requests the whole declared list in a single gesture — *G1.10* — `tests/options/site-access.spec.ts`
- [x] 12.4 Make the toolbar badge a standing statement: `!` in the warning colour while any declared site is ungranted, blank when all are — *G1.11* — `tests/router/first-run.spec.ts`
- [x] 12.5 Open the options page on `install` and not on `update`, so a new user is told the choice exists and an existing one is not interrupted — *G1.11* — `tests/router/first-run.spec.ts`
- [x] 12.6 Return a flashed badge to the standing state rather than to blank, so a capture success cannot erase the warning — *G1.11* — `tests/router/first-run.spec.ts`
- [x] 12.7 Add `CAPTURE_ACTIVE_TAB` and the worker→page `FLUSH_CAPTURE` protocol, so a whole conversation can be asked for on demand — *G1.12* — `tests/capture/flush.spec.ts`
- [x] 12.8 Run the click as a `manual` trigger, which `autoCapture` does not gate, so a user with passive capture off still has the button — *G1.12* — `tests/router/capture-active-tab.spec.ts`
- [x] 12.9 Type every way the click can fail — no active tab, unwatched page, refused site, extraction failure, no answer at all — *G1.12* — `tests/router/capture-active-tab.spec.ts`
- [x] 12.10 Never report an unacknowledged capture as stored: a queued capture is "kept here, will be retried", a paused queue is a failure — *G1.12*, *G2.9* — `tests/router/capture-active-tab.spec.ts`
- [x] 12.11 Keep the capture in `chrome.storage.local` through a transient failure, so the promise to retry is a fact about the disk and not about the message — *G2.9* — `tests/router/capture-active-tab.spec.ts`
- [x] 12.12 Give the popup a "Capture this conversation" control and a passive switch that writes only the field it changed — *G1.13* — `tests/surfaces/conversation-capture.spec.ts`
- [x] 12.13 Give the side panel the same control and the same three renderable outcomes, so the two surfaces cannot describe one click differently — *G1.13* — `tests/surfaces/conversation-capture.spec.ts`
- [x] 12.14 Rename the Options label from a mechanism to an outcome, and explain what the switch governs and what it does not — *G1.13* — `tests/options/site-access.spec.ts`
- [x] 12.15 Keep provider names out of the router and the transport while doing all of the above, including in comments — *G1.8* — `tests/quality/source-scans.spec.ts`
- [x] 12.16 Default `autoCapture` to `true`, because with it false a fresh install captured nothing, raised no error and said nothing — *G1.10*, *G1.12* — `tests/capture/pipeline.spec.ts`
