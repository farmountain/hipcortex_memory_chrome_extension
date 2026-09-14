# Clarity protocol

How a question gets answered in this repository, and how asking stops.

The problem this document solves is not "how do we ask a good question". It is that an agent (or a
person) can spend an unbounded amount of work either guessing or asking without ever reaching a
decision, and that both failure modes look like diligence while they are happening. Ambiguity is
therefore treated as an artifact with a lifecycle: it is raised, resolved against something that
exists, recorded, and closed — or explicitly parked with the condition that would close it.

Two rules order everything else:

1. **Self-prompting outranks asking.** A question that the artifacts can answer is never put to the
   user. Asking is the expensive, interruptive path and it is reserved for questions the artifacts
   cannot reach.
2. **Both loops are finite.** Neither self-prompting nor clarifying may continue indefinitely. A
   question has a fixed attempt budget, and a question left open must carry the condition that would
   close it.

## 1. Resolution order

Every question is attempted in this order and stops at the first step that succeeds.

| Step | Path | Ends when |
|------|------|-----------|
| 1 | **Read the artifact.** The code, the spec, `docs/PROTOCOL.md`, `docs/END-STATE.md`, the task file, an existing test | the artifact states the answer |
| 2 | **Run the artifact.** A command, a test, a gate, a live probe against the runtime | the command's output states the answer |
| 3 | **Inspect the environment.** The machine, the registry, the installed tooling, the file system | the environment states the answer, including "it is not here" |
| 4 | **Self-prompt a hypothesis, then try to falsify it.** Write the hypothesis down, name the check that would break it, run the check | the check confirms or kills the hypothesis |
| 5 | **Escalate.** Put the question to a person | a person answers |

Steps 1–4 are *self-resolution*. Step 5 is *clarification*. Steps 1, 2 and 3 are not passes over
your own memory dressed as checks: each one names a specific artifact, and the name goes in the
ledger. "I considered it" is step 4 with no check, which is not a resolution.

### When escalation is allowed

Escalation requires **both** conditions:

- **critical** — the answer changes an acceptance criterion, moves a scope boundary, decides an
  irreversible action (a write, a deletion, a published claim), or blocks the work; and
- **unreachable from artifacts** — steps 1–4 were tried and each one is recorded as tried, with why
  it did not reach the answer.

A question that is not critical is never escalated. It is recorded as open with an exit condition
and the work continues, because blocking on a non-critical unknown is a way of never finishing.

Examples of questions that *look* critical and are not escalations, because an artifact answers them:
which endpoint the core exposes (probe it); whether a gate command is spelled correctly (run it);
whether a file may touch the network (`AGENTS.md` says which module owns the network); whether a
name is right in a document that records what was executed (the execution output is the authority).

## 2. Lifecycle stages the protocol runs in

The mechanism is not a pre-flight checklist. It runs at each stage below, and each stage records its
own entries. A stage where no question arose is recorded as exactly that — an empty stage, not a
missing stage, because "we did not think about it" and "there was nothing to think about" must not
look the same in the record.

| Stage | What it asks | Artifact it produces |
|-------|--------------|----------------------|
| **goals** | What is the goal, stated as something that can be falsified? Which repository owns it? | the goal statement and its boundary |
| **acceptance criteria** | What command, output or observation would prove it — and does that criterion already exist? | criteria ids, or a decision that the criterion belongs to another change |
| **validation and testing planning** | What is the evidence, at what level (unit, gate, live probe, manual), and who can run it? | the test or gate named per criterion, and its scope (what it cannot prove) |
| **unknowns and uncertainty** | What is assumed rather than verified? What would falsify the assumption? | an assumption tied to a check, or an explicit open item |
| **planning** | Which single criterion does this step discharge? Is there a smaller change that does? | one task, one criterion, one proof |
| **ReAct iterations** | After each act: did the observation match the expectation? If not, what changed? | the observation, and a decision — continue, succeed, fail, or escalate |

The ReAct exit decision is deliberately categorical rather than a feeling: **continue** while a
criterion is still unreached and the last observation moved it, **succeed** when every criterion in
scope has quoted evidence, **fail** when a criterion cannot be reached within the attempt budget, and
**escalate** only under the two conditions in §1. A loop that has neither reached a criterion nor
moved one is not a loop, it is a stall, and the stall is what the attempt budget exists to catch.

