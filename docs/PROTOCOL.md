# CortexBridge ↔ HipCortex Protocol

This document is the **contract** between this repository (CortexBridge, the browser perception
layer) and the HipCortex core (`/server`, a separate repository). It is normative: where code and
this document disagree, this document is the specification and the code is the defect.

Every network claim in §1–§7 was **verified against a live runtime** at `http://127.0.0.1:3030`, not
inferred from documentation. `/openapi.json` returns 200 and advertises 123 paths; `/docs` returns
404. Verify commands and raw evidence are recorded in `docs/END-STATE.md`.

**Two sections are explicitly *not* verified and say so.** §8 lists runtime questions that were
never probed, and §9 describes Native Messaging, which cannot be verified until a desktop host
exists. The distinction is load-bearing: this document's value comes from being smaller than
reality in exactly the places where reality was observed, so anything assumed is marked assumed
rather than left to read as fact.

## 1. Versioning

| Item | Value |
|------|-------|
| `SCHEMA_VERSION` | `1` — exported as a literal type from `src/schema/version.ts`; carried in `schemaVersion` on every event **and** inside the reserved metadata object |
| Supported capture versions | `[1]` — any other value fails validation with `UNSUPPORTED_VERSION` |
| Contract version | `1` — this document |
| Reserved metadata key | `hipcortex.capture` |
| Capture actor | configured `defaultActor` (default `browser-user`) |
| Native Messaging host | `com.hipcortex.bridge` — **assumed**, see §9 |

A required-field addition is a breaking version bump. The core MUST accept a record whose
`metadata` object contains an unrecognised `schemaVersion` without destroying the rest of the
record.

## 2. Determinism rules

These two rules exist because both were violated in the first draft of this change.

1. **No endpoint may be listed here that has not been executed at least once against a live
   runtime.** An endpoint that "should" exist is worse than a missing one: a 404 is honest, a
   ladder of 404s looks like a transient failure and hides the misconfiguration.
2. **A 2xx is not a delivery.** Delivery is acknowledged only on positive evidence (§5).
   `POST /memory/ingest` returns HTTP 200 while destroying the payload, and that is the reason
   this rule is written down.

## 3. Capture egress — `POST /memory/add`

**This is the only correct capture egress.** Request body:

| Field | Value | Notes |
|-------|-------|-------|
| `actor` | configured `defaultActor` | scope |
| `action` | `capture:<providerId>` | e.g. `capture:chatgpt`. Server-side filterable — **verified** |
| `record_type` | `Perception` | "is a browser capture". Server-side filterable — **verified** |
| `source` | `cortexbridge` | producer identity |
| `target` | full conversation transcript | the field the runtime indexes for semantic search |
| `tags` | `["capture", "<providerId>"]` | persists — **verified** |
| `metadata` | `{ "hipcortex.capture": { ...provenance } }` | persists intact — **verified** |
| `priority` | `"pinned"` when the record carries one, **omitted** otherwise | capture egress never sets one; an imported record may carry the field the export states. A posted `priority` round-trips — **verified** 2026-09-14 (posted `"pinned"`, read back `"pinned"`; a record posted without one reads back `"normal"`, so omitting it stays omission rather than an invented default) |
| `ttl_seconds` | **omitted** | omitting it yields `expires_at: null` (permanent) — **verified** |

The reserved metadata object:

