# End-State Goals and Measurable Acceptance Criteria

**Status:** authoritative for scope decisions. **Owner:** this repository (perception layer).
**Last verified:** 2026-09-14. Every criterion this repository owns has been executed: the gate
chain was run and each command's exit code recorded, the whole spec suite was run, and the
end-to-end round trip was executed against a live core at `127.0.0.1:3030`. The quoted output is in
`openspec/changes/cortexbridge-perception-layer/tasks.md`, groups 9 and 10. What is **not** executed
is named rather than hidden: the two browser-manual gates (tasks 8.12 and 8.13), Consumer Mode,
which has no installable host to test against (task 10.8), the POSIX leg of the cross-platform
scripts (task 10.13), and everything core-side in G4 and G5. This document exists so that no goal
here is ever reported as achieved without a quoted command output.

**How the claims were reached** is a separate document: `docs/CLARITY.md` states the order of
resolution (read the artifact, run it, inspect the environment, self-prompt and falsify, and only then
ask a person), the four states a question can hold, and the exit conditions that stop either loop.
Its ledger, `docs/clarity-ledger.json`, holds the questions this work actually raised, including the
ones answered by probing the machine rather than by asking, and `npm run test:clarity` gates it. That
mechanism is process, not product: it adds no criterion to this document and nothing in `src/` knows
it exists — see `openspec/changes/clarity-protocol/`.

## How to read this document

Each goal has four parts:

- **Statement** — what is true when the goal is met.
- **Interpretation locked** — the reasoning question had more than one reading; the chosen
  reading and the evidence for choosing it are recorded so the decision is not silently reopened.
- **Non-goals with reasons** — readings that were considered and rejected, and *why*, so a
  future contributor does not re-litigate them by accident.
- **Acceptance criteria** — numbered, each with an executable verification. A criterion is met
  only when its verification has been run and its output quoted.

## The boundary that constrains every goal

> CortexBridge **perceives**. HipCortex core **remembers and reasons**.

Consequences that decide several goals below, and that are not negotiable within this repo:

1. No memory, goals, beliefs, world model, or consolidation logic ships in this repository.
2. The browser is **not** the retention boundary. The runtime is.
3. The extension nonetheless **must not lose an acknowledged-or-pending capture** — "not the
   retention boundary" justifies handing data off, not destroying it.

## Goal summary

| Goal | Statement | Owner | Status |
|------|-----------|-------|--------|
| **G1** | Capture conversations from all five providers | this repo | **verified by spec**; live capture gated by the browser-manual gate 8.13 |
| **G2** | No silent loss between browser and runtime | this repo | **verified, including end-to-end against the live core** (10.7) |
| **G3** | Cross-provider retrieval over captured content | this repo (filter) + core (index) | **mechanism and provider filter verified live**; one core gap remains |
| **G4** | Migrate cognitive state across boundaries | core, plus one new follow-up change | **export/import verified** (4.1, 4.2, and the version refusal 4.3), and the CLI/MCP re-read of a capture verified live (4.4); the browser half of 4.4 and G4.5's manual gate are unrun |
| **G5** | Cognitive distillation of conversations | core, via a defined handoff | endpoint pinnable; core-side behaviour still unspecified |
| **G6** | Every claim provable by a command | this repo | **verified** — five commands, exit 0 each (10.6) |
| **G7** | The extension cannot be turned into a silent exfiltration channel | this repo | **verified by spec**; the rendered banner gated by the browser-manual gate 8.12 |
| **G8** | Provider DOM drift degrades to a typed error, not a wrong capture | this repo | **verified by spec** across five providers |
| **G9** | An install that completes, or says exactly what is missing | this repo | **verified by spec**; the host is built and the register-and-load step is a documented command |

---

## G1 — Capture conversations from all five providers

**Statement.** With `autoCapture` enabled, a conversation on ChatGPT, Claude, Grok, Gemini or
DeepSeek is captured without user interaction, normalized into the versioned contract, and
forwarded. `autoCapture` defaults to `true`; what gates capture in practice is the site grant
(G1.10), which no install has until the user gives it.

**Interpretation locked.** Capture means the **full conversation transcript** (ordered messages
with roles), not the last message and not a summary. Reason: a message-level capture cannot
reconstruct a conversation, and the core cannot reason over a fragment. The **conversation is
the unit of capture** — a later mutation replaces the working conversation rather than appending
a duplicate.

**Non-goals with reasons.**

- *Injecting context back into a chat composer* — requires writing into provider DOM, which is a
  separate change (`capture-context-injection`). `injectIntoAiChats` stays inert and default-off.
  Rejected here because it is the only feature in this repo that could corrupt a user's draft.
- *Scraping a provider's authenticated history endpoints* — requires reading session tokens.
  Rejected: violates least privilege and makes provenance unverifiable.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G1.1 | Each of the five providers has an adapter registered in exactly one registry entry | `npm test -- tests/capture/providers/registry.spec.ts` |
| G1.2 | Each provider's `matches()` returns `true` for canonical URL, `true` for alternate subdomain, `false` for `https://example.com/chat` — 15 assertions total | `npm test -- tests/capture/providers` |
| G1.3 | Each provider extracts a ≥3-message, ≥2-role fixture with exact order and roles preserved | `npm test -- tests/capture/providers` |
| G1.4 | Each provider returns a typed error (`EMPTY_CONVERSATION` / `NO_ROLE_SIGNAL` / `UNSUPPORTED_LAYOUT`) on a degraded fixture and never a partial success | `npm test -- tests/capture/providers` |
| G1.5 | `provenance.provider` equals `adapter.id` on every successful extraction | `npm test -- tests/capture/providers` |
| G1.6 | Extraction mutates nothing: fixture DOM serialization is byte-identical before and after | `npm test -- tests/capture/providers` |
| G1.7 | With `autoCapture` false, no adapter is selected and no event is produced on any provider page | `npm test -- tests/capture/pipeline.spec.ts` |
| G1.8 | No provider hostname or selector exists outside `src/capture/**` | `npm test -- tests/quality/source-scans.spec.ts` |
| G1.9 | `optional_host_permissions` lists all five canonical hosts; `host_permissions` lists none | `npm test -- tests/quality/manifest.spec.ts` |
| G1.10 | Site access resolves through `contains` **or** `getAll`, so a build is never described as denied when it can read a page; an origin is reported as allowed only if some answer vouches for it, and an unanswerable query counts as **not** allowed | `npm test -- tests/ui/site-access.spec.ts` |
| G1.11 | While any declared site is ungranted, the toolbar badge reads `!` in the warning colour with a tooltip naming the count; when all are granted the badge is blank; the options page opens on `install` and not on `update` | `npm test -- tests/router/first-run.spec.ts` |
| G1.12 | `CAPTURE_ACTIVE_TAB` captures the active tab's whole conversation as a `manual` trigger, which is not gated by `autoCapture`, and reports it as stored / kept-for-retry / a typed failure — never as stored when the runtime did not acknowledge it | `npm test -- tests/router/capture-active-tab.spec.ts` |
| G1.13 | The popup and the side panel each carry a "Capture this conversation" button and state the outcome in the same three renderable states; the popup's passive switch reports the stored setting and writes only the field it changed | `npm test -- tests/surfaces/conversation-capture.spec.ts` |

