## 1. Composer adapters (G8.2, G8.7)

- [x] 1.1 Define the composer contract separately from the capture contract, under `src/inject/**`
      *G8.2*
- [x] 1.2 Implement one composer adapter per provider with an ordered ladder, a landmark pre-check
      and a recorded rung *G8.2*
- [x] 1.3 Prove a typed refusal, never a guessed node, when no rung resolves *G8.7*
- [x] 1.4 Extend the containment scans to `src/inject/**`: no network, no configuration from
      storage, selector knowledge only inside the tree *G8.2*, *G8.4*

## 2. Off means off (G4.5)

- [x] 2.1 Prove no provider page is mutated while `injectIntoAiChats` is off, by diffing a
      serialized fixture DOM before and after the attempt *G4.5*
- [x] 2.2 Prove the flag does not gate capture, normalization or delivery *G4.5*
- [x] 2.3 Prove the refusal is surfaced to the user rather than swallowed

## 3. Injection (G4.5)

- [x] 3.1 Place selected context in a second provider's composer on an explicit user action *G4.5*
- [x] 3.2 Prove nothing is submitted and no request carrying the context is issued by the extension
      *G4.5*
- [x] 3.3 Prove a failed injection leaves the user's draft unchanged *G4.5*
- [x] 3.4 Decide and record the maximum context size and how truncation is shown to the user, so a
      silent truncation cannot be mistaken for the full context

## 4. Gates

- [x] 4.1 Add the injection specs to the gate chain and require the full chain to pass
- [x] 4.2 Run the traceability gate and confirm every cited criterion resolves to a requirement
      heading
- [ ] 4.3 Update `docs/END-STATE.md` to move G4.5 out of the follow-up list once the manual gate has
      been run and its output recorded — **blocked on a person, not forgotten.** The gate is run by
      loading `dist/` unpacked, opening a real provider page whose composer the adapter knows, placing
      a hit's context into that composer and recording what appeared; no command in this repository
      can raise that action, so the tick stays open until a person has. It closes when that run is
      written up under section 8 below and this line is ticked in the same pass as the
      `docs/END-STATE.md` move. If a future window reaches for a shortcut: `npm run test:browser` and
      `npm run test:browser:providers` do **not** close it — they drive a fixture DOM and a fixture
      conversation, and a live signed-in composer is precisely what they cannot stand in for.

## 5. The action a user takes (G4.5, tasks 2.3, 3.1)

The path existed before it had a trigger: the worker answered `PLACE_CONTEXT` and no surface sent it.
An action with no way to invoke it discharges nothing, so the trigger is part of the change rather
than a later one — a placement control per local search hit in the side panel, which is also where
the refusal has to be shown.

- [x] 5.1 Offer placement on a hit the local index holds, and on no other hit, so the action cannot
      answer `CONTEXT_NOT_FOUND` by construction — `tests/surfaces/placement.spec.ts`
- [x] 5.2 Send the acknowledged record's id and no captured text, so the surface cannot be the side
      that decides what gets written into a page — `tests/surfaces/placement.spec.ts`

Gate evidence for this change (2026-09-14, Windows, Node v22.18.0):

```
npm run verify -> 0
  typecheck  0 | lint 0 | npm test 49 files / 771 tests, all passed | build wrote dist/content.js
npx vitest run `tests/capture/injection.spec.ts`     -> 0   Tests 25 passed
npx vitest run `tests/router/injection.spec.ts`      -> 0   Tests 8 passed
npx vitest run `tests/surfaces/placement.spec.ts`    -> 0   Tests 7 passed
npx vitest run `tests/options/inject.spec.ts`        -> 0   Tests 6 passed
npx vitest run `tests/quality/source-scans.spec.ts`  -> 0   Tests 44 passed
npm run test:traceability -> 0
  [traceability] criteria declared : 67 (docs/END-STATE.md)
  [traceability] criteria cited    : 67/67 by 56 requirement headings
  [traceability] test paths cited  : 183 in tasks.md
  [traceability] OK — every criterion is cited and every cited test path exists
npm run test:clarity -> 0
npx openspec validate capture-context-injection --strict -> 0   Change is valid
```

