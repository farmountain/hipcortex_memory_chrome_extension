## 1. Export leg (G4.1)

- [x] 1.1 Define the export document: schema version, actor, and the record array *G4.1*
- [x] 1.2 Prove `metadata`, `priority`, `record_type` and `tags` survive export, against the live
      runtime, with the raw output recorded *G4.1*
- [x] 1.3 Prove an empty actor exports an empty valid document, not an error *G4.1*

The document is `src/schema/export-document.ts`: `EXPORT_DOCUMENT_FIELDS` names all five keys
(`schema_version`, `exported_at`, `actor`, `records`, `total`), `EXPORT_RECORD_FIELDS` names the eight
fields a record may carry, `CORE_OWNED_EXPORT_FIELDS` names the seven the reader drops, and
`parseExportDocument` is the only way in. Both producers in this repository — the undelivered queue and
a re-saved core reply — go through the one writer, and `tests/capture/queue-export.spec.ts` (10 tests)
owns the export half: it exports a full queue, then delivers it, and requires every entry to arrive
exactly once, so "the export did not touch the queue" is asserted rather than assumed.

A queued capture exports as `toEgressRecord(event, actor)` — the same function the add body is built
from — which is what makes the export leg comparable to the request the runtime would have received.
What a spec cannot establish is that the *live* runtime returns those fields on export, because a fetch
mock answers whatever it is told; that half is the first block of live evidence below.

## 2. Import with a recorded remap (G4.2)

- [x] 2.1 Implement import through `POST /memory/add`, one record at a time, and record the `id` remap
      durably *G4.2* — amended from `POST /memory/bulk` on the evidence in `design.md` decision 1: bulk
      answered `inserted:2, failed:0` while storing `tags: []`, `source: null` and `priority: "normal"`
      for a record whose export held `["capture","chatgpt"]`, `"cortexbridge"` and `"pinned"`. A
      success response that silently rewrites three fields is the failure this change exists to prevent.
- [x] 2.2 Carry `priority` in the add body, so the field the export states is a field the import keeps
      *G4.2* — `toAddBody` did not send it and the runtime honours it (`design.md` decision 2).
- [x] 2.3 Prove field equivalence for `action`, `record_type`, `metadata` and `priority`, and state in
      the spec that `id` and `integrity` are regenerated — never claim byte-equivalence *G4.2*
- [x] 2.4 Prove the remap resolves an old id after the import completes *G4.2*
- [x] 2.5 Offer the remap lookup on a surface, so "resolvable after the import completes" is observable
      rather than only asserted *G4.2*
- [x] 2.6 Decide and record what a repeat import of the same document does: a duplicate, a refusal,
      or an idempotent no-op. Record the decision in `design.md` with its reason *G4.2*

`tests/migration/round-trip.spec.ts` (15 tests) holds the guarantee. It asserts the posted body carries
every field the document states, under the destination's actor, and **no** core-owned field — the
regeneration itself is a runtime behaviour a mock cannot honestly assert, so the spec asserts the
absence that makes it true by construction. It asserts `priority` reaches the wire when the record
states one and is absent from the body when it does not, which is what keeps capture egress unchanged.
It compares `metadata` with a deep equality and never with a string equality, because the runtime
re-serialises the object with a different key order. The remap half asserts that the id the source
document stated resolves to the id the core issued, that a capture's own `eventId` resolves too (it is
the only identity this repository emits), that an unknown id answers as a miss with the import count
rather than as an error, and that one import writes one batch with one timestamp. The repeat-import half
asserts a second import imports again rather than merging, and that the runtime's `overlap_ratio`
advisory is reported as a warning and not as a refusal — the record was accepted and named, and calling
that a failure is the mirror image of the mistake the acknowledgement rule forbids.

`tests/router/import.spec.ts` (9 tests) owns the decision rather than the arithmetic: it drives the two
message types through the router and asserts the remap is written to `chrome.storage.local` (so it
outlives the worker that made it), that the import touches **no** other storage key, that a refused
document issues no request at all, and that a run in which the runtime refused one record is reported
as a failure with both counts.