```json
{
  "hipcortex.capture": {
    "schemaVersion": 1,
    "provider": "chatgpt",
    "adapterVersion": "1.0.0",
    "source": "cortexbridge",
    "conversationUrl": "https://chatgpt.com/c/abc",
    "eventId": "3f1c...",
    "capturedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

Verified round-trip: an add carrying `tags`, `priority` and the reserved metadata object was
written (HTTP 200, `record_id` returned), read back via `GET /memory/query`, and every field was
present — including the nested metadata object — with `expires_at: null`.

### 3.1 Forbidden: `POST /memory/ingest`

`/memory/ingest` accepts only `{ actor, context, session_id, text }` where `context` is one of
`meeting | code | chat | sensor | decision`. It has **no `metadata` field**. Verified behaviour
when sent five provenance fields:

```
sent   metadata = { schemaVersion, provider, adapterVersion, conversationUrl, eventId }
returned HTTP 200 { "record_id": "...", "record_type": "Temporal", "ttl_seconds": 86400, ... }
read back metadata = { "session_id": "probe-session" }      ← all five fields destroyed
read back action = "noted", record_type = "Temporal"        ← server defaults replaced ours
```

Two independent failures: the provenance is discarded, and `ttl_seconds: 86400` means the captured
conversation is deleted after 24 hours. Using this endpoint would produce a capture that looks
successful and is gone tomorrow. A gate asserts `/memory/ingest` appears nowhere under `src/`.

Re-probed 2026-09-14 against 3.11.0, and the endpoint is even laxer than the above suggests: `text`
is the only field it requires — omitting it is the single input that errors (`422`, "missing field
`text`"). A body with no `context` and no `session_id` is accepted and still fabricates
`{ "action": "noted", "record_type": "Temporal", "ttl_seconds": 86400, "working_memory": true }`.
There is no body that makes this endpoint preserve what a caller sends, so "it returned 200" is not
evidence of anything.

### 3.2 Known refusals of the capture endpoint

`POST /memory/add` is not unconditional. The runtime applies **two** preconditions before it writes
and refuses the **whole record** when any field matches one, and each refusal names the pattern it
matched. The PII one was verified 2026-09-14 against 3.11.0, one probe per row; the PHI one was
found on 2026-09-19 and is recorded here for the first time:

| Field carrying the pattern | Response |
|----------------------------|----------|
| `actor` with a 10-digit run | `403 {"success":false,"error":"precondition blocked: PII risk=0.90 patterns=[\"PII:1789355714\"]"}` |
| `target` with a dashed number-like token | `403 ... patterns=["PII:415-555-0134"]` |
| `target` with a bare 10-digit run | `403 ... patterns=["PII:4155550134"]` |
| `target` with an email address | `403 ... patterns=["PII:someone@example.com"]` |
| a transcript matching no pattern | `200 {"success":true,"record_id":"3460cc8d-5d35-4faf-9b33-ca27852e4765"}` |

**The dashed row is not phone-shaped, and there is a second precondition that is not about numbers at
all.** Re-probed 2026-09-19 against the same runtime, one token varied per probe with every other
byte of the request held constant. Read with `curl.exe`, which returns the refusal body; the MCP
client surfaced the same refusals as a bare `403` with no body at all:

| `target` holding | Digits | Response |
|------------------|--------|----------|
| `123456` | 6 contiguous | `200` — stored |
| `1234567` | 7 contiguous | `200` — stored |
| `12345678` | 8 contiguous | `200` — stored |
| `123456789` | 9 contiguous | `200` — stored |
| `1234567890` | 10 contiguous | `403` — `PII:1234567890` |
| `12345678901` | 11 contiguous | `403` |
| `+1234567890` | 11 with a leading `+` | `403` |
| `415-555-0134` | 3-3-4 | `403` — `PII:415-555-0134` |
| `123456-123456` | 6-6 | `403` — `PII:123456-1234` |
| `12345678-123456` | 8-6 | `403` — `PII:345678-1234` |
| `2026-09-19` | 4-2-2 | `200` — stored |
| `12345-6789` | 5-4 | `200` — stored |
| `123456789-0` | 9-1 | `200` — stored |
| `1-2-3-4-5-6-7-8-9-0` | ten groups of one | `200` — stored |

The pattern literals in that last column are the ones the runtime printed, and they carry the rule
better than a guessed expression would. The contiguous threshold is exactly ten digits — nine
stores, ten does not. And the dashed form is wider than a phone number: the runtime reports
`PII:123456-1234` for a 6-6 token and `PII:345678-1234` for an 8-6 token, so it consumes ten digits
*including* the separators between them and slides along a longer run to find them, while a 4-2-2
date, a 5-4 pair and a 9-1 pair are not matched at all. A fixture built to a phone number is
narrower than the predicate.

**The second precondition is PHI, it is keyed on a code shape, and it is case-sensitive:**

| `target` holding | Response |
|------------------|----------|
| an upper-case letter and exactly two digits, delimited on both sides | `403 {"success":false,"error":"precondition blocked: PHI risk=0.85 patterns=[\"PHI:E13\"]"}` |
| the same token with a decimal extension | `403 ... patterns=["PHI:E13.9"]` |
| the same with the letter lower-case | `200` — stored |
| an upper-case letter and one digit | `200` — stored |
| an upper-case letter and three digits | `200` — stored |
| two letters then two digits | `200` — stored |

Read those literals as the evidence. The runtime refused an upper-case letter followed by exactly two
digits when the token stood alone between non-word characters, refused the same token with a `.9`
suffix and reported it whole, and stored the lower-case form, the one-digit form, the three-digit
form and the two-letter form. The three-digit case is the sharpest: a letter plus two digits is
refused and the same prefix followed by a third digit is stored, so the match is delimited rather
than a prefix. No regular expression is asserted here — the payloads are.

Two consequences of the PHI predicate matter more than the PII one, because a two-digit code is
ordinary conversational text where a phone number is not:

- **This repository cannot store a memory that quotes its own section numbers.** `docs/END-STATE.md`
  has a section `E13`, for the host registration work, and a record naming it is refused. Measured
  rather than inferred: the same note written twice was refused twice, and the third attempt with
  that single reference removed stored on the first try.
- **The predicate is code-shaped, not semantic.** `COVID-19` stores, so it fires on codes and misses
  disease names — the opposite of what a reader would guess, and the reason a health-adjacent
  conversation can be refused for a token that carries no health information at all.

**The refusal is not length-shaped.** A body of two thousand one hundred and sixty characters
holding no matching token stored, and the identical body with an 8-6 token appended was refused
`PII`.

**A stored record can still carry a warning.** A successful write returned
`"warning":[{"action":"noted","id":"…","overlap_ratio":66,"target":"…"}]` — a near-duplicate
advisory naming the record it overlaps and a percentage. It does not reject the write and it does not
merge: the record was stored and the earlier one was untouched. That refines, and does not
contradict, the closed risk in `docs/END-STATE.md` that the runtime does not merge duplicates.

**It reaches this repository's own identifiers.** A run id has the shape
`run-YYYYMMDD-HHMMSS-xxxxxx`, and `YYYYMMDD-HHMMSS` is the 8-6 form refused above, so no record
quoting one can be stored. Measured: `POST /memory/add` answered `200` for a probe whose text held
no such token and `403` for the same text carrying one, with actor, action and record type
unchanged. Every probe actor was deleted afterwards, the last reporting `records_deleted: 2` against
exactly two records present.

Two consequences, neither of which is a reason to change what the extension sends:

1. `success: false` means **not acknowledged** (section 5), so a capture refused this way stays in the
   queue — and because the refusal is deterministic, retrying it never succeeds. **Implemented by
   `cortexbridge-retention-boundary` task 5.2**: the refusal is a value of its own (`kind: "refused"`
   on the send result), it is counted apart from a transient failure, and the runtime's own `error`
   string is shown to the user verbatim next to the capture it belongs to. A refused capture is never
   reported as lost, is never removed, and is still exported by `EXPORT_QUEUE`.
2. A captured conversation is the user's own text, and a phone number or an email address in it is
   ordinary. The extension SHALL NOT pre-filter, redact or rewrite a capture to get past this
   precondition: that would be the perception layer deciding what a memory is. The refusal is
   recorded here, not worked around in `src/`.

## 4. Retrieval — two mechanisms, not one

| Need | Endpoint | Notes |
|------|----------|-------|
| Semantic search | `POST /memory/search` `{query, limit, embedding}` | **No filter field exists.** Response members are `{ score, record }` — wrapped, not bare records |
| Structured filter | `GET /memory/query?actor=&action=&record_type=&limit=&as_of=` | The only server-side filter |

**Provider filtering (verified with negative controls):**

```
GET /memory/query?actor=hipcortex_memory_chrome_extension   → 3 records
GET /memory/query?actor=__no_such_actor_probe__             → 0 records
GET /memory/query?action=decided                            → 2 records
GET /memory/query?action=__no_such_action__                 → 0 records
GET /memory/query?action=capture%3Achatgpt                  → exact match
GET /memory/query?record_type=Perception                    → exact match
```

`as_of` is genuine time travel, not ignored: `as_of=2000-01-01` → 0 records,
`as_of=2030-01-01` → 1 record.

**Read paths that must not be used where provenance matters:**

- `GET /memory/search-flat?query=&limit=` returns `{"memories":["[action] target", ...]}` — plain
  strings with **no metadata**. Lossy; unusable for anything provenance-aware.
- `GET /v1/memory/:id/provenance` is **not** capture provenance. It returns `{chain:[], depth:0}`
  — causal lineage. A name collision, not a feature.

**The one remaining gap.** "Semantically similar messages from provider P only" is not
expressible: `POST /memory/search` has no filter and `GET /memory/query` has no semantic scoring.
Tracked cross-repo as `core: add filter to POST /memory/search`. Until then the UI must present
filtered retrieval as the structured path and MUST NOT imply the semantic path can be filtered.

## 5. Acknowledgement

```
POST /memory/add → 200 { "success": true, "record_id": "<uuid>", "error": null }
```

**A delivery is acknowledged only when the response body parses to `success === true` AND carries
a non-empty `record_id`.**

- HTTP 200 with no `record_id` → **not acknowledged**; the queue entry is retained.
- A non-empty `warning` array is the runtime's duplicate advisory
  (`[{action, id, overlap_ratio, target}]`) and does **not** fail the delivery.
- A dropped entry is impossible: the queue is acknowledged-delivery, so reaching a spill limit
  pauses and reports rather than discarding (`docs/END-STATE.md` G2).

## 6. Other verified endpoints

| Endpoint | Verified behaviour |
|----------|--------------------|
| `GET /health` | accepts a plain `ok` body or a JSON body |
| `POST /memory/bulk` `{records:[...]}` | `{success, inserted, failed, record_ids, errors}`, with `record_ids` in request order — **not the import path.** Measured 2026-09-14 on 3.11.0 by two writes to two actors and an export-to-export comparison (`.scratch/probe-bulk-fields.mjs`): `tags` → `[]`, `source` → `null`, `priority` → `"normal"` where the source said `"pinned"`, while `action`, `actor`, `record_type` and `target` survive and `metadata` survives deep (only the serialised key order changes). `inserted: 1`, `failed: 0` and `errors: []` announce none of it. A bare array body is `422` (`invalid type: map, expected a sequence`), so the `{records:[...]}` envelope is the only accepted one. Use `POST /memory/add`, one record at a time (section 6.1) |
| `GET /memory/export?actor=` | `{exported_at, records, total}`; record keys include `id`, `integrity`, `metadata`, `priority`, `record_type`, `tags` |
| `GET /memory/live_beliefs?actor=&limit=` | belief store; may legitimately be empty while the memory store is not |
| `GET /memory/latest?actor=&action=&limit=` | most recent records |
| `GET /memory/neighbors/:id` | graph neighbours |
| `PATCH /memory/update/:id` `{target, confidence?}` | `{success:true, record_id, version, error:null}` |
| `DELETE /memory/forget/{actor}` | `{success, actor, records_deleted, ..., deleted_ids}` |
| `POST /memory/consolidate?actor=&threshold=&dry_run=` | `{archived, clusters_found, duplicates_found, mutated, ...}` — `dry_run:true` observed to make no mutation |

### 6.1 Import regenerates identity, and goes through `POST /memory/add`

Export → the reader drops the core-owned fields → `POST /memory/add`, one record per request →
`{success:true, record_id}`. The id that comes back is **not** the id in the document: `id` and
`integrity` are core-owned and this repository's reader removes them before the record is built, so
the runtime mints a fresh identity on every import. Therefore the correct import guarantee is
**field-equivalent with a recorded `id` remap** — "byte-equivalent" is false and must not be
claimed, and any reference that named the old id has to be resolved through that remap.

Whether the runtime would *honour* a caller-supplied `id` was never probed and is not relied on;
see section 8.

The probe also established that `/memory/bulk` is **not** a usable import path. Measured
2026-09-14 on 3.11.0, one record per write path, compared export-to-export rather than from either
write response: the bulk write reported `inserted: 1, failed: 0, errors: []` and the stored record
had `tags: []` where the source had `["capture","chatgpt"]`, `source: null` where the source had
`"cortexbridge"`, and `priority: "normal"` where the source had `"pinned"`. The same record posted
to `/memory/add` came back with all of them intact. So the extension's import posts **one record at
a time to `POST /memory/add`** — the same endpoint captures already use, so an imported record makes
exactly the trip a capture makes and the fields that survive are the fields the runtime already
proved it keeps.

Two consequences the importer must respect:

- **`metadata` must be compared deeply, never as a string.** A probe that diffed the returned
  `metadata` as text reported a difference where there was none: the runtime re-serialises the
  object with a different key order. The round-trip property is deep equality.
- A refused record (section 3.2) must be reported as refused, not as "imported". The refusal is the
  runtime's decision and re-posting it changes nothing.

### 6.2 Duplicate captures are both retained

Sending the same capture twice yields two records; the runtime does not merge. The second response
carries a `warning` advisory. This means the retention risk of "a duplicate capture overwrites the
original" is **closed** — but it also means dedup is the extension's problem if it ever matters,
and it must never be achieved by discarding an unacknowledged capture.

### 6.3 The export document — one shape, two producers (no network call)

Both exports the extension can take — the **undelivered queue** (`EXPORT_QUEUE`, "export the
captures the runtime has not acknowledged") and an actor's **stored records** (a core
`GET /memory/export` reply the user re-saved) — are rendered into one document by
[`src/schema/export-document.ts`](../src/schema/export-document.ts), and one reader accepts it:

```jsonc
{
  "schema_version": 1,          // present, and named: a reader version-decides without guessing
  "exported_at": "<ISO 8601>",
  "actor": "browser-user",     // the actor the document covers, or null for a mixed document
  "records": [ { "actor", "action", "target", "record_type", "source", "tags", "priority", "metadata" } ],
  "total": 1
}
```

Rules the contract enforces, each because the alternative was a silent wrong answer:

- **A version mismatch refuses the whole document, naming both versions.** Importing part of a file
  whose rest was written by a newer build is not a partial success, it is a partial memory.
- **A core-owned field (`id`, `integrity`, `status`, `version`, `timestamp`, `expires_at`,
  `confidence`) is accepted and dropped, and that is *noted*.** The runtime regenerates identity
  (section 6.1), so carrying these through would produce an import that claims an identity it does
  not own.
- **An unknown field refuses the record, naming it.** A field the writer meant something by and the
  reader does not understand is the one case where guessing is indefensible.
- **All failures are collected, not just the first.** A user fixing a hand-edited file should learn
  everything wrong with it in one pass.
- **An absent `schema_version` is read as 1 and said so** (`VERSION_DEFAULTED`). A note is not a
  failure; a silent default is.

**A raw core export is the sub-shape this reader accepts, and it states neither a version nor an
actor.** Measured 2026-09-14: `GET /memory/export?actor=` and the CLI's `hipcortex backup` both return
exactly `{exported_at, records, total}` — no `schema_version`, no `actor` (`.scratch/cli-read.json`).
So a re-saved core reply imports with `VERSION_DEFAULTED` and `actor: null`, the latter because the
rule above makes a document whose records do not name the document's actor a mixed one. That is why the
importer takes the actor it stamps from the settings rather than from the file. The same dump is what
the cross-surface check in section 6.4 reads.

**A queued capture exports as the record the transport would have posted.** The record is
`toEgressRecord(event, actor)` — the same function `POST /memory/add` is fed from — so the file a
user exports and the request the runtime would have received carry the same fields, the same
`record_type: "Perception"`, the same `tags`, and the same provenance under the reserved
`metadata["hipcortex.capture"]` key. The queue's own bookkeeping (`outcome`, `refusalReason`,
`attempts`, `nextAttemptAt`) is **not** exported: a retry verdict is this extension's opinion about a
send, not part of the record.

**`actor` is the actor delivery would use, not a recorded fact about the capture.** A queued capture
has not been stamped yet — the actor is applied at send time from the user's `defaultActor` setting
— so the export names the actor the drain would stamp, which is what makes an imported record
retrievable under the same name as a delivered one. The document says this by being an `actor` field
on the export and nothing in the record; a document whose records disagree with its `actor` is a
mixed document and must say `null`.

**The export is non-destructive by construction.** Nothing in the export path writes the queue: no
acknowledgement, no "exported" marker, no removal. An entry the user has exported is still an entry
that will be delivered, so exporting a backlog and the runtime coming back are not two competing
futures. This is asserted, not assumed — the spec exports a full queue, then delivers it, and
requires every entry to arrive exactly once (`tests/capture/queue-export.spec.ts`).

### 6.4 One capture, three reads, the same messages

Measured 2026-09-14 on 3.11.0 (`probe-crosssurface.mjs` delivered the record, `compare-crosssurface.mjs`
compared the reads). One capture was sent through this repository's own egress path — `toEgressRecord`
then `HttpTransport.addMemory`, the pair `src/capture/pipeline.ts` calls — to a throwaway actor, and the
record was read back three ways: `GET /memory/export`, the CLI's `hipcortex backup --actor`, and MCP's
`search_memory`. All three yielded the **same three messages, in the same order, with the same text**;
the CLI and REST reads agreed on the record id, and MCP's rendered text was character-for-character the
`target` those two carried.

What this does **not** establish is the browser half. No spec in this repository can make a real
provider tab emit a capture, so the record was produced by the extension's egress code executed under
Node against a fixture conversation. That an actual ChatGPT or Claude page produces an event the same
code accepts is the part a human confirms by loading `dist/` unpacked, and it stays unchecked in the
plan until someone does.

Two surface differences are worth recording because they are not defects but they do change what a
reader can rely on: the CLI's read is `hipcortex backup`, an operator dump to a file, and there is no
`recall` or `search` subcommand; and MCP's `search_memory` returns rendered text, without the record id.
The text is what "retrievable unmodified" means, and the id is available from the REST read, so neither
weakens the result.

## 7. What the core still owns

The extension does not implement, and must not grow, any of: consolidation, belief formation,
goal tracking, causal lineage, embeddings, or retention policy. `/memory/consolidate`,
`/memory/live_beliefs` and `/v1/causal/*` are core surfaces; the extension may call them at most
as pass-through UI, and this change calls none of them.

## 8. Known unverified items

Stated so they are not mistaken for guarantees:

- Whether `POST /memory/add` or `POST /memory/bulk` honours a caller-supplied `id`. The importer
  never posts one — `id` is core-owned and the reader drops it — so nothing depends on the answer;
  the remap in section 6.1 exists precisely because the extension does not get to choose the identity.
- Whether `/memory/consolidate` mutates when `dry_run` is false (only the dry run was observed).
- Chrome's own handoff of a registered host port to a loaded extension. The host, the framing, the
  envelope and the registration are all executed; this one leg needs a real browser with the
  extension loaded, which no spec in this repository can supply. Detailed in §9.

## 9. Native Messaging — executed, with one leg unrun

Consumer Mode speaks to a host process over Chrome Native Messaging. The host is
[`host/bridge-host.mjs`](../host/bridge-host.mjs) in **this repository**, and `npm run install:host`
registers it as `com.hipcortex.bridge` for the current user; `npm run uninstall:host` reverses it.
The name is this repository's own choice — `com.hipcortex.bridge` is *CortexBridge*, the browser layer
`AGENTS.md` names — rather than an assumption about a third-party installer, which is what it was
when this section previously read "assumed, not verified".

| Item | Value | Status |
|------|-------|--------|
| Host name | `com.hipcortex.bridge` | verified — written by the installer and read back by `tests/host/registration.spec.ts` |
| Registration | per-user, no elevation; Chrome, Chromium, Edge and Brave recorded | verified — `tests/host/registration.spec.ts` |
| Framing | 4 bytes little-endian `uint32` length, then UTF-8 JSON | verified — `tests/host/framing.spec.ts`, including one frame delivered in one-byte chunks, a truncated frame, and a frame larger than a single write |
| Request shape | one JSON object per message: a `CaptureEvent` per §3 | verified — `tests/host/end-to-end.spec.ts` writes a real frame on the host's stdin |
| Response shape | one JSON object per message: `{ success, record_id?, error?, warning? }` | verified — a real frame comes back on stdout carrying the core's own `record_id` |
| Health request | `{ "type": "health" }` → `{ success, healthy, core_url, detail }` | verified — `tests/host/framing.spec.ts`; it reads `GET /health` and writes nothing |
| Acknowledgement rule | §5 applies unchanged — `success === true` **and** a non-empty `record_id` | verified for HTTP and for the native envelope — `tests/api/native.spec.ts`, `tests/surfaces/connection-states.spec.ts` |
| Identity | for an extension loaded from `dist/`, the ID is `eklnpdcephecmddelagbablmeajoogkf`, pinned by a `key` in `public/manifest.json`; `allowed_origins` holds exactly `chrome-extension://<that id>/` | verified — `deriveExtensionId(dist/manifest.json)` equals the origin the registered host manifest holds. Pinning is a prerequisite rather than a preference: without it the ID is path-derived and unknowable before the first load, so the host could never be registered first. **This covers the unpacked build only.** The store refuses a package whose manifest carries `key` at all and assigns the published item an ID from a public key it generates, so a store installation needs that `key` replaced and the host re-registered — no probe below establishes the store item's ID |

Chrome length-prefixes each message itself and translates between the wire and the host process, so
the framing is Chrome's business. The host re-implements the same rule at its own stdio boundary
anyway, because a rule that can be executed by a spec is worth more than a rule that is trusted — and
that is how the framing above is verified rather than assumed.

**The health request.** It exists because "the port opened" and "the core is up" are different facts,
and reporting the first as the second made a stopped core look healthy. The request is deliberately
side-effect-free: it is a `GET /health`, never a write. A health check that writes is a health check
nobody can run.

**Design consequence.** The acknowledgement rule is implemented once, in the transport layer, and both
transports are held to it. A host that answered with a different envelope would be one adapter away
from correct, and the failure mode would be "the entry stays unacknowledged" — the safe direction —
rather than "the capture was silently dropped".

**The one leg no spec in this repository can run.** Nothing here has observed **Chrome itself**
resolving a registered host and handing the port to a loaded extension. The specs substitute the
browser's native-messaging layer and execute the host as a spawned process; whether Chrome accepts
the manifest, the permission and the port is a property of a loaded extension in a real browser.

Everything on this side of that boundary was executed on one machine on 2026-09-14. `npm run
install:host` exited 0; `reg query HKCU\Software\Google\Chrome\NativeMessagingHosts\com.hipcortex.bridge`
resolved to a host manifest; and the **installed** launcher — spawned the way Chrome spawns it, a
`.cmd` through `cmd.exe` — answered a length-prefixed `{"type":"health"}` frame with
`{"success":true,"healthy":true,"core_url":"http://127.0.0.1:3030","detail":"HTTP 200"}` and
nothing on stderr, giving the same answer as the host file invoked directly. Consumer Mode is
therefore **installed and answering, browser leg unrun** — not "assumed", as it was before, and not
fully verified either.

**An unrecognised control message is refused here, not forwarded.** A capture body is exactly
`toAddBody(record)` and never carries `type`, so a `type` is always a control message; the only one
the host implements is `health`. Anything else is answered locally with
`{ success: false, error: "unknown request type …" }` and **no request is made**. This was added after
a live run in which an unknown type was posted to `/memory/add`, the core answered `422`, and the
reply blamed the core's response body — a wrong diagnosis pointing at the wrong repository, which is
worse than no diagnosis when the two systems live in separate codebases. Refusals precede the
network so that a malformed message can never become a write.

**Nothing has been run against the HipCortex Desktop app.** This host is this repository's own, and the
core it forwards to is reached over loopback HTTP. If a future release of the desktop app registers
the same name, both registrations occupy the same per-user key and only one can win; that is a
decision for whichever release ships it, not a fact established here.

## 10. Repository decisions recorded here

### 10.1 The capture contract lives at `src/schema/`, not at a repository-root `schema/`

`tsconfig.json` sets `rootDir: "src"`. TypeScript refuses to emit a file outside `rootDir`, so any
module under `src/**` importing from a repository-root `schema/` fails to compile with
"is not under rootDir".

| Option | Outcome |
|--------|---------|
| **`src/schema/`** — chosen | No config change. The contract is importable from every other source file with the same `.js`-suffixed relative specifier the rest of the repository uses, and `dist/schema/` ships with the extension. |
| Root-level `schema/` with a widened `rootDir`, or a second `tsconfig` project | Requires a build-graph change (project references, or introducing the bundler this repository deliberately does not have) to buy one directory level of visual prominence. Rejected. |

The choice is recorded because every later import path depends on it: moving it now would touch
every schema import plus the build configuration, to change nothing observable.
