## 1. The protocol (CP1, CP2, CP5, CP7)

- [x] 1.1 Write `docs/CLARITY.md`: the resolution order, with self-prompting above asking, and the
      two conditions that permit escalation *CP1*
- [x] 1.2 State the four question states and the fields each implies, and state that there is no fifth
      state *CP2*
- [x] 1.3 State the exit conditions: five self-prompt attempts, one escalation round, no re-open
      without new evidence, and an exit condition naming what closes a parked question *CP5*
- [x] 1.4 State the six lifecycle stages, what each asks, and the artifact each produces *CP7*
- [x] 1.5 State the ReAct exit decision categorically — continue, succeed, fail, escalate — and state
      that a loop which moves no criterion is a stall *CP7*
- [x] 1.6 State what the mechanism does not do: it does not reason, it does not ship, and it does not
      make shipped behaviour depend on it *CP8*

## 2. The ledger and the gate (CP2, CP3, CP4, CP5, CP9)

- [x] 2.1 Create `docs/clarity-ledger.json`: the policy object, the six stages, and the first entries
      — real questions from the preceding change, not invented examples
- [x] 2.2 Write `scripts/clarity.js`: validate the version, the policy, the stages, the ids, the
      ordering, and each state's required fields *CP2*
- [x] 2.3 Enforce reducible evidence and a `doesNotEstablish` limit on every self-resolution, so a
      resolution recorded as prose fails *CP3*, *CP4*
- [x] 2.4 Enforce the attempt budget, the escalation limit, and the new-evidence rule for a re-open;
      fail a policy budget raised above five *CP5*
- [x] 2.5 Enforce stage coverage in both directions: every stage present, every question in exactly
      one stage, and no stage naming a question that does not exist *CP7*
- [x] 2.6 Expose it as `npm run test:clarity`, its own command, and record in `docs/CLARITY.md` §6
      that `npm run verify` therefore does not check the ledger, and why the chain was not changed
      *CP9*

## 3. The gate's own proof (CP9)

- [x] 3.1 Add `tests/quality/clarity.spec.ts`: a valid fixture that passes, so every case below is not
      vacuous
- [x] 3.2 A case per rule, each a deliberately malformed ledger that must trip that rule and no other
      *CP2*, *CP3*, *CP4*, *CP5*, *CP7*
- [x] 3.3 Spawn the real command: exit 0 on the committed ledger, exit 1 on a malformed one, exit 1 on
      unparseable JSON, and a named-but-missing ledger reported rather than thrown *CP9*
- [x] 3.4 Assert the gate is its own command and is not inside `npm run verify`, and that the verify
      chain is still exactly its four commands — the cost of not folding it in, recorded as a test
      *CP9*
- [x] 3.5 Scan `src/` for any mention of the protocol or the ledger, and prove the scan can fail
      *CP8*

## 4. Wiring it into how work is done (CP1, CP7)

- [x] 4.1 Add `.github/instructions/clarity-protocol.instructions.md` with `applyTo: ["**/*"]`, so the
      order of resolution and the stop conditions are present at every stage and not only when
      somebody remembers to open the document
- [x] 4.2 Add step 0 to the working agreement in `AGENTS.md`, and list the protocol, the ledger and
      the gate under related customizations

## 5. Evidence

- [x] 5.1 Run the gate on the committed ledger and record its output
- [x] 5.2 Run the spec and record the count
- [x] 5.3 Re-run the full gate chain and the traceability gate, and confirm the 62 declared criteria
      are untouched by this change

## 6. Not part of this change

- [x] 6.1 Nothing under `src/` changes *CP8*
- [x] 6.2 `npm run verify` keeps exactly four commands *CP9*
- [x] 6.3 `docs/END-STATE.md` gains no criterion: the mechanism is process, and its criteria are the
      CP1 to CP9 requirements above

Gate evidence for this change (2026-09-14, Windows, Node v22.18.0):

```
npm run test:clarity  -> 0
  [clarity] ledger           : docs/clarity-ledger.json
  [clarity] questions        : 9 (self-resolved=7 open-with-exit=1 withdrawn=1)
  [clarity] stage coverage   : goals=1 acceptance-criteria=1 validation-planning=1 unknowns=2 planning=2 react-iterations=2
  [clarity] OK - every question has a state, a stage, reducible evidence, and an exit where it needs one

npx vitest run tests/quality/clarity.spec.ts -> 0   Test Files 1 passed (1) / Tests 47 passed (47)

npm run typecheck -> 0 | npm run lint -> 0 | npm test -> 0 (37 files / 590 tests)
npm run build -> 0 | npm run test:traceability -> 0 (62/62 criteria, 151 test paths)
npx openspec validate clarity-protocol --strict -> 0   Change 'clarity-protocol' is valid
```

One finding from the first run of the gate, kept because it is the kind of thing this gate exists to
catch: the initial exit-condition rule rejected a real ledger entry whose exit condition contained the
words "later than 3.11.0". The rule was too blunt — it matched a version comparison as vagueness — so
it was refined to reject only placeholders and promises and to require a named owner (a change, a
section, a gate, a probe or an actor). The first run of the spec failed for a different reason: the
out-of-order-id case did not actually produce an out-of-order id, so the check was proved vacuous by
its own test. Both are recorded rather than tidied away, because a rule that fails on first contact is
the evidence that it is doing something.