`tests/surfaces/import.spec.ts` (12 tests) owns the user's end. It asserts the page sends the file's
text and only that, prints each new id, prints no captured text at all, renders a refusal with the
failing class, carries the reader's notes and the overlap advisory to the screen, and answers a lookup
miss with the import count rather than as an error. The lookup is a second message type because it has
to be answerable without re-importing anything — an operation with no way to invoke it discharges
nothing.

## 3. Version mismatch (G4.3)

- [x] 3.1 Reject a document whose schema version is unknown, naming the version found and the
      version understood *G4.3*
- [x] 3.2 Prove the refusal is all-or-nothing: the store is unchanged *G4.3*
- [x] 3.3 Prove an unknown field cannot be silently dropped, because that is the failure the rule
      exists to prevent *G4.3*

`tests/migration/version.spec.ts` (14 tests) holds all three. All-or-nothing is an **ordering** rather
than a rollback: the document is read in full before the first write, so no path exists on which a
version mismatch is discovered after a record has been stored, and the spec proves it by making the
second record unreadable and requiring the store to be unchanged. The spec also pins the edges that
would otherwise drift: a number-like string version is refused rather than coerced, an absent
`schema_version` is read as 1 **and noted** (`VERSION_DEFAULTED`), a core-owned field is dropped **and
noted** (`CORE_FIELD_DROPPED`), a missing required field is refused by naming the record and the field,
and a file that is not JSON is reported as a parse problem rather than thrown. `design.md` decision 5
records why there is deliberately no rollback: undoing records the runtime already acknowledged would
mean deleting memories it has confirmed it holds.

## 4. Cross-surface verification (G4.4)

- [x] 4.1 Read one extension capture from the CLI and record the raw output *G4.4*
- [x] 4.2 Read the same capture from MCP and record the raw output *G4.4*
- [x] 4.3 Prove message count, text and order are identical across both reads *G4.4*
- [x] 4.4 Record any core change this needs as a raised dependency rather than working around it in
      the extension

One capture was delivered through this repository's own egress path — `toEgressRecord` then
`HttpTransport.addMemory`, the pair `src/capture/pipeline.ts` calls — to a throwaway actor, and the
record was read back three ways. All three returned the same three messages in the same order with the
same text, and the CLI and REST reads agreed on the record id. The third block of live evidence below is
the transcript, and section 6.4 of `docs/PROTOCOL.md` records the result alongside it.

What the probe does **not** establish is the browser half: no spec in this repository can make a real
provider tab emit a capture, so the record was produced by the extension's egress code under Node. That
an actual page produces an event the same code accepts stays unchecked in `cortexbridge-perception-layer`
until a person loads `dist/` unpacked, and it is reported rather than ticked here.

Task 4.4 produced raised dependencies instead of a workaround, all written into `design.md` under
"Raised core dependencies": `POST /memory/bulk` corrupts three fields and reports `failed: 0` (a core
defect, raised — the extension avoids the endpoint rather than compensating for the loss, which it could
not do), and the core's export document declares neither a `schema_version` nor an `actor`, which this
repository absorbs by noting the default and reading the absent actor as a mixed document. The third
observation is a usability gap and is recorded as one: the CLI's only read subcommand is `backup`, an
operator dump to a file.

## 5. Gates

- [x] 5.1 Add the migration specs to the gate chain and require the full chain to pass
- [x] 5.2 Run the traceability gate: every criterion cited here must resolve to a requirement
      heading and every backticked test path must exist on disk

`npm run verify` is the chain, and it is pinned by `tests/quality/gates.spec.ts` to exactly
`typecheck && lint && test && build`, so the migration specs are in it by being specs rather than by
being listed anywhere. The traceability gate is `npm run test:traceability`, which resolves every
criterion cited in `openspec/changes/**` to a heading in `docs/END-STATE.md` and checks that every
backticked test path named here exists on disk.

## Live evidence

