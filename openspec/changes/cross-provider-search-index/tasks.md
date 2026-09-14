## 1. Local index (G3.9)

- [x] 1.1 Define the index record: captured text tokens, provider, `capturedAt`, and the core's
      `record_id`, so a hit can be resolved to the stored record *G3.9*
- [x] 1.2 Decide the storage lifetime and the manifest grant it needs, and record the decision in
      `design.md` before writing code
- [x] 1.3 Index an entry only on acknowledgement, so the index is a cache over stored records
      *G2.1*, *G3.9*
- [x] 1.4 Implement the query path with no network call on it, and a provider filter applied
      locally *G3.9*

## 2. Boundary (G5.4)

- [x] 2.1 Extend the cognitive-vocabulary scan to the index module, with a positive control, so
      ranking or embedding cannot be introduced by accident *G5.4*
- [x] 2.2 Add the no-network scan over the search path: the offline query path must contain no
      transport call at all *G3.9*

## 3. Tests

- [x] 3.1 An offline search spec that stops the runtime and searches a seeded capture *G3.9*
- [x] 3.2 An empty-result spec, asserting success rather than an error *G3.9*
- [x] 3.3 A spec proving an unacknowledged capture is not searchable, and becomes searchable after
      acknowledgement *G2.1*, *G3.9*
- [x] 3.4 A spec proving clearing the index is non-destructive and distinct from clearing the queue
      *G3.9*

## 4. Gates

- [x] 4.1 Add every new spec to the gate chain and require the full chain to pass before this change
      is called done
- [x] 4.2 Run the traceability gate and confirm every cited criterion resolves to a requirement
      heading

Gate evidence for this change (2026-09-14, Windows, Node v22.18.0):

```
npm run verify -> 0
  typecheck  0 | lint 0 | npm test 46 files / 723 tests, all passed | build wrote dist/content.js
npx vitest run `tests/index/offline-search.spec.ts`  -> 0   Tests 8 passed
npx vitest run `tests/index/empty-results.spec.ts`  -> 0   Tests 7 passed
npx vitest run `tests/index/acknowledgement.spec.ts` -> 0  Tests 7 passed
npx vitest run `tests/index/clear-index.spec.ts`    -> 0   Tests 5 passed
npx vitest run `tests/quality/source-scans.spec.ts` -> 0   Tests 38 passed
npm run test:traceability -> 0
  [traceability] criteria declared : 67 (docs/END-STATE.md)
  [traceability] criteria cited    : 67/67 by 56 requirement headings
  [traceability] test paths cited  : 169 in tasks.md
  [traceability] OK — every criterion is cited and every cited test path exists
npx openspec validate cross-provider-search-index --strict -> 0   Change is valid
```

The four specs are the four shapes the plan asked for, and each one asserts something the others
cannot:

- Offline search proves the answer does not depend on the runtime being up: the storage is seeded
directly, the native channel is replaced with one that throws when the worker tries to open it,
and the spec asserts the port was never opened and no request was sent — while a `scope: "core"`
query in the same file does reach the network, so the two paths are shown to differ rather than
both happening to work.
- Empty results prove absence is a success. A query that matches nothing answers `success: true`
with `count: 0`, the size of what it searched, and the tokens it could not place; a corrupted index
reads as empty instead of failing the query; a blank or one-character query never becomes a match
on everything.
- Acknowledgement proves the index is a cache over stored records and not a second retention
boundary. Before the drain that the runtime acknowledged, the capture is queued and unsearchable;
after it, one record is searchable under the `record_id` the runtime returned. The same file proves
the other seam — the direct delivery path — and that a refused send, a refused extraction, and an
empty record id all leave the index empty.
- Clearing proves the index and the queue are different things with different owners: clearing
removes every record and reports how many, while the queue's stored JSON is byte-identical
before and after, and the unacknowledged count the clear reports is the same number the status
surface reads.

One finding is recorded rather than worked around: `unmatchedTokens` reports only the tokens absent
from *every* record the query was scoped to. A two-word query whose two words live in two different
records therefore reports no unmatched tokens and still returns nothing — which is the honest report
for an AND over a whole corpus, and is why the spec asserts the empty list there and adds a second
query with a genuinely absent token rather than loosening the expectation.