**Rationale for G1.10 – G1.13.** These four were added after the product was tested by its first real
user, whose report was that it stored nothing. The cause was not a broken extractor: an install could be
healthy, capturing correctly, and still store nothing, because two switches that decide whether anything
happens were unreachable or invisible — the site grant (G1.10), and the trigger (G1.12). The user's own
words, *"it don't even store anything of my conversation with chatgpt and claude, you piece of useless
junk"*, describe a UI defect that no existing criterion could fail on, which is what makes it a gap in
this document rather than a bug in the code.

Three consequences are locked here rather than left to the implementation:

1. **`DEFAULT_SETTINGS.autoCapture` is `true`.** G1.7 (flag false ⇒ inert) is unchanged and still
   proved. What changed is the shipped default: with the flag `false`, a fresh install captured
   nothing, raised no error, and said nothing — so the privacy *intent* produced the reported failure.
   The boundary that G1.7 was reaching for is enforced elsewhere and does not depend on this flag:
   `host_permissions` is loopback-only (G7.1), `apiUrl` must be loopback in `auto`/`consumer` mode, a
   non-loopback URL needs a named confirmation plus a banner (G7.2), and capture does not begin on a
   site the user has not granted (G1.10). The flag now decides only whether pages are *watched*.
2. **A `manual` trigger is not gated by `autoCapture`.** Asking for the conversation in front of you is
   not the extension acting on its own; a user with passive capture off must still have the button.
3. **Provider names stay out of `src/background.ts` and `src/api/**` (G1.8).** The badge, the first-run
   page and the router's refusals therefore name hosts only through the manifest, and the surfaces that
   do name them read `optional_host_permissions`.

**Falsification condition for G1.10 – G1.13.** If a build can be installed, be allowed to read a site,
and still store nothing on a click that reports success, these criteria are not met. If any surface
reports an unacknowledged capture as stored, G2.9 is breached regardless of what these four say.

---

## G2 — No silent loss between browser and runtime

**Statement.** A capture the browser observed is either delivered to the runtime or retained by
the extension until it can be. The extension never discards an unacknowledged capture, and any
condition that prevents delivery is visible to the user.

**Interpretation locked.** "Retain local cognitive state substrate" is **not** an extension
responsibility. Reasoning: the boundary forbids memory logic here, and a second retention store
in the browser would create two divergent copies of the substrate with no reconciliation rule.
What the extension *is* responsible for is **acknowledged delivery**. This is why the goal is
phrased as "no silent loss" rather than "local retention".

This interpretation previously contradicted the design: `design.md` D5 originally bounded the
queue at **500 entries with drop-oldest**, which destroys content under a sustained runtime
outage. That bound was removed. The queue now removes an entry **only on runtime
acknowledgement**, and reaching a spill limit reports the condition instead of discarding.

**Falsification condition.** If captured content is ever lost without the user being able to see
that it was lost, G2 is not met regardless of how the loss occurred. If the core is documented as
*not* the retention boundary (e.g. the product later promises browser-local memory), this
interpretation must be revisited — the two cannot both hold.

**Non-goals with reasons.**

- *Bounded drop-oldest as a safety valve* — rejected: it converts an outage into permanent data
  loss, which is the exact failure the product must not have.
- *Storing a second cognitive substrate in the browser* — rejected: duplicates core state without
  a reconciliation rule, and violates the boundary.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G2.1 | An entry is removed only after the runtime acknowledges it | `npm test -- tests/capture/queue.spec.ts` |
| G2.2 | At the spill limit no existing entry is removed and **no loss counter exists at all** — the extension has no code path that discards an unacknowledged capture | `npm test -- tests/capture/queue.spec.ts` |
| G2.3 | Reaching the spill limit produces a user-visible message naming the unacknowledged count and the paused state | `npm test -- tests/capture/queue.spec.ts` |
| G2.4 | Drain order is FIFO across a simulated runtime restart | `npm test -- tests/capture/queue.spec.ts` |
| G2.5 | Backoff is `min(2000 * 2^attempts, 300000)` and `nextAttemptAt` is persisted per entry | `npm test -- tests/capture/queue.spec.ts` |
| G2.6 | A drain is attempted on worker start when due entries exist | `npm test -- tests/capture/queue.spec.ts` |
| G2.7 | Conversation content never reaches `chrome.storage.sync` | `npm test -- tests/capture/queue.spec.ts` |
| G2.8 | **End-to-end, using the live runtime:** with the runtime stopped, capture 10 conversations, restart it, and all 10 are delivered | executed 2026-09-14 against 3.11.0: `hipcortex stop` → capture 10 → `delivered=0 retained=10` → `hipcortex start` → `delivered=10`; `GET /memory/query?actor=…` returned 10 records with provenance and tags intact; output in §*Live verification* |
| G2.9 | A 2xx response carrying no `record_id` leaves the entry unacknowledged (the ingest-style silent-success failure mode) | `npm test -- tests/capture/queue.spec.ts` |
| G2.10 | Failure records are diagnostics only — no transcript, no `target`, no event body — so bounding the log cannot destroy content | `npm test -- tests/capture/failures.spec.ts` |

---

## G3 — Cross-provider retrieval over captured content

**Statement.** A user can query captured content across all providers in one place and restrict
results to a chosen provider, and can do so without opening the provider's site.

**Interpretation locked.** The phrase "search across all LLMs" has three readings that are
**not** equivalent, and only two are technically achievable in an extension:

| Reading | Verdict |
|---------|---------|
| Search the substrate, filtered by provider | **Achievable.** Chosen as the primary interpretation. |
| Search a provider's history without opening the site | **Achievable only over content already captured**, via a local index. Chosen as the secondary mechanism. |
| Query all providers live, federated | **Rejected — impossible.** No provider exposes an unauthenticated conversation API. |