All three blocks were produced on 2026-09-14 against runtime 3.11.0 at `http://127.0.0.1:3030`, on
Windows with Node v22.18.0, from a throwaway actor per probe. Every actor was deleted at the end of its
run, and the deletion is part of the transcript.

Export leg, tasks 1.2 and 1.3 (`.scratch/probe-migration.mjs`, actor `probe-migration-7031`):

```
== 0. health ==
{"status":200,"parsed":{"service":"hipcortex","status":"ok","version":"3.11.0"},"text":"{\"service\":\"hipcortex\",\"status\":\"ok\",\"version\":\"3.11.0\"}"}

== 3. export document shape ==
export status: 200
export top-level keys: ["exported_at","records","total"]
record[0] keys: ["action","actor","confidence","expires_at","id","integrity","metadata","priority","record_type","source","status","tags","target","timestamp","version"]
record[0] id: "3a354cc9-c5de-43a0-b9da-526788639285" integrity: "249c7f8ae739b92e3f030571dfac8f71059e77a903fc503eac9ab96392a870bf" priority: "normal"
record[0] tags: ["capture","probe"] record_type: "Perception" action: "capture:probe"

== 4. empty actor export ==
empty export: 200 {"exported_at":"2026-09-14T06:10:08.849087900+00:00","records":[],"total":0}

== 8. forget the throwaway actor ==
forget: 200 {"success":true,"actor":"probe-migration-7031","records_deleted":4,"symbolic_nodes_deleted":0,"error":null,"deleted_ids":[...4 ids...]}
records left for actor: 0
```

Two records were seeded with `priority: "normal"` and `priority: "pinned"`, and both came back with the
value they were written with, together with `tags`, `source`, `record_type` and the deep `metadata`
object. An actor with no records returned an empty **valid** document and not an error. That discharges
task 1.2 and task 1.3, and it also closes the second fact `design.md` states: the runtime keeps a
`priority` the caller sends, so the import had to start sending one.

`/memory/bulk` is not the import path, task 2.1 (`.scratch/probe-bulk-fields.mjs`, two throwaway actors,
compared export-to-export rather than from either write response):

```
bulk write  : 200 {"success":true,"inserted":1,"failed":0,"record_ids":["0275c22c-faa9-4769-92d0-ce6e169804cd"],"errors":[]}
add  write  : 200 {"success":true,"record_id":"b2ad22b3-cda0-48e4-b19b-a0a7b10a63e2","error":null,"warning":null}

--- bulk read back via /memory/export (200) ---
DIFF metadata     {"hipcortex.capture":{"schemaVersion":1,"provider":"chatgpt"}} -> {"hipcortex.capture":{"provider":"chatgpt","schemaVersion":1}}
DIFF priority     "pinned" -> "normal"
DIFF source       "cortexbridge" -> null
DIFF tags         ["capture","chatgpt"] -> []
SAME action       "capture:chatgpt" -> "capture:chatgpt"
SAME actor        "probe-bulkfields-3804" -> "probe-bulkfields-3804"
SAME record_type  "Perception" -> "Perception"
SAME target       "# T\n\nuser:\nzzbulkmarker one\n\nassistant:\nzzbulkmarker two" -> "# T\n\nuser:\nzzbulkmarker one\n\nassistant:\nzzbulkmarker two"

--- add read back via /memory/export (200) ---
DIFF metadata     {"hipcortex.capture":{"schemaVersion":1,"provider":"chatgpt"}} -> {"hipcortex.capture":{"provider":"chatgpt","schemaVersion":1}}
SAME priority     "pinned" -> "pinned"
SAME source       "cortexbridge" -> "cortexbridge"
SAME tags         ["capture","chatgpt"] -> ["capture","chatgpt"]
SAME action / actor / record_type / target

forget probe-bulkfields-3804: 200 1
forget probe-addfields-8370: 200 1
```

The one write that reports `failed: 0` is the one that loses three fields, and the only difference
between the two `metadata` lines is the serialised key order — which is why nothing in the import path
compares `metadata` as a string. The same probe's earlier run had already shown that a **bare array**
body is refused outright (`422`, `invalid type: map, expected a sequence`), so the envelope is not
optional either.

