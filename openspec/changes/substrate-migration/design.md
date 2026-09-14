## Context

G4 asks whether state established on one surface or platform can be used on another, losslessly and
verifiably. The interpreter assigned the readings an owner; the two that need a real protocol —
*across devices* and *across HipCortex surfaces* — landed here. This is the change that has to answer
them with a protocol rather than with a promise.

Three facts from the live runtime (3.11.0, `http://127.0.0.1:3030`) shape everything below. They were
re-observed on 2026-09-14 with a throwaway actor (`probe-migration-7031`) that was deleted at the end
of the run; the transcript is reproduced in `tasks.md` with the rest of the gate evidence, and the
endpoint-level half of it is already recorded in `docs/PROTOCOL.md` sections 6 and 6.1.

1. **The export leg is lossless and states no version.** `GET /memory/export?actor=` returned
   `{exported_at, records, total}` with each record carrying `metadata`, `priority`, `record_type`,
   `tags`, `source`, `action` and `actor` intact — and no `schema_version` at all. An actor with no
   records returned `{"exported_at":"…","records":[],"total":0}`, which is the empty *valid* document
   the first requirement asks for rather than an error.
2. **`POST /memory/add` keeps a field the extension was not sending.** A record posted with
   `priority: "pinned"` came back out of the export as `"priority":"pinned"`; a record posted without
   it came back as `"normal"`. The runtime owns a priority field, and it honours a caller's.
3. **`POST /memory/bulk` is not an import path.** Two records were posted through it with
   `{records:[…]}` and it answered `{"success":true,"inserted":2,"failed":0,"record_ids":[…],"errors":[]}`
   — and the read-back showed `tags: []` where the source had `["capture","probe"]`,
   `source: null` where the source had `"cortexbridge"`, and `priority: "normal"` where the source had
   `"pinned"`. A single record was then posted both ways and compared export-to-export
   (`.scratch/probe-bulk-fields.mjs`): bulk lost `tags` and `source` and reset `priority`, while
   `POST /memory/add` kept all three and re-serialised `metadata` with a different key order only. A
   bulk import reports unqualified success while rewriting three fields and nulling a fourth.

What already exists, and was not written here: `src/schema/export-document.ts` — the writer
(`toExportDocument`) and the single reader (`readExportDocument`) that both producers in this
repository emit for, with the core-owned-field rule, the unknown-field rule and the
all-failures-at-once rule already specified and tested by `tests/capture/queue-export.spec.ts`. It was
built by `cortexbridge-retention-boundary` and explicitly named this change as its second consumer.

What does not exist: any importer, any record of the `id` remap, and any surface that offers either.

## Decisions

### 1. Import posts one record at a time to `POST /memory/add`; `/memory/bulk` is rejected on evidence

Task 2.1 in `tasks.md` was written as "implement import through `POST /memory/bulk`". That task is
amended rather than implemented, because the observation above shows bulk is a data-loss path with a
success response: it reported `failed: 0` while discarding `tags` and `source` and coercing
`"pinned"` to `"normal"`. A migration that silently un-pins a pinned memory, drops its tags and
erases the field that says which system wrote it is the failure this change exists to prevent, and it
is worse than a refusal because nothing in the response announces it.

So the importer posts **one record at a time to the same endpoint captures already use**. Two things
follow, and both are the reason this is the right endpoint rather than merely a working one:

- An imported record makes exactly the trip a capture makes, so the fields that survive an import are
  the fields the runtime has already proved it keeps (section 3 of `docs/PROTOCOL.md`, each row marked
  *verified*).
- There is one egress path in the repository, not two. A second path would be a second acknowledgement
  rule, and the acknowledgement rule is the one place where getting it wrong loses a capture.

`/memory/bulk` does return `record_ids`, so a remap *could* have been derived from its response. That
is recorded here because it is the tempting argument for using it, and the answer is that a remap to a
record whose tags are gone is a map to the wrong thing.

### 2. `priority` is part of the migrated field set, so the add body has to carry it