**How the primary reading is actually achieved — verified, not assumed.** The original client
(`src/api/client.ts`, since replaced by `src/api/transport/`) sent **only** `{ query, limit }` — there was
no filter parameter — and `SearchResult.results` was `MemoryRecord[]`, which has no provider field.
An earlier draft of this document concluded that a core change was required to unblock G3.
**Probing the live runtime disproved that conclusion.** `GET /memory/query` filters server-side on
`actor`, `action`, `record_type`, `limit` and `as_of`, and both provider dimensions are available:

```
GET /memory/query?action=capture%3Achatgpt   → exact match
GET /memory/query?record_type=Perception     → exact match
GET /memory/query?action=__no_such_action__  → 0 records   (negative control)
GET /memory/query?actor=__no_such_actor__    → 0 records   (negative control)
```

So G3 needs **no core change** for provider filtering; it needs the extension to (a) emit
`action = capture:<providerId>` and `record_type = Perception` on egress, and (b) use the
structured endpoint for filtered reads instead of pretending the semantic endpoint can filter.
The one combination that genuinely cannot be expressed is *semantic relevance plus a provider
filter*, tracked cross-repo as `core: add filter to POST /memory/search`.

Two further runtime facts change the criteria below: `POST /memory/search` returns members shaped
`{ score, record }` — **wrapped**, not bare records — and `GET /memory/search-flat` returns plain
strings with no metadata, so it can never serve a provenance-aware read.

**Falsification condition.** If a captured conversation's provider cannot be recovered as a
discrete value after a round trip, G3.1 is not met and every other G3 criterion is void.

**Non-goals with reasons.**

- *Federated live query across providers* — no provider API exists that permits it without
  reading authenticated session state; the result would also be unverifiable.
- *Semantic/vector search inside the extension* — that is a reasoning capability. It belongs in
  the core. The extension may pass a query through; it must not embed or rank.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G3.1 | Outbound capture payload carries discrete `schemaVersion`, `provider`, `adapterVersion`, `source`, `conversationUrl`, `eventId`, `capturedAt` under the single reserved key `hipcortex.capture` | `npm test -- tests/schema/egress.spec.ts` |
| G3.2 | Semantic-search results are unwrapped from `{score, record}` and a malformed wrapper is a typed error, never a record with undefined fields | `npm test -- tests/api/transport.spec.ts` |
| G3.3 | Filtered retrieval sends `action=capture:<providerId>` and `record_type=Perception` to `GET /memory/query`; the semantic path is used only when no filter is requested | `npm test -- tests/api/transport.spec.ts` |
| G3.4 | Filtering to provider **P** returns P records and **no** Q record | `npm test -- tests/api/transport.spec.ts` |
| G3.5 | Filtering to a provider with no captures returns an empty **success**, not an error | `npm test -- tests/api/transport.spec.ts` |
| G3.6 | Semantic search combined with a provider filter is reported as a limitation, never presented as filtered | `npm test -- tests/api/transport.spec.ts` |
| G3.7 | **Round trip against the live runtime:** capture from P → `GET /memory/query?action=capture:P` returns it; the same query for Q does not | executed 2026-09-14; quoted in `tasks.md` 10.7 — the provider filter returned 5 for one provider and 5 for the other, summing to the 10 written |
| G3.8 | `GET /memory/search-flat` is not used by any provenance-aware read path | `npm test -- tests/quality/source-scans.spec.ts` |
| G3.9 | *(follow-up change `cross-provider-search-index`)* search returns captured conversations with the runtime stopped | `npm test -- tests/index/offline-search.spec.ts` |

---

## G4 — Migrate cognitive state across boundaries

**Statement.** State established on one platform or surface can be used on another, losslessly
and verifiably.

**Interpretation locked.** "Across different platforms" has four mutually exclusive readings.
They are **different features with different owners**, and three are not this repo's to build:

| Boundary | Meaning | Owner | Status |
|----------|---------|-------|--------|
| **Across AI platforms** | Carry context ChatGPT → Claude | this repo + core | **implemented** by `capture-context-injection` and verified by spec (`tests/capture/injection.spec.ts`); placing context in a second live provider's composer is G4.5's manual gate, still unrun |
| **Across devices** | Move the substrate to another machine | core | export/import protocol, not yet specified |
| **Across browsers** | Chrome → Firefox/Edge | this repo | deferred; seams preserved, no work started |
| **Across HipCortex surfaces** | browser ↔ VS Code ↔ CLI ↔ MCP | core | **verified for the machine surfaces** (REST, CLI, MCP) on 2026-09-14; the browser half is unverified |

The last row is the one that is already true in principle: because every surface talks to one
core, migration is a property of the architecture rather than a feature. That claim was **unverified**
until 2026-09-14, when one capture delivered through this repository's own egress path was read back
three ways — `GET /memory/export`, `hipcortex backup` and MCP `search_memory` — and the three reads
returned the same messages in the same order with the same text. The browser half of the row is still
unverified, and an unverified claim is not a delivered capability: no spec here can make a real
provider tab emit a capture, so that step needs a person to load `dist/` unpacked.

**Falsification condition.** If the same fixture set, exported from surface A and imported to
surface B, does not produce equivalent retrieval results, migration is not met for that pair.

**Non-goals with reasons.**

- *Cross-browser support in this change* — the adapter and transport seams are designed to allow
  it; building it now would triple the verification surface for no user.
- *Cross-AI-platform migration in this change* — it requires the injection capability, which was
  deliberately deferred so the only DOM-writing feature in the repo is designed on its own.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G4.1 | Export leg **verified against the live runtime**: `GET /memory/export?actor=` returns every record with `metadata`, `priority`, `record_type` and `tags` intact, and an actor with no records returns an empty valid document rather than an error | executed; output recorded in §*Live verification* |
