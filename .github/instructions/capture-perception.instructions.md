---
description: 'Use when writing or changing AI-provider capture: content scripts, DOM adapters for ChatGPT/Claude/Grok/Gemini/DeepSeek, conversation normalization, capture schema, provenance, or the local capture queue.'
applyTo: ["src/capture/**", "src/providers/**", "src/content/**", "schema/**"]
---

# Perception-only boundary

CortexBridge **perceives**. HipCortex **remembers and reasons**. Code in these paths may:

| Allowed | Forbidden |
|---------|-----------|
| Read the provider's DOM/network payload | Interpret, summarize, or infer meaning |
| Normalize into the capture schema | Write beliefs, goals, world state, or causal parents |
| Attach provenance metadata | Call HipCortex cognitive endpoints directly from a provider adapter |
| Enqueue and forward events | Contain provider-specific strings outside its own adapter |

If a change requires cognitive semantics, it belongs in the HipCortex core repo — not here.

## Provider volatility is contained by design

Provider DOMs change without warning. Every adapter must satisfy:

1. **Extraction is resilience-first** — order selectors from most-semantic to most-brittle
   (`[data-message-author-role]` → `article[data-testid]` → tag/class heuristics). Never
   depend on a single generated class name.
2. **Fail loud, not wrong** — if extraction yields an empty conversation or a message with
   neither role nor text, return a typed failure. Never forward a partially-parsed event as
   if it were complete.
3. **Declare an `adapterVersion`** on the adapter and stamp it into provenance so a core-side
   regression can be traced to a specific DOM assumption.
4. **No cross-adapter imports** — adapters are siblings, never dependencies.
5. **A DOM change must be fixable in one file** plus that adapter's fixtures.

## Provenance is mandatory on every event

Every outbound capture event must carry: `schemaVersion`, `provider`, `adapterVersion`,
`source`, `conversationUrl`, `capturedAt` (ISO-8601 UTC, `Z`). Events that cannot populate a
required field must be rejected before the network call, not sent degraded.

## Contract discipline

- The schema is **versioned**. Adding a required field is a breaking change — bump the version
  and keep the previous version parseable.
- Validate on egress, not just on ingest: an invalid event must throw before any transport call.
- Never mutate a captured conversation to "fix" it — normalize into a new object.

## Before you claim it works

A new adapter is not done until: `npm run build` exits 0, the adapter has unit tests covering
`matches()` and `extract()` with saved fixtures, and a manual pass on the live site confirms a
message round-trips with correct provenance.