## 3. The ledger

`docs/clarity-ledger.json` is the record. It is machine-read by `scripts/clarity.js` and gated by
`npm run test:clarity`, so the protocol is not a document that can silently stop being followed.

```json
{
  "id": "Q7",
  "stage": "react-iterations",
  "critical": true,
  "question": "...",
  "state": "self-resolved",
  "attempts": 5,
  "artifactsTried": ["each one named, and what it did not answer"],
  "evidence": ["$ command -> output"],
  "resolution": "..."
}
```

### States

| State | Means | Required alongside it |
|-------|-------|-----------------------|
| `self-resolved` | steps 1–4 reached the answer | non-empty `evidence`, each item reducible to a command, a file or a probe |
| `escalated` | a person was asked | `escalation.question`, `escalation.whyArtifactsFailed`, `escalation.decidedBy`, and `critical: true` |
| `open-with-exit` | deliberately parked | `exitCondition` naming what would close it, and the change or actor that owns it |
| `withdrawn` | the question dissolved | `reason` |

There is no fifth state. In particular there is no `tbd`: a question without one of these four states
fails the gate, because "we will decide later" is indistinguishable from "we forgot".

### Exit conditions

- `attempts` may not exceed `policy.maxSelfPromptAttempts` (5). At the budget the question must be
  resolved, escalated, parked, or withdrawn.
- `escalated` may be used at most `policy.maxEscalationsPerQuestion` (1) time per question. A second
  round of the same question with no new artifact is a stall.
- Re-opening a settled question requires `newEvidence` naming what changed. A question may not be
  re-opened because someone thought about it again.
- `open-with-exit` requires an exit condition: a change name, an actor, or a check. It may not be
  "later", "TBD", or "unknown", which name nothing.

## 4. Evidence discipline

A resolution is only as good as what it points at. Three rules follow from that, and they are the
reason this is gated rather than trusted.

- **Evidence is a command, a file, or a probe — never a recollection.** A `self-resolved` entry whose
  evidence is prose fails the gate, because prose cannot be re-run and therefore cannot be wrong in a
  way anyone would notice.
- **A failed strategy is evidence and gets recorded.** The ledger records the attempts that did not
  work, with the failure. This repository's own example is Q7: five PowerShell attempts at counting
  tests per directory, each recorded as failed, producing a rule ("when a one-liner fails twice, move
  the logic into a script") that outlives the attempt.
- **What the evidence does not establish is written next to the evidence.** A spec that proves a
  function's behaviour is not evidence that a browser renders anything, and saying so is not
  pessimism — it is the difference between a claim and an overclaim.

## 5. What this protocol does not do

- **It does not reason, and it never ships.** Nothing in `src/` may read this document, the ledger,
  or generate a question. The extension perceives and delivers; a clarification loop inside it would
  be cognition in the perception layer, which `AGENTS.md` and G5.4 forbid. The gate scans for it.
- **It does not make the extension's behaviour depend on it.** Deleting this document and the ledger
  changes no shipped behaviour. What breaks is the ability to show how a claim was reached.
- **It does not replace a person.** It decides *when* to ask and *when to stop asking*, not what the
  answer should be.

## 6. How it is enforced

```
npm run test:clarity      # validates docs/clarity-ledger.json against the rules above
```

`scripts/clarity.js` fails on: an unknown state; a missing stage; a question that belongs to no stage
or to two; a duplicate or malformed id; `self-resolved` without reducible evidence; `escalated`
without both criticality and a record of why the artifacts did not reach it; `open-with-exit` without
a real exit condition; an attempt count over the budget; a re-open without new evidence.

The gate is its own command and is deliberately **not** folded into `npm run verify`. `verify` is
pinned to exactly four gate commands by `tests/quality/gates.spec.ts`, and that assertion is itself
part of the evidence that the gate chain is what it claims to be. Changing the chain to make room for
this one would have meant weakening a test to add a document — the trade the protocol exists to
refuse. The cost of the choice is stated plainly: `npm run verify` alone does not check the ledger,
so the ledger gate has to be run by name.