`docs/PROTOCOL.md` section 3 lists the add body's fields and `priority` is not among them; the export
document defines `priority` as a record field and the runtime returns one. The result is the exact
shape of silent loss the contract's unknown-field rule refuses to allow on the read side: the reader
keeps the field, `toAddBody` drops it, and the import reports success.

Measured, not assumed: the runtime accepted `priority: "pinned"` and stored it. So `MemoryRecord`
gains `priority?: string` and `toAddBody` emits it when present. Capture egress is unchanged by this —
`toEgressRecord` never sets a priority, and an absent field is still absent from the body, which is
what keeps "no `ttl_seconds`" and "no invented priority" the same kind of promise.

### 3. The remap is durable, append-only, and keyed by the source id

The requirement is that an old id resolves "forever after, because a reference that resolves only
during the import is not a record of anything". That sentence rules out the two cheap designs: an
in-memory map (gone when the worker is evicted, which MV3 does at will) and a map returned only in the
import response (gone when the user closes the page).

So the remap is one key in `chrome.storage.local` — `hipcortex.capture.migration.remap` — holding
`{ version, batches: [{ runId, importedAt, actor, mappings: [{ previousId, kind, recordId, action }] }] }`.
Per import rather than one flat map, because "which import brought this in" is the question a user has
when a remap surprises them. `previousId` may be absent when the source document omitted it — the
runtime's own export always includes one, but a hand-written document need not — and an import whose
records have no ids records no mappings and says so.

A batch is keyed by `runId`, minted once per import, and **not** by `importedAt`. Two imports can
finish inside the same millisecond — a two-record document read from a local file does it easily — and
a batch boundary derived from the clock would merge them, which makes "how many imports touched this
id" undercount and makes the newest-match rule below resolve to the older run. `importedAt` stays
because a person reading the store wants to know when; `runId` is there because the code needs to know
whether.

The per-record collection is `mappings`, and the outcome collection in the import report is
`outcomes`. Both were first written as `entries`, which is the queue's word for a waiting capture: this
repository's containment scan treats `.entries` outside `src/capture/queue/` as a boundary violation
(G2.1), and a remap that reused the name would make a stored identity transition indistinguishable
from a queued capture to every future reader of either. Renaming was the fix; exempting the scan was
not available, because the scan is what stops the boundary from eroding one convenient name at a time.
For the same reason the report does not carry the transport's verdict in a field of its own: the
runtime's refusal words reach the surface inside the outcome's `detail`, where the transport already
put them, and `refusalReason` stays the queue's name for a verdict about a *waiting* capture.

- **Written per record, immediately after that record is acknowledged.** A crash, an eviction or a
  closed page halfway through an import leaves a truthful partial remap rather than none. The
  alternative — collect the whole import then write once — would make the remap a summary of an
  operation that may not have finished.
- **Append-only, and unbounded.** The spec says "forever after", so a cap would be a different promise
  with the same name. This is the one store in this repository that is not a cache and not a queue: an
  evicted index record is still in the core, and an acknowledged capture is still in the core, but a
  dropped remap entry is knowledge that cannot be recomputed from anything the runtime holds. If the
  write fails, the failure is reported per record instead of evicting an older entry to make room.
- **It records identity, not content.** No `target`, no `metadata`, no excerpt: `{previousId,
  recordId, action}` is enough to resolve a reference, and (G2.10) a stored notice is not a place for a
  capture's text.

### 4. A repeat import duplicates the records, and that is the decision

Task 2.4 asks what a repeat import of the same document does. Observed: a second `POST /memory/add` of
the same shape returned `{"success":true,…,"warning":[{"action":"capture:probe","id":"…",
"overlap_ratio":62}]}` and both records exist afterwards — `GET /memory/query` showed four rows for two
source records. The runtime does not merge, and it tells the caller it did not.

**Decision: a repeat import imports again, and the duplicate advisory is surfaced per record.** The
alternatives are worse:

- **Deduplicate in the extension** would require this repository to decide what "the same capture" is.
  The runtime's answer is an `overlap_ratio`, which is a similarity and not an identity (G5.4 forbids
  the extension from owning similarity at all), and getting it wrong means discarding a capture the
  user asked to import. Section 6.2 of `docs/PROTOCOL.md` closes the retention risk that motivated
  dedup in the first place: a duplicate does not overwrite anything.