Cross-surface reads, tasks 4.1 to 4.3 (`.scratch/probe-crosssurface.mjs` delivered the capture and
`.scratch/compare-crosssurface.mjs` compared the three reads):

```
step 1 add-body keys: ["action","actor","metadata","record_type","source","tags","target"]
step 1 add-body action/record_type: "capture:chatgpt" / "Perception"
step 2 delivered: acknowledged=true
step 2 record_id: 9504ddd2-0f22-4c99-99f7-a4a8468fa6d4
step 3 stored priority: "normal"

CLI read (`hipcortex backup --actor probe-crosssurface-tgf8 -o .scratch/cli-read.json`):
Backed up 1 records to .scratch/cli-read.json
{"exported_at":"2026-09-14T06:12:12.671574300+00:00","records":[{"action":"capture:chatgpt","actor":"probe-crosssurface-tgf8",...,"id":"9504ddd2-0f22-4c99-99f7-a4a8468fa6d4",...,"priority":"normal","record_type":"Perception","source":"cortexbridge",...,"tags":["capture","chatgpt"],"target":"# zzcrossmarkertgf8 cross-surface read\n\nuser:\nfirst message zzcrossmarkertgf8\n\nassistant:\nsecond message zzcrossmarkertgf8\n\nuser:\nthird message zzcrossmarkertgf8",...}],"total":1}

MCP read (search_memory, query zzcrossmarkertgf8):
Found 1 result(s):
[capture:chatgpt] # zzcrossmarkertgf8 cross-surface read

user:
first message zzcrossmarkertgf8

assistant:
second message zzcrossmarkertgf8

user:
third message zzcrossmarkertgf8 (actor: probe-crosssurface-tgf8, score: 0.75)

comparison:
cli  found the record: true  messages: 3
rest found the record: true  messages: 3
mcp  messages: 3
cli === rest : true
cli === mcp  : true
same id on both machine reads: true
cli messages:
[
  { "role": "user",      "text": "first message zzcrossmarkertgf8" },
  { "role": "assistant", "text": "second message zzcrossmarkertgf8" },
  { "role": "user",      "text": "third message zzcrossmarkertgf8" }
]

forget: {"success":true,"actor":"probe-crosssurface-tgf8","records_deleted":1}
records left for actor: 0
```

## Gate evidence

```
npm run verify -> 0
  typecheck 0 | lint 0 | npm test 53 files / 821 tests, all passed | build wrote dist/content.js
npx vitest run tests/migration/round-trip.spec.ts tests/migration/version.spec.ts tests/router/import.spec.ts tests/surfaces/import.spec.ts tests/capture/queue-export.spec.ts -> 0
  |node|  tests/migration/round-trip.spec.ts (15 tests) 29ms
  |node|  tests/migration/version.spec.ts (14 tests) 31ms
  |node|  tests/router/import.spec.ts (9 tests) 765ms
  |jsdom| tests/capture/queue-export.spec.ts (10 tests) 14ms
  |jsdom| tests/surfaces/import.spec.ts (12 tests) 365ms
  Test Files  5 passed (5)
       Tests  60 passed (60)
npm run test:traceability -> 0
  [traceability] criteria declared : 67 (docs/END-STATE.md)
  [traceability] criteria cited    : 67/67 by 56 requirement headings
  [traceability] test paths cited  : 183 in tasks.md
  [traceability] OK — every criterion is cited and every cited test path exists
npx openspec validate substrate-migration --strict -> 0   Change 'substrate-migration' is valid
```

The sixty tests split by claim: the two migration specs own the guarantee and the refusal (29), the
router spec owns the decision and the storage write (9), the surface spec owns what the user sees (12),
and the export spec owns the leg that has to be non-destructive (10). The fixture those specs share is
`tests/helpers/export.ts`, and it builds a refusal by calling the transport's own reader rather than by
hand — a stub that could drift from the transport would stop being evidence the moment the transport
changed.
