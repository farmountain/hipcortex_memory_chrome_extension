## Why

Several real ambiguities in this repository were resolved by **not** asking anybody: which endpoint
the core exposes (probed), whether a gate could be added to a chain (the chain's own test said no),
whether a native host existed on the machine (the registry said it did not), and how to count tests
per directory (five failed shell attempts, then a script). Every one of those produced a better answer
than a question would have, and none of them produced a *record*.

What the repository lacked was not diligence. It was a rule for the order of resolution, a place to
write the answer down, and a **stop condition**. Without those, three failures are invisible:

- **Asking too early.** A question answerable by reading a file is put to a person, and the answer is
  worse than the file because the person is remembering rather than reading.
- **Never stopping.** Self-prompting or clarifying continues indefinitely and looks like work the
  whole time. Nothing in the loop knows it is failing.
- **Claiming a resolution that cannot be checked.** "We reasoned it through" is indistinguishable in
  a written record from a probe that returned a status code. One can be wrong in a way anyone would
  notice; the other cannot.

This change makes the mechanism an artifact: a protocol, a machine-readable ledger, a gate that reads
it, and the criteria the gate enforces. It is deliberately **process**, not product — nothing ships,
and nothing under `src/` may know it exists.

## What Changes

- **State the resolution order** — read the artifact, run the artifact, inspect the environment,
  self-prompt a hypothesis and falsify it, then escalate — and state that self-prompting outranks
  asking.
- **Define the four question states** (`self-resolved`, `escalated`, `open-with-exit`, `withdrawn`)
  and require the fields each one implies, so a question cannot be left in a undefined state. There is
  no `tbd`.
- **Require reducible evidence.** A self-resolution cites a command, a file or a probe. Prose fails the
  gate, and every self-resolution states what its evidence does *not* establish.
- **Require an exit condition on anything parked**, naming the change, section, gate, probe or actor
  that closes it.
- **Bound both loops.** Five self-prompt attempts, one escalation round per question, no re-open
  without new evidence, and non-critical unknowns never block.
- **Require the six lifecycle stages to record an entry** — goals, acceptance criteria, validation and
  testing planning, unknowns, planning, ReAct iterations — with an empty stage recorded as empty.
- **Gate it.** `npm run test:clarity` validates the ledger; a spec proves each rule can fail.

## Impact

- **New:** `docs/CLARITY.md`, `docs/clarity-ledger.json`, `scripts/clarity.js`, `scripts/clarity.d.ts`,
  `tests/quality/clarity.spec.ts`, `.github/instructions/clarity-protocol.instructions.md`.
- **Changed:** `package.json` (one new command), `AGENTS.md` (one new working-agreement step and one
  reference), and this change.
- **Not changed:** every acceptance criterion in `docs/END-STATE.md` stays as it is; no production
  file under `src/` is touched; `npm run verify` keeps exactly its four commands.
