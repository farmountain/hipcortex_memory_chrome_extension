---
name: CortexBridge Alignment
description: "Realign implementation objectives, problem statements, target end state, and measurable acceptance criteria for the CortexBridge perception layer, driven by a ReAct loop with compulsory verification gates."
agent: "plan"
argument-hint: "Phase to focus on (0, A, B, C, D) or 'all'"
---

# Objective

Drive this repository from *"a Chrome extension that talks to an external HipCortex server"*
to *"the perception layer of a single-install HipCortex product"*, using a ReAct loop where
**every step is tied to one measurable acceptance criterion and proven by a command**.

Current argument / scope: **${input}** — if empty, treat as `all`.

## Problem statements

| ID | Problem | Evidence in this repo today |
|----|---------|-----------------------------|
| **P1** | Developer architecture leaked into the product. The user must install and start HipCortex separately, then discover `127.0.0.1:3030`, before the extension shows any value. | README "Prerequisites" requires `pip install -U hipcortex` + `hipcortex start`; `DEFAULT_SETTINGS.apiUrl` is a localhost URL |
| **P2** | No capture contract. Free text is flattened into `MemoryRecord.target`; there is no conversation, message, attachment, or provenance shape, so extension and core cannot evolve independently. | `src/types/index.ts` has only `MemoryRecord`/`SearchResult`; capture sites use `action: "selected" \| "noted" \| "visited"` |
| **P3** | No transport abstraction. `HipCortexClient` hardcodes HTTP, so the consumer path (Native Messaging → local runtime) has no seam and no fallback story. | `src/api/client.ts` calls `fetch` directly in 3 methods |
| **P4** | No perception layer. There are no content scripts, no provider adapters, and no capture pipeline; `autoCapture` and `injectIntoAiChats` exist in settings but do nothing. | `public/manifest.json` has `"content_scripts": []`; settings flags are read only in `options.ts` |
| **P5** | Zero verification. The repo cannot prove any claim it makes. | `npm test` finds no test files; `npm run lint` has no ESLint config; `clean`/`package` are POSIX-only |

## Objectives

- **O1 — Keep the boundary.** This repo is perception only: capture, normalize, enqueue, forward.
- **O2 — One stable contract.** A versioned capture schema both sides can depend on.
- **O3 — Two modes, one codebase.** Consumer (Native Messaging → local runtime, zero config) and Developer (HTTP to any HipCortex URL, current behavior preserved).
- **O4 — Isolate provider volatility.** A DOM change must be fixable inside one adapter.
- **O5 — Evidence over assertion.** Every objective is gated by a passing command.

## Target end state

```
schema/                      versioned CaptureEvent / Conversation / Message / Provenance
src/
  api/                       transport layer: Transport iface, HttpTransport, NativeTransport
  capture/
    providers/               one adapter per AI site
    normalize/               DOM/payload → schema
    queue/                   durable bounded outbound queue
  content/                   content scripts (registered in manifest)
  types/                     shared + message types
tests/                       vitest specs + fixtures (saved DOM/payload snapshots)
```

## Acceptance criteria (measurable)

Each criterion must be provable by the listed command. A criterion is only **PASS** when the
command output is quoted in the iteration log.

### Phase 0 — Harness (blocking; nothing else may be claimed until green)

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-0.1 | Vitest runs and discovers specs under `tests/` | `npm test` exits 0 with ≥1 spec |
| AC-0.2 | ESLint flat config exists and passes | `npm run lint` exits 0 |
| AC-0.3 | Typecheck gate is real and strict | `npx tsc --noEmit` exits 0 |
| AC-0.4 | Scan-test helper exists for source-wide rules (regex asserts over `src/**`) | the helper's own spec passes |
| AC-0.5 | `clean`/`package` scripts work on Windows or are marked POSIX-only with a documented alternative | `Remove-Item -Recurse -Force dist; npm run build` exits 0 |

### Phase A — Reposition (P1)

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-A.1 | README describes the perception/cognition boundary and the two modes; no "install HipCortex first" prerequisite for Consumer Mode | manual read + no `pip install` in prerequisites |
| AC-A.2 | Product surface reads as "HipCortex", architecture as "CortexBridge"; README/manifest `description` consistent | scan test for naming |
| AC-A.3 | `docs/PROTOCOL.md` states the contract version and the core-side endpoint it targets | file exists, contains `schemaVersion` |

### Phase B — Contract (P2)

Constraint to resolve first: `tsconfig.json` has `rootDir: "src"`, so a repo-root `schema/`
is not importable from `src/**`. Choose `src/schema/` (no config change) or widen `rootDir`
(breaks the current `dist/` layout assumption in `public/manifest.json`) and record the choice
in `docs/PROTOCOL.md` before writing the first import.

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-B.1 | `schema/` exports `CaptureEvent`, `Conversation`, `Message`, `Attachment`, `Provenance` and `SCHEMA_VERSION` | spec imports them and asserts `SCHEMA_VERSION === 1` |
| AC-B.2 | `validateCaptureEvent()` returns field-level errors for missing provenance, unknown version, empty messages | table spec: ≥5 invalid + ≥2 valid fixtures |
| AC-B.3 | Invalid events throw **before** any transport call | spec spies on transport and asserts it was not invoked |
| AC-B.4 | Message order and role survive round-trip unchanged | spec with a 6-message fixture |
| AC-B.5 | `capturedAt` is ISO-8601 UTC; `schemaVersion`, `provider`, `adapterVersion`, `conversationUrl` mandatory | spec asserts regex + `Date.parse` round-trip, and one failure case per missing field |