The traceability gate reports the whole repository rather than this change alone, so the path count
above is the count at the time of the last full run and grows as later changes add specs. The
`npm run verify` line is likewise a snapshot: it was 49 files and 771 tests when this change landed, and
the chain has since grown with the migration specs.

Ninety tests across five spec files, and each one holds a different half of the claim:

- The jsdom spec owns the page. It serialises a fixture, refuses with the setting off and requires the
  serialisation to be byte-identical; it places a ChatGPT capture into the Claude composer and reports
  the rung each slot resolved at; it asserts no `fetch` of any kind was issued and that no submit,
  click or key event was dispatched; it asserts a read-only composer and a page that discards the write
  both leave the draft exactly as it was; and it proves the ladder fails closed with a named code when
  the landmark is missing, a rung is ambiguous, or the field is outside the resolved root.
- The router spec owns the decision. With the setting off it asserts `INJECTION_DISABLED` *and* that
  `chrome.tabs.query` and `chrome.tabs.sendMessage` were never called — a refusal that still spoke to a
  page would satisfy "off" in the response body only. With it on, it asserts the page is handed the
  text and the source provider and no record id, that a page's refusal is relayed rather than converted,
  and that the request count of a placement is zero: `recorder.urls()` is `[]` after a successful
  placement, so nothing was sent to the core and no transport was constructed. The same file proves the
  two directions share no switch: a capture still reaches `/memory/add` while placement is off.
- The options spec owns the switch, and it is the one that reads a *live* document rather than a
  fixture. It asserts the flag's default is false; that the setting's name appears in exactly four
  files and its *value* is read in exactly one, `src/background.ts`, because a second reader is the
  moment the gate becomes advisory; that the perception layer — the adapters and the content script —
  contains no DOM-writing call at all; and that running every shipped adapter against a real document
  leaves its serialised markup byte-identical. The last one carries a positive control, so "the page
  did not change" cannot be satisfied by a path that never changes anything: the same call with the
  flag on does write, and the written field is read back as a property rather than from `outerHTML`,
  which jsdom serialises from a `<textarea>`'s default value.
- The source scans own the tree. `src/inject/` contains no network expression, no storage read and no
  transport import; it never clicks, submits or synthesises a key event; every composer selector literal
  lives under `src/inject/composers/`; and exactly one file writes to the page. Each rule's positive
  control is in the same file, so none of those absences is a misspelled pattern.
- The surface spec owns the user's end. It asserts the message a click sends is
  `{ type: "PLACE_CONTEXT", indexedId: <record id> }` with no captured text in it, that a success names
  the provider and says nothing was sent, that a cut-to-fit placement prints both lengths, and that a
  refusal prints its code and its reason — including the case where the worker reports no reason at all,
  which renders as a sentence rather than `undefined`.

Two rules had to bend to make the containment scans unconditional, and both are recorded rather than
worked around. The scans over `src/inject/` have **no comment exemption** — a comment is a place where
the boundary is stated and also a place where a call site gets written next — so three comments in the
injection tree now describe the routes they mean instead of naming them. That is a deliberate cost:
the gate is worth more than the sentence.

Task 4.3 is left unticked on purpose, and the task line itself now says so, so that it reads as blocked
rather than as abandoned. It is the manual gate: a person has to load the unpacked build, open a real
provider page, place context into a real composer and record what happened. No spec in this repository
can discharge it, and ticking it from a green test run would be the one claim in this change that is not
evidence-backed.

What a person should run *before* doing the part only they can do, so the manual step is short and its
result is unambiguous: `npm run build`, then `npm run test:browser:providers`, which loads that `dist/`
unpacked into a real Chrome and shows the five fixture conversations captured under `autoCapture`
against a core on a closed port. Neither that command nor any other reaches a composer. The injection
path is covered by `tests/router/injection.spec.ts`, `tests/capture/injection.spec.ts`,
`tests/options/inject.spec.ts` and `tests/surfaces/placement.spec.ts` — between them they drive the
message, the refusal and the DOM write into a fixture element, and none of them touches a provider's own
composer widget, which is the one object the manual gate exists to involve.