| G4.2 | Import is **field-equivalent with a recorded `id` remap** — *not* byte-equivalent. It goes through `POST /memory/add`, one record at a time, because `POST /memory/bulk` was measured losing `tags`, `source` and `priority` while still answering `failed: 0`; `id` and `integrity` are **regenerated** on both paths | `npm test -- tests/migration/round-trip.spec.ts`, `npm test -- tests/router/import.spec.ts`; live leg recorded |
| G4.3 | A schema-version mismatch is rejected with an actionable error naming the version found and the version understood, never silently coerced, and the refusal writes nothing | `npm test -- tests/migration/version.spec.ts` |
| G4.4 | A capture is retrievable unmodified from the CLI and from MCP — one capture read back by REST export, `hipcortex backup` and MCP `search_memory` returned the same messages in the same order. The **browser half stays a manual gate**: the capture was produced by the shipped egress code under Node, because no spec can make a real provider tab emit one | machine reads executed 2026-09-14, output in §*Live verification*; loading `dist/` unpacked and capturing from a live provider page remains manual |
| G4.5 | *(follow-up, `capture-context-injection`)* context from a captured conversation can be placed in a second provider's composer, and no provider page is mutated while `injectIntoAiChats` is off | `npm test -- tests/capture/injection.spec.ts` |

---

## G5 — Cognitive distillation of conversations

**Statement.** Captured conversations become substrate cognition (memories, entities, beliefs)
usable for later reasoning.

**Interpretation locked.** Distillation is **core-owned**. The extension's job ends at a
faithful, provenance-stamped transcript plus a **structural** envelope (title, message span,
participants, provider) — structural fields only, no interpretation. This is the only option
consistent with the stated boundary; it is a boundary decision, not an effort decision.

**Known contract gap — partially closed.** The change now pins the core-side endpoint in
`docs/PROTOCOL.md`: `POST /memory/add`, with the reserved metadata key `hipcortex.capture` and the
positive-acknowledgement rule. What remains unspecified is core-side **behaviour**: whether a
captured `Perception` record feeds memory/entity/belief derivation, and how long it lives. That
question is deliberately left to the core's owner. What is no longer open is which endpoint the
extension must use — and, critically, which one it must never use:

> `POST /memory/ingest` returns HTTP 200, **silently discards any `metadata` sent to it**,
> replaces `action` and `record_type` with server defaults, and stamps `ttl_seconds: 86400`, so the
> captured conversation is deleted after 24 hours.

Sending capture through that endpoint would satisfy every superficial check and destroy the
product promise. This is recorded as decision **E7**, and a gate asserts the path appears nowhere
in production sources.

**Non-goals with reasons.**

- *Distilling decisions/beliefs/entities inside the extension* — violates the boundary in
  `AGENTS.md` outright. Rejected regardless of convenience.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G5.1 | The capture contract defines the structural envelope and contains **no** cognitive field (no decision, belief, goal, entity) | `npm test -- tests/schema/validate.spec.ts` and a source scan |
| G5.2 | `docs/PROTOCOL.md` states the endpoint, the acknowledgement rule, the reserved metadata key, and the schema version the core must accept | document review, recorded |
| G5.3 | **Verified against the live runtime:** a capture written with the pinned payload is read back with every provenance field present and `expires_at: null` | executed; output recorded in §*Live verification* |
| G5.4 | Production sources outside `src/schema` and `src/types` implement no belief, goal, world-model or consolidation logic | `npm test -- tests/quality/source-scans.spec.ts` |
| G5.5 | `/memory/ingest` appears nowhere under `src/` | `npm test -- tests/quality/source-scans.spec.ts` |
| G5.6 | A captured conversation is retrievable from the core after a core restart — proving it was retained, not merely received | manual gate, recorded |

---

## G6 — Every claim provable by a command

**Statement.** No goal above is reported achieved without an executed verification.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G6.1 | `npx tsc --noEmit` exits 0 with `strict: true` intact | command output |
| G6.2 | `npm run lint` exits 0 against a flat config | command output |
| G6.3 | `npm test` exits 0 with ≥1 spec and no `only`/`skip` committed | command output |
| G6.4 | `npm run build` exits 0 and `dist/` loads unpacked | command output + manual load |
| G6.5 | Every path in `dist/manifest.json` resolves; no `<all_urls>`; no remote code | `npm test -- tests/quality/manifest.spec.ts` |
| G6.6 | `npm run clean` and `npm run package` exit 0 on Windows **and** POSIX | command output on both. **Limitation:** only Windows is verifiable in this repository's current environment; the POSIX leg is unverified until CI or a POSIX machine runs it, and must not be reported as passing before then |
| G6.7 | `dist/` is not committed | `git ls-files dist` returns nothing |
| G6.8 | Every `G#.#` criterion is cited by at least one requirement heading, every cited criterion exists, and every cited test path exists on disk | `npm run test:traceability` |

---

## G7 — The extension cannot be turned into a silent exfiltration channel

**Statement.** Captured conversations cannot leave the machine without the user having explicitly,
knowingly authorised the specific destination.

**Interpretation locked.** "Not easily bypassable" was read as a question about the **egress
path**, because that is the only bypass with a live, demonstrable mechanism in the current code:

> `public/manifest.json` declares `host_permissions: ["https://hipcortex.fly.dev/*"]`, and
> `apiUrl` is a freely editable field in `chrome.storage.sync`. Editing one settings string
> redirects every captured conversation to that remote origin — and the extension is *already
> pre-authorised* to send it there.

That is a one-field, no-warning, no-confirmation redirect of everything the user's browser
observed. It is the chosen reading because it is a real bypass rather than a hypothetical one,
and because the fix also removes an unused capability (nothing in this change sends to
`hipcortex.fly.dev`).

**Falsification condition.** If a supported, legitimate deployment requires non-loopback egress
without interactive confirmation — for example a hosted HipCortex instance intended as the
normal target — then G7.2 and G7.3 must be amended to an explicit **allow-list** flow with a
visible, persistent notice. They must never be deleted, because the underlying requirement (the
user knows where their conversations go) survives any deployment model.

**Non-goals with reasons.**

- *Blocking non-loopback egress entirely* — rejected: a self-hosted remote runtime is a
  legitimate configuration, and a hard block would push users to a worse workaround.
- *Relying on Chrome's host-permission prompt as the notice* — rejected: an install-time prompt
  does not tell the user that *captured conversations* will be sent there, and it does not recur
  when the URL changes.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G7.1 | `host_permissions` contains **no** non-loopback host | `npm test -- tests/quality/manifest.spec.ts` |
| G7.2 | A non-loopback `apiUrl` cannot persist without a confirmation that **names the host**; declining leaves the previous value and makes no request | `npm test -- tests/options/remote-egress.spec.ts` |
| G7.3 | `auto` and `consumer` modes refuse a non-loopback base URL and report the refusal naming the host | `npm test -- tests/api/transport.spec.ts` |
| G7.4 | A persistent banner in popup and side panel names the host while non-loopback egress is configured | `npm test -- tests/surfaces/egress-banner.spec.ts` |
| G7.5 | Toggling `autoCapture` mid-flight loses nothing: the queue drains regardless of the flag | `npm test -- tests/capture/pipeline.spec.ts` |
| G7.6 | A page cannot cause a *silent* skip: zero extracted messages yields a typed failure, never an empty success | `npm test -- tests/capture/providers` |

