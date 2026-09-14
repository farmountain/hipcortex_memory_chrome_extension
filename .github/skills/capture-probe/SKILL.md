---
name: capture-probe
description: 'Use before writing or fixing an AI-site capture adapter when you need ground truth about a provider surface (ChatGPT, Claude, Grok, Gemini, DeepSeek). Covers safe read-only reconnaissance of DOM and conversation payloads, saving fixtures, and ranking selectors by resilience.'
argument-hint: 'Provider + URL of a conversation to probe'
---

# Capture Probe

Adapter work fails when it is written against a guessed DOM. This skill produces **fixtures and
a selector ladder from real observations** before any adapter code is written.

## When to use

- Adding capture support for a new AI site.
- An existing adapter stopped extracting after a provider UI change.
- You are about to write a selector and cannot cite the markup it targets.

Do **not** use this to design capture semantics — that is the schema's job.

## Red lines

- **Read-only.** Never post, send, regenerate, or delete anything in the user's conversation.
- **No credentials.** Never copy cookies, auth headers, bearer tokens, or session IDs into a
  fixture, a spec, or a commit.
- **Redact first.** Fixtures are saved with user content replaced by deterministic placeholders;
  keep only the *shape* (roles, nesting, ordering, attributes).
- **One conversation, one tab.** Do not multi-probe a live session while the user is working.

## Procedure

1. **Confirm the surface exists.** Open the site and a conversation with at least 4 turns
   (≥1 alternating role change, ideally one attachment). Record the canonical URL pattern and
   any locales/subdomains in play.
2. **Capture the rendered structure.** In DevTools, inspect the message list. Walk *upward* from
   a message's text node to find the smallest ancestor that (a) repeats once per message and
   (b) carries a role signal. Record the path.
3. **Capture the wire shape.** In the Network tab, find the conversation fetch/stream request.
   Save the response body only if it contains the full conversation; otherwise stay DOM-only.
4. **Build the selector ladder.** Write 3–6 candidates from most-semantic to most-brittle and
   rank them. Prefer stable semantic attributes over generated class hashes.
5. **Redact and save fixtures** into `tests/fixtures/<provider>/` — at minimum
   `conversation.html` and one degraded case (`empty.html`, `partial.html`).
6. **Record the observation** in the adapter as `adapterVersion` plus a one-line comment naming
   the markup assumption and the date it was verified.

## Selector ladder — ranking rules

| Rank | Signal | Example |
|------|--------|---------|
| 1 | Semantic data attribute authored by the provider | `[data-message-author-role]` |
| 2 | Test hook attribute | `[data-testid="conversation-turn"]` |
| 3 | Structural landmark | `main article`, `[role="log"]` |
| 4 | Stable-ish class substring | `[class*="message"]` |
| 5 | Tag/positional heuristic (last resort) | `main > div > div:nth-child(n)` |

Never ship rank 5 alone. Every adapter must have at least one rank 1–3 selector with a spec
proving it.

## Evidence required before you write the adapter

- Canonical + one alternate URL (for `matches()`).
- A repeating container path with a role signal.
- A saved redacted fixture containing ≥2 roles and ≥3 messages.
- At least one degraded fixture that must produce a typed extraction failure.
- A note on whether an attachment was observed and how it is represented.

If any item is missing, the adapter is not ready — report the gap instead of guessing.
