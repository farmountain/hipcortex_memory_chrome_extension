## 1. Retention policy (G2.2, G2.3, G2.8)

- [x] 1.1 State the retention horizon in `docs/RETENTION.md`: what is retained, the states an entry
      can be in, and the fact that the horizon is a *pause with a count* rather than an expiry
      *G2.2*, *G2.3*
- [x] 1.2 Define the queue state object the status surface reads, so paused/reason/count are one
      value rather than three independent reads *G2.3*
- [x] 1.3 Prove a stopped core does not expire anything: stop the core, capture, restart, deliver
      all — recorded live *G2.8*

## 2. Queue is transport, not memory (G2.1)

- [x] 2.1 Add the containment scan over the source tree: no module outside the queue reads a queued
      entry, and no module derives meaning from a waiting entry *G2.1*
- [x] 2.2 Prove a 2xx without a `record_id` is still a failure and removes nothing *G2.1*
- [x] 2.3 Extend the cognitive-vocabulary scan to the retention paths, so "retention" cannot drift
      into "recollection"

## 3. The user's exit (G4.1)

- [x] 3.1 Implement queue export in the record shape the core's export uses *G4.1*
- [x] 3.2 Prove export is non-destructive: export a full queue, then deliver it, and account for
      every entry exactly once *G4.1*
- [x] 3.3 Document the export shape in `docs/PROTOCOL.md` alongside the core's export

## 4. Gates

- [x] 4.1 Add the new specs to the one-shot gate chain, and keep `npm run verify` the only way a
      change is called done
- [x] 4.2 Re-run the traceability gate: every criterion this change cites must resolve to a
      requirement heading and every backticked test path must exist on disk

## 5. Undeliverable captures (G2.2, G2.3)

- [x] 5.1 Carry a per-entry outcome in the queue state, so "a temporary failure" and "the runtime
      refused this" are different values rather than one `reasons` list *G2.3*
- [x] 5.2 Prove a deterministic refusal is surfaced with the runtime's own reason text, and that a
      transient failure is not reported as a refusal *G2.2*
- [x] 5.3 Prove a refused capture remains exportable while refused and is delivered normally if the
      runtime later accepts it *G2.2*
- [x] 5.4 Do not add any redaction, filtering or rewriting of captured text: the refusal is recorded
      in `docs/PROTOCOL.md` §3.2 and left visible rather than worked around

Gate evidence for this change (2026-09-14, Windows, Node v22.18.0):

```
npm run verify -> 0
  typecheck  0 | lint 0 | npm test 42 files / 689 tests, all passed | build wrote dist/
npx vitest run tests/capture/queue.spec.ts          -> 0   Tests 29 passed
npx vitest run tests/capture/queue-export.spec.ts   -> 0   Tests 10 passed
npx vitest run tests/surfaces/capture-status.spec.ts -> 0  Tests 19 passed
npx vitest run tests/quality/source-scans.spec.ts   -> 0   Tests 31 passed
npm run test:traceability -> 0
  [traceability] criteria declared : 67 (docs/END-STATE.md)
  [traceability] criteria cited    : 67/67 by 56 requirement headings
  [traceability] test paths cited  : 164 in tasks.md
npm run test:clarity -> 0
  [clarity] questions        : 17 (self-resolved=13 open-with-exit=3 withdrawn=1)
  [clarity] stage coverage   : goals=2 acceptance-criteria=2 validation-planning=3 unknowns=3 planning=2 react-iterations=5
npx openspec validate cortexbridge-retention-boundary --strict -> 0   Change is valid
```

Live evidence for 1.3 and for the refusal path, executed against runtime 3.11.0 at
`http://127.0.0.1:3030` by driving the built `dist/capture/queue/` modules (full output quoted in
`docs/END-STATE.md` under *Live verification*):

```
[1] hipcortex stop -> "Process exited cleanly."     [2] GET /health while stopped -> unreachable
[3] captured 10 with the core stopped -> queued=10  [4] drain while stopped -> delivered=0 retained=10
[5] EXPORT_QUEUE while stopped -> total=10 schema_version=1
[6] queue after exporting -> queued=10              (the export removed nothing)
[7] hipcortex start  [8] GET /health -> ok
[9.1] drain -> delivered=10 remaining=0             [10] queue after delivering -> queued=0 refused=0
[11] GET /memory/query?actor=... -> 10 records      [12] provenance kept 10; tags kept 10
[13] DELETE /memory/forget/{actor} -> records_deleted=10
[B1] drain -> delivered=0 refused=1 retrying=0
[B2] the runtime's own reason: "precondition blocked: PII risk=0.90 patterns=[\"PII:1789363055\"]"
[B4] export while refused -> total=1 queued=1 refused=1
```

Two findings from that run are now recorded rather than worked around:

- The runtime's PII precondition inspects the **actor** as well as the record body. The first
  attempt used a millisecond timestamp as the probe actor's suffix and every one of the ten captures
  was refused with `precondition blocked: PII risk=0.90`, so a live probe's actor must be free of
  any ten-digit run. Nothing was stored, and the actor was forgotten afterwards.
- A refusal is a state a capture is *in*, not a verdict that ends it: `refused: 1, retrying: 0`, the
  capture still in the queue, still exportable, and — proven in the queue specs — still due, so a
  drain with a succeeding transport delivers it with no state to clear first.

`docs/RETENTION.md` is deliberately not folded into `npm run verify`: it is prose, and the claim it
makes is already gated by the queue, export and source-scan specs above. It states the horizon as a
pause with a count, names the three entry states, and lists what the policy rules out — drop-oldest,
a loss counter, silent expiry, re-shaping a record to get past a refusal, and reading the queue for
meaning.