---

## G8 — Provider DOM drift degrades to a typed error, not a wrong capture

**Statement.** When a provider changes its markup, the extension reports a diagnosable failure
naming what broke. It does not silently capture the wrong thing, and it does not depend on
anything outside the shipped bundle to decide how to read a page.

**Interpretation locked.** "Practical (no easily broken because LLM providers change something)"
has two readings, and the wrong one is the intuitive one:

| Reading | Verdict |
|---------|---------|
| Make extraction resilient enough that drift rarely breaks it | **Chosen, as the ladder + pre-check** — ordered selectors absorb cosmetic changes, and the structural pre-check converts the residue into a typed error |
| Push selectors to a remote config so they can be fixed without a release | **Rejected.** A remote config is simultaneously a G7 bypass vector and a single point of failure that can break every provider at once |

The chosen reading is grounded in a property of the failure itself: a **wrong** capture is worse
than **no** capture, because a wrong capture is indistinguishable from a correct one downstream
and poisons the substrate. Everything here follows from preferring a loud failure to a quiet
mistake.

**Falsification condition.** If drift is observed to be so frequent that shipping an adapter
update is impractical, G8.4 may be revisited — but even then the configuration must be signed,
version-pinned and visible in the UI, never silent. The G8.7 invariant (typed failure over wrong
capture) is not falsifiable by convenience and must not be relaxed.

**Non-goals with reasons.**

- *Heuristic text-scraping of the whole page as a fallback* — rejected: it is precisely the
  mechanism that produces a confident, wrong transcript.
- *Remote selector configuration* — rejected per G8.4; see the falsification condition above for
  the narrow conditions under which a signed version could be reconsidered.
- *Auto-disabling a broken provider silently* — rejected: silence is what lets a user believe
  capture is happening when it is not.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G8.1 | Every adapter declares `adapterVersion` and a `verifiedAt` date that is not in the future | `npm test -- tests/capture/providers/registry.spec.ts` |
| G8.2 | Every extractable slot declares an ordered selector ladder; extraction uses the first non-empty candidate and records the index used in `rungs` | `npm test -- tests/capture/providers` |
| G8.3 | A missing required landmark yields `DOM_SHAPE_UNRECOGNIZED` **before any message text is produced** | `npm test -- tests/capture/providers` |
| G8.4 | No selector, landmark or adapter configuration is fetched from the network or read from `chrome.storage` | `npm test -- tests/quality/source-scans.spec.ts` |
| G8.5 | Each ladder rung has a fixture that selects it, and each provider has one unknown-shape fixture that must fail | `npm test -- tests/capture/providers` |
| G8.6 | After N consecutive typed failures for one provider the UI reports that provider's capture needs updating, naming the failing slot or rung; a success clears the state | `npm test -- tests/capture/drift.spec.ts` |
| G8.7 | A typed failure is always preferred to a wrong capture: no code path produces a partially-populated conversation as a success | `npm test -- tests/capture/providers` |
| G8.8 | Observed turn-container count must equal produced message count, else typed failure | `npm test -- tests/capture/providers` |
| G8.9 | Extraction is identical with the network unavailable | `npm test -- tests/capture/providers` |

---

## G9 — An install that completes, or says exactly what is missing

**Statement.** A person who installs the extension and wants captures to persist can reach a
working state by following instructions the product itself gives them. No state the extension can
observe is reported as a failure with no next action.

**Why this goal exists.** G1–G8 all presuppose a working state and none of them creates one. Read
as a set they describe what the extension does *once installed*, and "installed" was never defined.
That is not a cosmetic omission. It means the specification described a **component**: a person
following it would reach a working extension that stores nothing and tells them "Check that
HipCortex is running" when they never had HipCortex. A goal that owns the path from "extension
present" to "capture retained" is the difference between a component and a product, and G9 is that
goal.

**Interpretation locked.** "The extension works on its own" has two readings, and only one of them
is implementable:

| Reading | Verdict |
|---------|---------|
| The extension installs the core itself, so one install produces a working system | **Rejected — not implementable, and not a preference.** Three independent barriers, any one of which is fatal: `public/manifest.json` declares no `downloads` and no `management` permission, so no API can fetch or install software; `chrome.runtime.connectNative` *connects to* a host that is already registered and has no ability to register one; and Chrome forbids an extension silently installing external software. An extension that appeared to do this would be doing something else, and the user could not audit it |
| The extension ships the **browser half** of the loopback path, the product registers it with one command, and the extension reports which state it is in | **Chosen** |

The chosen reading is also the boundary-correct one. The missing half is the **native messaging
host**, whose registered name is `com.hipcortex.bridge` — *CortexBridge*, which `AGENTS.md` names as
**this repository's** architectural layer. The host is therefore this repo's to build, and it is a
pure transport shim: it holds no memory, makes no decisions and extracts no meaning. Building it
does not move an inch of cognition across the boundary (E5). What it does is stop Consumer Mode from
being an assumption: `docs/PROTOCOL.md` §9 has said since it was written that the envelope and the
host name were "assumed, not verified" because there was no host to verify them against.

**Falsification condition.** If the product decides that the normal target is a *hosted* HipCortex
instance rather than a local one, then E10 and G7.2/G7.3 must be amended to an explicit allow-list
with a visible, persistent notice — that is a decision for the user, not a consequence of G9. If the
core becomes installable by a single signed download requiring no terminal, G9.2's *mechanism* (a
named command) may become a named download instead. G9.1 and G9.2 themselves are not falsifiable by
convenience: a failure that names no next action is a defect whatever the transport is.

**Non-goals with reasons.**

- *Vendoring core code into the extension* — rejected: it would put cognition in this repo, which is
  the boundary `AGENTS.md` draws and decision E5 records.
- *Bundling a prebuilt core binary inside the extension package* — rejected: it requires
  `downloads`/`management`, Web Store review rejects it, and the extension would become the
  distribution channel for a separate product with its own release cadence.
- *Fetching the core from the network during install* — rejected: a silent fetch that installs
  software is precisely the unauditable egress E10 exists to prevent.
