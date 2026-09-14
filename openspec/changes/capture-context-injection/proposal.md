## Why

The lock on G4 says *across AI platforms* — carry context from ChatGPT into Claude — is owned by
this repo plus the core, and that it is **blocked, because it needs injection, which is a non-goal of
`cortexbridge-perception-layer`**. The current change therefore ships `injectIntoAiChats` as a
setting that exists and is inert: it reads a flag, writes nothing, and touches no provider page.

That is deliberate. Injection is the only feature in this repository that **writes** into a page the
user is looking at. It deserves its own change, its own threat model and its own tests, rather than
being bolted onto the capture pipeline where a bug in a selector ladder would silently type into
someone's conversation. Until then the flag must stay inert, and "inert" must be a tested property,
not an intention.

## What Changes

- **A composer adapter per provider**, separate from the capture adapter, with the same discipline:
  an ordered selector ladder, a structural pre-check, and a typed refusal instead of a plausible
  guess. A capture adapter that resolves the wrong node loses a message; an injection adapter that
  resolves the wrong node types into the wrong place.
- **Explicit, per-action user consent.** Context is placed in a composer only after the user asks for
  that specific action. Nothing is inserted in the background and nothing is ever submitted: the
  user's own send button remains the only way a message leaves.
- **A hard guarantee for the off state.** While `injectIntoAiChats` is off, no provider page is
  mutated at all — not a hidden input, not a draft, not a scroll position — and that is proven by
  running the injection path with the flag off and diffing the DOM.
- **A typed refusal that leaves the user's draft intact.** If the composer cannot be resolved, the
  action fails visibly and the user's existing text is untouched.

## Impact

- New capability specification: `context-injection`.
- Affected code, when implemented: a new `src/inject/**` tree, one composer adapter per provider in
  the existing provider registry, and the surfaces that trigger an injection.
- **This change is the only writer of DOM outside `src/capture/**`.** The source-scan gates that
  contain network and selector knowledge must be extended to `src/inject/**` in the same change, so
  the containment property holds across both DOM-facing trees.
- Non-goal: automatic injection, bulk injection, and any submission on the user's behalf.
