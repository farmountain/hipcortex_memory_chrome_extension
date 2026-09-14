---
description: 'Use at every stage of work in this repo - defining goals, writing or reading acceptance criteria, planning validation and tests, handling an unknown or an assumption, planning a change, or deciding what to do next in a ReAct loop. Covers when to resolve a question from the artifacts yourself, when escalation to a person is allowed, and when to stop asking.'
applyTo: ["**/*"]
---

# Clarity protocol (this repo)

Full rules: `docs/CLARITY.md`. The ledger is `docs/clarity-ledger.json`, gated by
`npm run test:clarity`. Read the protocol before adding an entry; the gate enforces the shape.

## Order of resolution

Attempt every question in this order and stop at the first step that works:

1. **Read the artifact** — code, spec, `docs/PROTOCOL.md`, `docs/END-STATE.md`, the task file, an
   existing test.
2. **Run the artifact** — a command, a test, a gate, a live probe.
3. **Inspect the environment** — the machine, the registry, installed tooling. "It is not here" is an
   answer.
4. **Self-prompt a hypothesis, then falsify it** — write the hypothesis, name the check that would
   kill it, run the check.
5. **Escalate to a person.** Only if the question is *critical* (changes a criterion, moves a scope
   boundary, decides an irreversible action, or blocks) **and** steps 1-4 were tried and recorded.

Self-prompting outranks asking. A question the artifacts can answer is never put to the user: for an
endpoint, probe the runtime; for a module's responsibilities, read `AGENTS.md`; for a gate's spelling,
run it; for what was executed, the execution output is the authority.

## Non-negotiables

- **No fifth state.** Every question is `self-resolved`, `escalated`, `open-with-exit` or `withdrawn`.
  There is no `tbd`; a question without a state fails the gate.
- **Evidence is a command, a file or a probe** — never a recollection. Prose evidence fails the gate,
  because it cannot be re-run and so cannot be caught being wrong.
- **State what the evidence does not establish.** A passing spec is not a browser rendering
  anything. Write the limit next to the claim.
- **Record failed strategies.** The attempt that did not work is evidence; its failure is often the
  rule worth keeping.
- **Every open question needs an exit condition naming a change, section, gate, probe or actor.** A
  question parked without one never closes.
- **Budgets are finite**: 5 self-prompt attempts, 1 escalation round per question, no re-open without
  new evidence. At the budget, resolve, escalate, park or withdraw — do not keep going.
- **Non-critical unknowns never block.** Park them with an exit condition and continue. Blocking on an
  unknown nobody can answer is a way of never finishing.
- **Never in `src/`.** The mechanism is process and documentation. No shipped code may read the
  ledger, name this protocol, or generate a question — the extension perceives, it does not reason
  about its own uncertainty (G5.4). The spec scans for it.

## Stages that must record an entry

`goals` · `acceptance-criteria` · `validation-planning` · `unknowns` · `planning` · `react-iterations`

A stage where no question arose is recorded as **empty**, not omitted: "we did not think about it" and
"there was nothing to think about" must not look the same.

In a ReAct loop the exit is categorical, not a feeling: **continue** while a criterion is unreached
and the last observation moved it; **succeed** when every in-scope criterion has quoted evidence;
**fail** when a criterion cannot be reached within the budget; **escalate** only under the two
conditions above. A loop that has neither reached a criterion nor moved one is a stall, and the
budget is what catches it.
