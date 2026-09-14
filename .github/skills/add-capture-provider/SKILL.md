---
name: add-capture-provider
description: 'Use when adding capture support for a new AI chat provider (ChatGPT, Claude, Grok, Gemini, DeepSeek, or a new site), or when an existing provider adapter must be fixed after a UI change. Covers the adapter contract, host permissions, provenance stamping, fixtures, and the required tests.'
argument-hint: 'Provider name and canonical URL'
---

# Add a Capture Provider

One AI site = one adapter + one registry entry + one fixture set + one spec file.
Nothing outside those four things should change. If your diff touches `src/background.ts`
or `src/api/**`, the design has leaked — stop and re-read
[capture-perception](../../instructions/capture-perception.instructions.md).

## When to use

- New provider site to support.
- Existing adapter regressed after a provider DOM update.
- Reviewing a provider PR for boundary violations.

## Prerequisites

Run the [capture-probe](../capture-probe/SKILL.md) skill first. You must have: the canonical
URL pattern, a ranked selector ladder, one redacted conversation fixture, and one degraded
fixture. Writing the adapter without these produces guess-driven selectors that break silently.

## Procedure

1. **Create the adapter** at `src/capture/providers/<id>.ts` from
   [adapter-template.ts](./assets/adapter-template.ts). Replace every `TODO`.
2. **Register it** in the single provider registry (`src/capture/providers/index.ts`). Adding a
   provider must be one line there — if it needs more, the registry is wrong.
3. **Add host permissions** in `public/manifest.json` → `optional_host_permissions`. Never add
   to `host_permissions`; never use a wildcard. Include the canonical host and any subdomain
   that serves conversations.
4. **Save fixtures** to `tests/fixtures/<id>/`: `conversation.html` (redacted, ≥3 messages,
   ≥2 roles) and `empty.html`. Redact user content; never commit tokens or session IDs.
5. **Write the spec** at `tests/capture/providers/<id>.spec.ts` covering the four cases below.
6. **Verify and report** — run the gate commands and paste the output. Do not summarize.

## The adapter contract

```ts
export interface ProviderAdapter {
  readonly id: string;            // "chatgpt" — matches the registry key and fixture folder
  readonly displayName: string;   // "ChatGPT"
  readonly adapterVersion: string;// bumped on every DOM-assumption change
  matches(url: string): boolean;  // pure, no DOM access, no network
  extract(input: ExtractInput): ExtractResult;
}
```

`extract` must return a discriminated result: a normalized `Conversation` **or** a typed
`ExtractError` (`EMPTY_CONVERSATION`, `NO_ROLE_SIGNAL`, `UNSUPPORTED_LAYOUT`). It must never
throw an untyped error, and never return a partially-populated conversation marked complete.

Required provenance on the returned conversation: `schemaVersion`, `provider`,
`adapterVersion`, `source`, `conversationUrl`, `capturedAt` (ISO-8601 UTC, `Z`).

## Required tests (all four, every adapter)

| Case | Assertion |
|------|-----------|
| `matches()` — canonical URL | `true` |
| `matches()` — subdomain / alternate locale | `true` |
| `matches()` — unrelated URL (e.g. `https://example.com`) | `false` |
| `extract()` — saved conversation fixture | messages in order, roles correct, provenance complete |
| `extract()` — degraded fixture | typed `ExtractError`, **and** no transport call occurred |

The last assertion is the important one: a broken parse must not reach the network.

## Definition of done

- `npx tsc --noEmit` exits 0 — no `any` in the new files.
- `npm test` exits 0 and includes the four cases above.
- `npm run lint` exits 0.
- `npm run build` exits 0 and `dist/manifest.json` contains the new host.
- Manual pass on the live site: one message round-trips with correct `provider` and
  `adapterVersion` in provenance.

Anything less is not done. Report which gate failed and the command output instead of claiming
completion.