- *System-wide registration (`HKLM`, `/etc`, `/usr/local`)* — rejected: it requires elevation, and a
  product that needs an administrator prompt to record a memory is one most people will not install.
- *Declaring the install complete because the host registered successfully* — rejected: registration
  and reachability are different facts, and reporting the first as the second is the dead end in a
  new costume.

**Acceptance criteria.**

| ID | Criterion | Verification |
|----|-----------|--------------|
| G9.1 | The health surface reports three states distinctly — host not registered, host registered but core unreachable, healthy — and never collapses the first two into one message | `npm test -- tests/surfaces/connection-states.spec.ts` |
| G9.2 | Every failure state names a next action, and the not-registered state names the command that completes the install | `npm test -- tests/surfaces/connection-states.spec.ts` |
| G9.3 | Host registration is per-user, requires no elevation, and is reversible by a documented command | `npm test -- tests/host/registration.spec.ts` |
| G9.4 | The Consumer Mode contract is executed rather than assumed: a real frame on stdin is answered by a real frame on stdout, against a real HTTP core | `npm test -- tests/host/end-to-end.spec.ts` |
| G9.5 | Both install orders reach the same healthy state, and the product asserts no ordering between them | `npm test -- tests/surfaces/connection-states.spec.ts` |

---

## Live verification (executed)

These were run against a live core at `http://127.0.0.1:3030`. `/openapi.json` returned 200 with
123 paths; `/docs` returned 404. The substrate was left pristine: 7 records before the probes,
7 records after.

Re-run on 2026-09-14 against runtime 3.11.0, this time driven by the **shipped** `dist/` modules
rather than by hand. The write path was exercised end-to-end: with the core unreachable, 10 captures
were attempted, 0 delivered, all 10 retained on disk (5926 bytes); when it answered, all 10 were
delivered and `GET /memory/query?actor=…` returned `total=10`. Every write was scoped to a throwaway
actor and deleted at the end, leaving 0 records for it. That run also produced three findings that
changed this document and `docs/PROTOCOL.md` — the PII precondition below, the sharper reading of
`/memory/ingest`, and the acknowledgement/queue semantics. The full quoted output is in `tasks.md`
under 10.7.

The retention boundary was then proven against the same runtime on 2026-09-14, with the **queued
captures themselves** rather than a mock, and with the ordering G2.8 asks for: stop, capture, restart,
deliver. `hipcortex stop` exited 0 ("Process exited cleanly") and `GET /health` was unreachable; ten
conversations were then captured through `enqueueEvent` from the shipped `dist/capture/queue/`, which
reported `queued=10`; a drain against the dead core reported `delivered=0 retained=10`; an
`EXPORT_QUEUE` of that backlog returned `total=10 schema_version=1` and left the queue at `queued=10`,
so the export is non-destructive on a real queue and not only in a spec. `hipcortex start` brought the
service back, and **a single drain delivered all ten** (`delivered=10 remaining=0`). The core then
reported `10 records` for the actor, all ten still carrying `metadata["hipcortex.capture"]` and all ten
still carrying `tags` including `capture` — nothing expired, nothing was dropped, and the provenance
survived the wait intact. `DELETE /memory/forget/{actor}` returned `records_deleted:10`, so the
substrate was left as it was found.

The same run exercised the refusal path live, because the first attempt got it by accident. That
attempt used a millisecond timestamp as the probe actor's suffix; every record was refused with
`precondition blocked: PII risk=0.90 patterns=["PII:1789363055"]`, which is the PII precondition in
the table below firing on the **actor** as well as the transcript. The retry used a digit-free actor
and asked for the refusal deliberately: `delivered=0 refused=1 retrying=0`, with the runtime's own
reason string preserved verbatim and the user-facing message naming the count, the permanence of the
refusal and the fact that the capture "can still be exported"; exporting while refused returned
`total=1` with the queue still at `queued=1 refused=1`. A refusal is therefore reported as a refusal
rather than as a transient failure, and it is a state a capture can be *in* rather than a state that
ends it.

The host was then installed for real on 2026-09-14 — the first time `scripts/install-host.mjs` has
been executed rather than planned. It exited 0 and wrote `%LOCALAPPDATA%\HipCortex\bridge-host.mjs`,
a `bridge-host.cmd` launcher wrapping `C:\Program Files\nodejs\node.exe`, the host manifest, and
four HKCU keys (Chrome, Chromium, Edge, Brave). The registry was read back, and the *installed*
program was spawned the way Chrome spawns it — `reg query` → host manifest → launcher → one
length-prefixed `{"type":"health"}` frame on stdin:

```
via launcher : {"success":true,"healthy":true,"core_url":"http://127.0.0.1:3030","detail":"HTTP 200"}
direct       : {"success":true,"healthy":true,"core_url":"http://127.0.0.1:3030","detail":"HTTP 200"}
GET /health  : HTTP 200 {"service":"hipcortex","status":"ok","version":"3.11.0"}
```

Nothing was written to stderr, both routes agree, and the probe sent **no** capture, so the
substrate was untouched.

The reversibility half of G9.3 was executed too, rather than assumed from the same script:
`npm run uninstall:host` exited 0, all four HKCU keys read back as absent, and the install directory
was left with **0** files. `npm run install:host` was then run again and the probes repeated, so the
machine is left in the installed state this document describes. An installer and its reversal that
have only ever been read are the same kind of claim as a host that has only ever been planned.

That run found one real defect in the host, now fixed. An unrecognised request was forwarded to
`POST /memory/add`, the core answered `422`, and the reply read *"core replied with a body that is
not JSON (HTTP 422)"*. Nothing was stored, so the behaviour was safe — but it blamed the core for a
request the host should never have sent, and would have pointed the next reader at the wrong
repository. A capture body never carries `type` (`toAddBody`), so a `type` is always a control
message and an unrecognised one is a gap here. The host now refuses it locally, before the network,
naming the type and stating that nothing was sent; re-installed and re-probed, the live reply is
`{"success":false,"error":"unknown request type \"not-a-real-request\"…Nothing was sent to the
core."}`. This was found by running the installed artefact, not by a spec.

The extension ID is now **pinned** by a `key` in `public/manifest.json`, deriving to
`eklnpdcephecmddelagbablmeajoogkf`. It had to be: an unpacked extension's ID is derived from its path
and so was unknowable before the first load, which made `--extension-id` unsuppliable offline and the
host-first install order impossible — G9.5 would have been an assertion about a mock. Checked against
the built artefact rather than the source: `deriveExtensionId(dist/manifest.json)` equals the
`allowed_origins` entry the registered host holds, and the `key` survives `npm run build`.