- **Refuse the second import** would make the operation unrepeatable after a partial failure, which is
  the situation an import is most likely to be run in — the user re-runs it because the first attempt
  stopped at record 5.

The duplicate warning is reported, because "you now have two of these" is exactly the kind of thing a
migration report exists to say. It is reported as a warning and **not** as a refusal (G2.9): the runtime
accepted the record and named it, and calling that a failure would be the mirror image of the mistake
the acknowledgement rule forbids.

### 5. All-or-nothing is an ordering, not a rollback

The requirement says a refused document leaves the store unchanged. That is achieved by validating the
whole document *before the first write*: the importer calls `readExportDocument` once and returns its
failures verbatim if the read is not `ok`, so there is no path on which a version mismatch or an
unknown field can be discovered after a record has been written. The version-mismatch scenario and the
unknown-field scenario are the same code path, which is why the second one cannot drift away from the
first.

There is deliberately **no rollback**, and the reason belongs in the design rather than in a comment: a
record refused *mid-import* is a record the runtime refused — a PII refusal (section 3.2 of
`docs/PROTOCOL.md`) is the case that actually happens. Undoing the records already acknowledged would
mean deleting memories the runtime has confirmed it holds, which is a destructive act taken to make a
report look tidier. An import that says "7 imported, 1 refused by the runtime, here is what it said"
is the truthful outcome.

The importer also does not stop at the first per-record refusal. Each record is independent, the
refusal is deterministic for that record (the transport already classifies refusals as `refused` rather
than `transient`, `cortexbridge-retention-boundary` task 5.1), and stopping would leave later records
unimported for no gain.

### 6. `metadata` is compared deeply, in the spec and in the report

The runtime re-serialises `metadata` with a different key order, which a probe already caught reporting
a difference where there was none (`docs/PROTOCOL.md` section 6.1). So the round-trip spec asserts deep
equality and never string equality, and nothing in the import path compares a serialised record to
another one.

### 7. The import runs in the worker; the surface sends text and renders a report

The transport and `chrome.storage.local` are both worker-side, so the import is one message to the
worker and the options page is a renderer. Two sub-decisions are load-bearing:

- **The surface sends the file's text, not a parsed document.** Parsing happens once, next to the
  reader (`parseExportDocument` in `src/schema/export-document.ts`), so "one reader" stays true
  through the parse step and a surface cannot hand the importer a record the reader never accepted.
  The cost is that a malformed file is reported by the router as `MALFORMED_DOCUMENT` rather than by
  the page, which is the right owner for the rule.
- **The report is data, not prose assembled in the page.** The response carries counts, per-record
  entries with the runtime's own `refusalReason`, the duplicate warnings, and the read notes
  (`VERSION_DEFAULTED`, `CORE_FIELD_DROPPED`). Notes are shown, not swallowed: a document whose
  identity was regenerated is exactly the case where a user would otherwise believe a byte-for-byte
  copy happened.

### 8. The remap is resolvable by the user, not only by a spec

The requirement's scenario — "WHEN an id from the source document is looked up in the remap" — has no
user in it, and an operation with no way to invoke it discharges nothing. So the options page's import
section includes a lookup: paste a previous id, get the current one or a plain "not in the remap".
That is what makes "durable and resolvable after the import completes" observable rather than merely
asserted, and it is a second message type because it must be answerable without re-importing anything.

### 9. Cross-surface equivalence (G4.4) is a property of the core, and the extension's part is not to add a second copy

The fourth requirement says a capture written by the extension is retrievable unmodified from the CLI
and from MCP. Nothing in this repository can make two core surfaces agree, and the failure mode to
avoid is the obvious wrong answer: writing a second reader in the extension that *shows* the uniform
view and thereby hides a divergence instead of revealing it.

The extension's contributing half is already the design: the text a capture sends is the conversation
transcript itself under the `target` field (section 3 of `docs/PROTOCOL.md`), and the extension keeps
no second copy of it that a comparison could accidentally be made against — the local index holds a
truncated excerpt for offline search and is explicitly a cache. The cross-surface check is therefore an
observation made against the runtime, recorded with raw output, and any divergence found is raised as a
core dependency (task 4.4) rather than smoothed over here.

