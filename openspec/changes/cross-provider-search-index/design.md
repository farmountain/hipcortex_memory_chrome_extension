## Context

G3.9 asks for something the extension cannot currently do: **search returns captured conversations
with the runtime stopped.** Every search today is a pass-through to the core — `POST /memory/search`
for the semantic path, `GET /memory/query` for filtered reads — so a user whose core is not running
can see none of the conversations their browser already holds.

That gap is not closed by "keep a copy", because a copy of captured conversations inside the
extension is exactly the second store `AGENTS.md` warns about: two claims about what was captured,
with no rule about which wins. The only way to add it without becoming a second retention boundary
is to make the local store **a cache over records the core already has**, and to make that
relationship structural rather than a promise.

This change is deliberately not part of `cortexbridge-perception-layer`. A local index introduces a
store with its own lifetime, its own bound and its own deletion action, and the perception change is
about forwarding a capture, not about holding one.

## Decisions

### 1. One key in `chrome.storage.local`, and no new manifest permission

The index lives at `hipcortex.capture.index` in `chrome.storage.local`, beside the queue. `storage`
is already a permission in `public/manifest.json`, so the manifest is **unchanged** — no
`unlimitedStorage`, no new host, no new API. A search index that needed a new grant would be a
permission the user cannot reason about at install time.

*Rejected: `unlimitedStorage`.* It buys headroom by hiding growth, and the bound below is the thing
that should decide how much is held. A store that is allowed to be unbounded eventually needs a
policy, and a retention policy is what this repository must never gain.

*Rejected: IndexedDB.* A second storage subsystem with its own transactions, its own upgrade path
and no in-memory mock comparable to the one the specs already use for `chrome.storage` — for a
payload measured in hundreds of kilobytes. The cost is paid in testability, which is where this
repository spends its guarantees.

*Rejected: `chrome.storage.session`.* It is cleared when the browser closes, so offline search would
be empty in exactly the case that motivates the feature: the runtime is stopped and the browser has
just been restarted.

### 2. It is a cache, and the ways it differs from the queue are the design

The queue may not drop an entry, may not be bounded by eviction, and may not be read for meaning.
The index does all three, and every one of them is safe **only** because it is a cache:

| | Queue (`hipcortex.capture.queue`) | Index (`hipcortex.capture.index`) |
|---|---|---|
| Written when | a capture is accepted and not yet acknowledged | the core has acknowledged it |
| Removal | acknowledged delivery only | eviction at the cap, or the clear action |
| Bound | 500 entries, then **pause** and report | 500 records, then evict the oldest **index** record |
| If lost | the capture is lost with it | nothing is lost; the core still holds the record |
| Read for meaning | never | yes — that is its only purpose |

The rule that keeps the right-hand column safe is task 1.3: the index is written **only on
acknowledgement**. Acknowledged means `success: true` **and** a non-empty `record_id` — the same
positive definition the queue uses, so an index can never contain a capture the core does not have.

### 3. What is stored per capture, and why the text is truncated

One record per acknowledged capture:

```
eventId, recordId, actor, provider, capturedAt, conversationUrl, text, tokens
```

- `recordId` is the core's own id, so a hit resolves to the stored record rather than to a copy of it.
- `text` is the conversation's messages joined by a newline and truncated to 3000 characters.
- `tokens` is the distinct lowercase word list of *that stored text*, in first-appearance order,
  capped at 400. It is derived data and it is stored anyway: it is what the task asks the record to
  define, and it turns a query into a set intersection instead of a tokenise-per-query loop.

The truncation is the one real lossy step in the whole feature, and it is bounded on purpose:
tokens and text come from **the same string**, so a matching token is always findable in the stored
text and the excerpt shown to the user always contains the text that matched. An index that matched
a token it could not show would be a hit the user cannot check — the same failure as a UI that
shows an inferred relationship as if it were a fact.

Worst case: 500 records × (3000 characters + 400 tokens) ≈ 2 MB, comfortably inside the 10 MB
`chrome.storage.local` quota and small enough that a full index is not a surprise the user has to
manage.

### 4. Matching is lexical, and the ordering is a fact about the record

A query tokenises the same way the record does. A record matches when **every** query token is
present in it, tokens shorter than two characters are dropped, and results are ordered by
`capturedAt` descending.

- AND, not OR: a two-word query is meant to narrow. OR with no scoring would return everything a
  common word appears in, undifferentiated, which is a worse answer than nothing.
- Exact tokens, not substrings: `cat` must not match "concatenate". A substring hit is one the user
  cannot see and cannot argue with, and this repository's rule for perception failures — a typed
  failure beats a plausible wrong answer — applies to a wrong hit as much as to a wrong capture.
- Newest first is metadata. It is not relevance: the order can be read off the records themselves,
  so no result is placed above another because of what a model thought of it.

*Rejected: TF/IDF, BM25 or any similarity score.* It is a ranking of inferred importance, which is a
reasoning capability, and G5.4 forbids it in this repository. It would also have to be reported as a
number the user is expected to trust — the "similarity score presented as relevance" the spec
explicitly rules out.

### 5. Two search paths, both named, and neither is a fallback

`SEARCH_MEMORY` gains an optional `scope`, defaulting to `local`:

- `local` — answered from the index. The transport is not constructed, not resolved and not called.
- `core` — the existing semantic path (`POST /memory/search`), which is what makes "the offline
  search path" a named path rather than the only path.

*Rejected: try the core and fall back to the index.* That is the "works offline by accident" case
the proposal rules out. A fallback makes the offline answer depend on how a network call failed, and
it makes the semantics of a result depend on a failure it does not report.

Both surfaces expose the choice, and both say which path answered, because "no matches" from the
index and "no matches" from the runtime mean different things: the first says *nothing captured here
contains that*, the second says *the core had nothing*.

### 6. The query path is proven to be network-free by a scan, not by a comment

Two scans in `tests/quality/source-scans.spec.ts`:

- the cognitive-vocabulary scan, applied to `src/index/` explicitly with a **positive control**, so
  "no embedding or ranking here" is evidence about this module rather than about the global scan;
- a no-network scan over the index tree: no `fetch(`, no `connectNative`, no transport import, with a
  positive control, so the offline path cannot acquire a network call by accident.

The global `fetch(` containment scan already limits the extension to one caller; this is narrower and
applies to the module that must never call it.

### 7. Where the index is written

Two places observe an acknowledgement — the pipeline's direct delivery and the drain's `send`
wrapper — and both call one function in `src/index/local.ts`. The write is **not** inside
`drainQueue`: the queue is transport, and a queue that also recorded a search copy would be the
second retention boundary with extra steps.

## Consequences

- `public/manifest.json` does not change. No new permission, no new grant, no new host.
- Losing the index loses only offline search. The queue and the core are untouched by a clear.
- The index can be empty at any time and every path handles it as a success with zero results.
- Offline search returns nothing for a capture that was accepted but never acknowledged — the
  correct answer, and the one that keeps the index honest about what the core has.
- The index is not a semantic search, and neither the surface copy nor the result shape pretends it
  is. Semantic relevance with a provider filter remains the cross-repo dependency
  `core: add filter to POST /memory/search`.
- The search surface lives in `src/popup.ts` and `src/sidepanel.ts`; the proposal's
  `src/surfaces/**` names a directory this repository does not have, and the module boundary that
  matters is `src/index/**`, which is where the new code sits.