That last fact is about the **unpacked** build and about nothing else, which the store made concrete:
it refuses a package whose manifest carries a `key` at all, and derives the published item's ID from a
public key it generates itself. So `npm run package` now strips the field from the archived copy
while `dist/` keeps it, because `allowed_origins` depends on it, and the two IDs are reconciled after
the first upload by replacing the `key` with the store's public key — the procedure in
`docs/STORE.md` §11. Until that replacement is made the published item's ID is unknown, and no
sentence in this repository that names `eklnpdcephecmddelagbablmeajoogkf` is a claim about it.

The migration leg was then exercised on the same runtime, and it changed what G4 says.
`GET /memory/export?actor=` returned every record with `metadata`, `priority`, `record_type` and `tags`
intact, and an actor with no records returned `{"exported_at":…,"records":[],"total":0}` — an empty
valid document, not an error. The import path was then chosen by measurement rather than by reading
its name: two imports of the same record were compared export-to-export, and `POST /memory/bulk`
answered `{success:true, inserted:1, failed:0}` while storing `tags: []`, `source: null` and
`priority: "normal"` for a record whose source stated `["capture","chatgpt"]`, `"cortexbridge"` and
`"pinned"`, where `POST /memory/add` stored all three intact. Import therefore goes one record at a
time through `/memory/add`, and G4.2 says so. The full transcript is in
`openspec/changes/substrate-migration/tasks.md` under *Live evidence*.

One capture was then delivered through the shipped egress code — `toEgressRecord` followed by
`HttpTransport.addMemory`, the pair `src/capture/pipeline.ts` calls — and read back by
`GET /memory/export`, `hipcortex backup --actor`, and MCP `search_memory`: the same three messages in
the same order with the same text, with the CLI and REST agreeing on the record id. The probe actor was
deleted afterwards (`records_deleted: 1`, 0 left). What that does **not** establish is the browser
half, since the capture was produced by the extension's own code under Node rather than by a real
provider tab — which is why G4.4's browser half is still recorded as a manual gate.

| Claim | Result |
|-------|--------|
| `POST /v1/capture/event` (assumed capture endpoint) | **404 — does not exist** among the 123 paths |
| `GET /memory/search?q=` | **405** — the route is POST-only |
| `POST /search` | **404** — dead ladder branch |
| `GET /memory/query?query=` | **405** — GET-only, and its real parameters are `actor`, `action`, `record_type`, `limit`, `as_of` |
| `POST /memory/add` with tags, priority and nested `metadata` | **200** `{"success":true,"record_id":"e6a9cdf1-…"}` |
| Read back that record | `priority="pinned"`, `tags=["capture","chatgpt"]`, `source="cortexbridge"`, full `metadata["hipcortex.capture"]` object, `expires_at=null` — **nothing dropped** |
| `POST /memory/ingest` with 5 provenance fields | 200, but read-back showed `metadata={"session_id":…}` (all 5 destroyed), `action="noted"`, `record_type="Temporal"`, `ttl_seconds=86400` |
| Provider filter, positive | `action=capture%3Achatgpt` → exact match; `record_type=Perception` → exact match |
| Provider filter, negative controls | `action=__no_such_action__` → 0; `actor=__no_such_actor__` → 0 |
| `as_of` time travel | `2000-01-01` → 0 records; `2030-01-01` → 1 record |
| Same capture sent twice | **2 records** — no merge, so the duplicate-overwrite retention risk is **closed** |
| Export → strip `id`/`integrity` → `POST /memory/bulk` | `{success:true, inserted:1, failed:0}` and **three fields lost**: `tags` → `[]`, `source` → `null`, `priority` → `"normal"`; `action`, `actor`, `record_type` and `target` survive, `metadata` survives deep (key order only), `id` and `integrity` **regenerated** |
| Strip → `POST /memory/add` (the import path) | `{success:true, record_id:"…"}`; **nothing lost** — `tags`, `source` and `priority` read back exactly as posted and `metadata` is deep-equal |
| A bare array body to `POST /memory/bulk` | `422` `invalid type: map, expected a sequence` — the endpoint does not accept the record list it is named for |
| One capture read back three ways: `GET /memory/export`, `hipcortex backup`, MCP `search_memory` | 3 messages, same order, same text on all three; CLI and REST agree on the record id; each throwaway actor left with 0 records |
| `GET /memory/search` response shape | members are `{score, record}` — **wrapped** |
| `GET /memory/search-flat` | `{"memories":["[action] target", …]}` — plain strings, **no metadata** |
| `GET /memory/query?actor=…` after 10 captures through the shipped pipeline | `{"records":[…],"total":10}` |
| `POST /memory/add` with a clean transcript | 200 `{"success":true,"record_id":"3460cc8d-…"}` — acknowledged |
| Same endpoint, transcript containing a 10-digit run, a dashed phone number or an email | **403** `{"success":false,"error":"precondition blocked: PII risk=0.90 patterns=[…]"}` — deterministic, so a retry never succeeds |
| `POST /memory/ingest` re-probe | 200 while fabricating `action:"noted"`, `record_type:"Temporal"`, `ttl_seconds:86400`, `working_memory:true`; `text` is its only required field, and a body with no `context` and no `session_id` is accepted |
| `DELETE /memory/forget/{actor}` | `{"success":true,"records_deleted":12,…}` — the throwaway actor was left with 0 records |

---

## Decision log

Decisions made here without further consultation, each with the condition that would overturn it.