## Consequences

- Two new message types (`IMPORT_DOCUMENT`, `RESOLVE_PREVIOUS_ID`), each with its router case, and the
  options surface that sends them.
- A new module tree `src/migration/` holding the importer and the remap store. It is not a network
  surface: it reaches the runtime only through a `Transport` obtained from the factory, which is the
  rule the transport layer already enforces.
- `src/api/transport/endpoints.ts` gains `priority` in the add body, and `src/types/index.ts` gains
  `priority` on `MemoryRecord` plus the report types.
- New specs: `tests/migration/round-trip.spec.ts` (G4.2), `tests/migration/version.spec.ts` (G4.3),
  `tests/router/import.spec.ts` and `tests/surfaces/import.spec.ts` for the two interfaces that carry
  them.
- `docs/PROTOCOL.md` section 6.1 already records why bulk is not the import path; section 3's add-body
  table gains `priority` when present, since that is now a field the extension relies on.

## Recorded limitations

1. **The `id` and `integrity` regeneration itself cannot be asserted by a spec.** A fetch mock answers
   whatever it is told, so the specs assert the *posted* body omits every core-owned field, and the
   regeneration is live evidence in `tasks.md`. Claiming the runtime's behaviour from a mock would be
   the same mistake as claiming byte-equivalence.
2. **The cross-surface read (G4.4) needs a capture that a real browser produced.** The CLI and MCP
   reads are observed against the live runtime and recorded with raw output; no spec in this repository
   can produce the browser half.
3. **The remap is unbounded by design.** A very large import can reach the storage quota, and that is
   reported as a per-record failure rather than resolved by evicting an older entry — see decision 3.
4. **A repeat import duplicates.** This is a decision, not an oversight (decision 4); there is no dedup
   and adding one is a scope change that needs its own reasoning about identity.

## Raised core dependencies (task 4.4)

Task 4.4 asks for a core change to be *raised* rather than worked around in the extension. The
cross-surface observation produced two, both measured on 2026-09-14 against runtime 3.11.0, and neither
is something this repository can fix — the core lives in a separate repository and reaching into it is
forbidden by `AGENTS.md`.

1. **`POST /memory/bulk` corrupts a record and reports success.** It answered `inserted: 1, failed: 0,
   errors: []` while the stored record had `tags: []` instead of `["capture","chatgpt"]`,
   `source: null` instead of `"cortexbridge"` and `priority: "normal"` instead of `"pinned"`; the same
   record posted to `POST /memory/add` came back with all three intact (`.scratch/probe-bulk-fields.mjs`).
   A write endpoint whose `failed` count cannot be trusted is a core defect, and the honest handling is
   to say so here. The extension does not try to *detect* the loss and report it — it does not use the
   endpoint at all, and its importer posts one record at a time to `/memory/add` (decision 1). That is
   avoidance of a known-broken surface, not a workaround that papers over it: nothing in the extension
   compensates for the loss, because nothing in the extension can reconstruct the fields the runtime
   dropped.
2. **The core's export document declares neither a schema version nor an actor.** `GET /memory/export`
   and `hipcortex backup` both return exactly `{exported_at, records, total}` (`.scratch/cli-read.json`),
   so a reader cannot version-decide and cannot tell a single-actor dump from a mixed one by the
   document's own statement. This repository absorbs that by defaulting an absent `schema_version` to 1
   and *noting* it (`VERSION_DEFAULTED`) and by reading an absent `actor` as `null`, which is the
   mixed-document case. Both are recorded rather than guessed, and the raised request is that a core
   export name its version so the defaulting path can eventually be removed.

A third observation is a usability gap rather than a defect and is recorded as such: `hipcortex`'s only
read subcommand is `backup`, an operator-level dump to a file. There is no `recall` or `search`
subcommand, so an operator confirming that a capture is retrievable has to dump the actor and read the
file. The MCP read (`search_memory`) does return the capture's text, in full and in order, so
retrievability itself is not in question — only the CLI's ergonomics are.
