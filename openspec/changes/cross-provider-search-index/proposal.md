## Why

Search today is a pass-through to the core: semantic search over `POST /memory/search` and filtered
reads over `GET /memory/query`. Both require the core to be running. The moment the runtime is
stopped, a user who has captured hundreds of conversations from five different AI sites can see
none of them, even though the text of every one of them is sitting in the extension's own delivery
queue and in the browser's storage under the user's control.

G3.9 is exactly that gap: **search returns captured conversations with the runtime stopped.** It is
deliberately not part of `cortexbridge-perception-layer`, because a local index introduces a second
store to reason about — what it holds, how long it holds it, and how it can never become the only
copy of a capture. That decision is worth its own change.

## What Changes

- **A local, lexical index over captured conversations.** Tokenised text, provider and timestamp
  metadata, no embeddings and no cross-conversation ranking of meaning — a ranking model is a
  reasoning capability and belongs in the core.
- **Built from acknowledged captures only.** The index is a convenience over records the core
  already has, so an index that is lost, cleared or corrupted never loses a capture. It is a cache,
  and it is allowed to be empty.
- **Its own retention rule.** An entry is not silently expired, and the user can clear the index
  with one action that is distinct from clearing undelivered captures.
- **Provider filter at query time**, so "what did I capture from Claude" is a filter over local
  records rather than a network round trip.

## Impact

- New capability specification: `local-search`.
- Affected code, when implemented: a new `src/index/` module plus browser storage granted in
  `public/manifest.json`, and the search surface in `src/surfaces/**`.
- **No network surface is added.** The offline requirement is the point: with the runtime stopped,
  the search path must not attempt a request and then fall back, because a search that works
  offline by accident is not the same as one that works offline by design.
- Non-goal: semantic relevance plus a provider filter, which remains the cross-repo dependency
  `core: add filter to POST /memory/search`. This change does not pretend a local lexical index is
  semantic search.