| # | Decision | Rationale | Falsified if |
|---|----------|-----------|--------------|
| E1 | Retention stays in the core; the extension guarantees acknowledged delivery only | The boundary forbids memory here; two stores would diverge with no reconciliation rule | The product later promises browser-local memory |
| E2 | Drop-oldest is removed from the queue | It converts an outage into permanent, invisible data loss | A hard storage ceiling exists that cannot be raised and cannot lose data another way |
| E3 | Provenance must survive egress as discrete versioned fields | Provider is the query dimension every cross-provider criterion depends on; flattening it blocks G3 permanently | Nothing — this is a prerequisite, not a preference |
| E4 | Capture unit is the conversation | A fragment cannot be reasoned over and cannot be deduplicated | Providers are observed to expose only ephemeral fragments |
| E5 | The extension extracts no cognition | Boundary in `AGENTS.md` | The boundary is formally revised by the user |
| E6 | Federated live provider query is a non-goal | No unauthenticated provider API; results would be unverifiable | A provider publishes an official conversation API |
| E7 | `POST /memory/ingest` is **forbidden** for capture; `POST /memory/add` is the only egress | Ingest returned 200 while destroying all five provenance fields and setting a 24 h TTL — a silent-success data-loss path | Ingest is fixed to preserve `metadata` and to honour `ttl_seconds: null`; even then the change must be re-verified against the live runtime before use |
| E8 | An acknowledgement requires `success === true` **and** a non-empty `record_id`; a bare 2xx is a failure | E7 is the proof that a 2xx is not evidence of storage | Never — this is a prerequisite |
| E9 | `hipcortex.capture` is the single reserved provenance key holding a versioned object | It is the cross-repo contract for the provider query dimension; flattening provenance to text blocks every G3 criterion (E3) | The core documents an equivalent, differently named contract first |
| E10 | `host_permissions` holds loopback origins only; non-loopback egress needs a named confirmation plus a persistent banner | An editable `apiUrl` plus a pre-authorised remote host made one field change into silent exfiltration of every captured conversation | A hosted deployment becomes a first-class target — then amend to an allow-list (G7.2/G7.3), never delete |
| E11 | Adapters resolve selectors from compiled code only; no remote or stored configuration | A remote config is both a bypass of E10 and a single point of failure that can break all five providers at once | Drift becomes so frequent that releases are impractical — and only with signing, version pinning and UI visibility |
| E12 | A typed extraction failure is always preferable to a wrong capture | A wrong capture is indistinguishable from a correct one downstream and contaminates the substrate | Nothing — this is the invariant that makes G8 meaningful |
| E13 | The native messaging host ships from **this** repo, and installation is a documented command rather than an extension-installed core | Chrome cannot install software: no `downloads`/`management` in the manifest, `connectNative` cannot register a host, and policy forbids silent install. The host is named `com.hipcortex.bridge` — CortexBridge, this repo's own layer per `AGENTS.md` — and is a transport shim that holds no cognition, so building it does not move the E5 boundary | The core becomes installable by one signed download needing no terminal (then G9.2's mechanism changes, not its requirement), or the product adopts a hosted target (then E10 and G7.2/G7.3 are amended to an allow-list, never deleted) |

## Open risks

1. **G5's core-side behaviour is still unspecified.** The extension→core *endpoint* is now pinned
   (`docs/PROTOCOL.md`, decision E7), but nothing states whether a captured `Perception` record
   feeds memory/entity/belief derivation, or how long it is retained. Capture can therefore
   succeed end-to-end and still produce no usable cognition. This remains the largest product-side
   gap because it sits between two repositories and neither owns it.
2. **Consumer Mode's framing is now executed; the Chrome-registered leg is still unrun.** Narrowed
   on 2026-09-14 by building the host (`host/bridge-host.mjs`) and its installer
   (`scripts/install-host.mjs`), and by exercising the envelope end-to-end in
   `tests/host/end-to-end.spec.ts`: a real length-prefixed frame written to the host's stdin is
   answered by a real frame on stdout, against a real HTTP core. That retires the "assumed, not
   verified" sentence in `docs/PROTOCOL.md` §9 for every step except one — no spec can prove that
   **Chrome itself** connects to a registered host, because that needs a loaded extension in a real
   browser. Registration is machine-checked only as a *plan*: `tests/host/registration.spec.ts`
   asserts the exact bytes an install would write and deliberately never writes them. That gap was
   closed on one machine on 2026-09-14: the host is registered under HKCU for four browsers, the
   registry reads back, the installed launcher answers a health frame against the live core, and the
   build's derived extension ID matches the origin the host allows. What remains unrun is narrower
   and only Chrome can run it — handing the port to a loaded extension and delivering a real
   capture — so this risk stays open, reduced rather than retired.
3. **G3's secondary mechanism (offline provider search) has no change yet.** It needs a
   follow-up change (`cross-provider-search-index`) with a local index and its own retention rule,
   which must not become a second substrate.
4. **The gates prove this repository's behaviour, not the product's behaviour in a browser.** As of
   2026-09-14 the chain exits 0 — typecheck, lint, 54 files / 832 tests, build, and traceability at
   67/67 criteria cited by 56 requirement headings — and the end-to-end round trip passed: 10
   captures retained while the core was absent, 10 delivered when it returned, the provider filter
   exclusive, and the throwaway actor deleted afterwards. Quoted output is in `tasks.md` groups 9
   and 10. That is a real advance, and it stops short of the product: the two browser-manual gates
   (8.12, 8.13) are unrun, Consumer Mode has no host (risk 2), the POSIX leg of the scripts is
   unrun (10.13), and no spec can observe a rendered banner or a provider's live DOM. A criterion is
   still met only when its verification has been run and its output quoted — that rule did not relax
   when the results turned green.
5. **Semantic search plus a provider filter is not expressible against today's runtime.**
   `POST /memory/search` has no filter field. Tracked cross-repo as
   `core: add filter to POST /memory/search`. The UI must not imply this combination works.
6. **The runtime can refuse a capture permanently, and today that is indistinguishable from a
   transient failure.** `POST /memory/add` runs a PII precondition that answers `403` when the
   transcript contains a phone number or an email address, so a refused capture is retained and
   retried forever while the queue reports it through the same `reasons` list as a network failure.
   Nothing is lost — that part of G2 holds — but the user cannot tell "wait" from "this will never
   work". Owned by `cortexbridge-retention-boundary`, not by this change. Deliberately **not**
   mitigated by filtering, redacting or rewriting the user's text to get past the precondition: the
   extension's job is to deliver what was said and to say plainly when it could not.

## Closed risks

Recorded so they are not re-opened as if unresolved:

- **A stale committed `dist/` could mask a failed build.** *Closed by verification:* `git ls-files
  dist` returns nothing on 2026-09-14, `dist/` is ignored, and `tests/quality/gates.spec.ts` asserts
  that no built artifact is tracked — so the condition cannot quietly return.
- **Duplicate captures could overwrite the original.** *Closed by probe:* sending the same capture
  twice produced two records. The runtime does not merge.
- **The G3 provider filter required a core change.** *Closed by probe:* `GET /memory/query`
  already filters on `action` and `record_type`, both provider dimensions, with negative controls
  confirming the filter is real and not ignored.
- **`cognitive_report` showing `active_goals: []` meant writes were failing.** *Closed by probe:*
  memories live in the memory store, independent of the goal/belief store; `/memory/query` found
  every written record. Not a defect.