### Phase C — Dual transport (P3)

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-C.1 | `Transport` interface (`send`, `health`) with `HttpTransport` + `NativeTransport` implementations | specs for both |
| AC-C.2 | Developer Mode preserves today's behavior exactly: default `http://127.0.0.1:3030`, 4 add endpoints, 4 search endpoints, plain-`ok` **and** JSON `/health`, 404 advances to next endpoint, timeout → `{ healthy: false }` | ported specs reproducing each path |
| AC-C.3 | Consumer Mode tries native host `com.hipcortex.bridge`, reads `chrome.runtime.lastError`, falls back to HTTP within one retry, and reports a user-visible status | spec with mocked `connectNative` throwing |
| AC-C.4 | Mode is selectable in Options, persisted in `chrome.storage.sync`, defaults to Consumer with automatic fallback | spec on settings round-trip + options UI read |

### Phase D — Perception (P4, O4)

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-D.1 | `ProviderAdapter` interface (`id`, `displayName`, `matches(url)`, `extract(...)`) exists and adapters are registered in one registry | specs |
| AC-D.2 | `matches()` covered per adapter with canonical, subdomain, and non-matching URLs | ≥3 cases × 5 providers |
| AC-D.3 | No provider hostname or selector appears in `src/background.ts` or `src/api/**` | scan test |
| AC-D.4 | Extraction failures are typed and never forwarded as complete events | spec with an empty/degraded fixture |
| AC-D.5 | All five providers (ChatGPT, Claude, Grok, Gemini, DeepSeek) have adapters, and Grok + DeepSeek hosts are in `optional_host_permissions` | scan test on `public/manifest.json` |
| AC-D.6 | Failed forwards are queued in `chrome.storage.local` with a bound of 500, FIFO drain, and exponential backoff 2s → 5min cap | specs: enqueue on failure, drop-oldest at bound, FIFO order, monotonic backoff |
| AC-D.7 | Passive capture: with `autoCapture` on, a message sent on a supported site produces a stored event with no user interaction | manual gate + integration spec |

### Phase E — Boundary enforcement (O1)

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-E.1 | Only `src/api/**` may call `fetch(`; only transport may call `connectNative(` | scan test over `src/**` |
| AC-E.2 | No cognitive vocabulary in production code outside schema/types | scan test with a denylist |
| AC-E.3 | No DOM mutation outside the three UI entry points | scan test |

### Quality gates (compulsory, blocking on every iteration)

| ID | Gate | Command |
|----|------|---------|
| AC-Q.1 | Typecheck clean | `npx tsc --noEmit` |
| AC-Q.2 | All specs pass; no `it.only` / `describe.skip` committed | `npm test` + scan test |
| AC-Q.3 | Lint clean | `npm run lint` |
| AC-Q.4 | Build produces a loadable bundle; `dist/manifest.json` parses; permissions stay least-privilege (no `<all_urls>`) | `npm run build` + manifest spec |
| AC-Q.5 | No remote code: no `eval(`, `new Function(`, or remote `<script src="http` | scan test |
| AC-Q.6 | Manual: load unpacked from `dist/`, popup reports online/offline, context-menu capture succeeds, side panel opens via Ctrl+Shift+H | manual gate, recorded |

## ReAct protocol

Run this loop. **One criterion per iteration.** Do not batch.

```
### Iteration N — <AC-id>
- Goal: <what must be true, phrased as the criterion text>
- Reason: <why this is the smallest next step; which evidence is currently missing>
- Act: <files/paths touched, one sentence>
- Observe: <exact command> → <exit code + relevant output pasted verbatim>
- Status: PASS | FAIL | BLOCKED
- Next: <next criterion, or the unblocking action>
```

Rules:

- An iteration with no `Observe` line is invalid and counts as **not done**.
- `FAIL` is a legitimate and complete result — report the failure output, then the smallest
  corrective step.
- If a criterion cannot be tested (no seam, no fixture), **adding the seam is the work** —
  do not skip the criterion.
- Phase 0 and Phase B must be green before Phase C or D begins. Phase C and D may interleave
  afterwards, but each iteration still closes exactly one criterion.
- Update this file's criterion table (PASS/FAIL) at the end of each Phase, not each iteration.

## Non-goals

- Implementing HipCortex core (memory, goals, beliefs, world model, causal graphs) in this repo.
- Merging this code into the main HipCortex repository — the boundary is the point.
- Cloud sync, telemetry, or any remote upload of captured conversations.
- Rebranding away from "HipCortex" for the user-facing product surface.

## Output

Produce: (1) the iteration log for the phase in scope, (2) the updated criterion status table,
(3) any new criteria discovered that are not measurable yet, flagged with the missing seam.
