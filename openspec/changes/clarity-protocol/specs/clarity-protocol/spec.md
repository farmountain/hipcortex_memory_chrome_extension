## ADDED Requirements

### Requirement: Self-prompting outranks asking (CP1)
Before a question is put to a person, the system SHALL attempt it in a fixed order — read the
artifact, run the artifact, inspect the environment, then self-prompt a hypothesis and try to falsify
it — and SHALL escalate only when the question is critical *and* the artifacts cannot reach it. A
question that an artifact answers SHALL NOT be escalated.

#### Scenario: A question the artifacts can answer
- **WHEN** a question can be answered by reading a file, running a command, or inspecting the machine
- **THEN** it is resolved that way, the artifact is named in the ledger, and no person is asked

#### Scenario: Escalation records why the artifacts failed
- **WHEN** a question is critical and steps 1 to 4 each failed to reach it
- **THEN** the escalation records the question, why the artifacts did not answer it, and who answers it

#### Scenario: A non-critical unknown is not escalated
- **WHEN** an unknown is worth recording but does not change a criterion, a scope boundary or an
  irreversible action
- **THEN** it is parked with an exit condition and the work continues

### Requirement: Every question holds one of four states, and there is no fifth (CP2)
Each recorded question SHALL be in exactly one of `self-resolved`, `escalated`, `open-with-exit` or
`withdrawn`, and SHALL carry the fields that state implies. A question without one of those states
SHALL fail the gate.

#### Scenario: An undefined state fails the gate
- **WHEN** a question is recorded with no state, or with a placeholder such as `tbd`
- **THEN** the gate fails and names the question

#### Scenario: A settled question carries its outcome
- **WHEN** a question is `self-resolved`
- **THEN** it carries a resolution and evidence, so the outcome is readable without the conversation

### Requirement: A self-resolution is backed by evidence that can be re-run (CP3, CP4)
A `self-resolved` question SHALL cite at least one piece of evidence reducible to a command, a file or
a probe, and SHALL state what that evidence does not establish. Evidence consisting of reasoning
alone SHALL fail the gate. A question that records no artifact as tried SHALL fail the gate.

#### Scenario: Prose fails as evidence
- **WHEN** a self-resolution cites only a description of what the author concluded
- **THEN** the gate fails and states that the evidence is not a command, a file or a probe

#### Scenario: Every resolution names its own limit
- **WHEN** a question is `self-resolved`
- **THEN** it also records what the evidence does not establish, so a passing check is not read as a
  broader claim than it is

#### Scenario: The attempts that failed are recorded
- **WHEN** a strategy was tried and did not work
- **THEN** it appears in the record with its failure, because a failed attempt is what produces the
  rule that outlives it

### Requirement: Anything parked carries an exit condition that names what closes it (CP5)
An `open-with-exit` question SHALL carry an exit condition naming a change, a section, a gate, a probe
or an actor. An exit condition that is vague, or that names no owner, SHALL fail the gate. A
`withdrawn` question SHALL state the reason it dissolved.

#### Scenario: A vague exit condition fails
- **WHEN** an open question's exit condition is a placeholder or a promise with no owner
- **THEN** the gate fails and quotes the condition

#### Scenario: A parked question does not block
- **WHEN** a non-critical question cannot be answered from the artifacts
- **THEN** the work continues, and the question stays visible with the condition that would close it

### Requirement: Both loops are bounded, and the bounds are enforced (CP5)
The ledger SHALL declare a self-prompt attempt budget of at most five attempts and at most one
escalation round per question, and SHALL require new evidence before a settled question is re-opened.
The gate SHALL fail a question that exceeds the budget, a re-open that names no new evidence, and a
policy whose attempt budget has been raised above five.

#### Scenario: The attempt budget is reached
- **WHEN** a question is still unresolved after five self-prompt attempts
- **THEN** it must be resolved, escalated, parked or withdrawn, and may not simply continue

#### Scenario: A settled question is re-opened
- **WHEN** a question that was already settled is re-opened
- **THEN** the re-open names the new evidence, or the gate fails

#### Scenario: The budget is raised to keep a loop alive
- **WHEN** the ledger's attempt budget is set above five
- **THEN** the gate fails, because raising the bound is how the loop it bounds survives

### Requirement: Each lifecycle stage records an entry, including an empty one (CP7)
The ledger SHALL name the six stages of the lifecycle — goals, acceptance criteria, validation and
testing planning, unknowns, planning, and ReAct iterations — and SHALL record, for each stage, the
questions raised in it. A stage that arises no question SHALL be recorded as empty rather than
omitted. Every question SHALL belong to exactly one stage.

#### Scenario: A missing stage fails
- **WHEN** a stage is absent from the ledger
- **THEN** the gate fails, because "we did not think about it" and "there was nothing to think about"
  would otherwise look the same

#### Scenario: A question belongs to one stage
- **WHEN** a question is listed under two stages, or through no stage, or under a stage that disagrees
  with the question's own
- **THEN** the gate fails and reports the inconsistency

#### Scenario: The ReAct exit decision is categorical
- **WHEN** an iteration completes
- **THEN** the decision is one of continue, succeed, fail or escalate: continue while a criterion is
  unreached and the last observation moved it, succeed when every in-scope criterion has quoted
  evidence, fail when the budget is exhausted, and escalate only under the two conditions in CP1

### Requirement: The mechanism stays out of the shipped extension (CP8)
Nothing under `src/` SHALL read the ledger, name the protocol, or generate a question. The mechanism
SHALL be process and documentation, and deleting it SHALL change no shipped behaviour.

#### Scenario: The perception layer does not reason about its own uncertainty
- **WHEN** the source tree is scanned for references to the protocol or the ledger
- **THEN** none is found, so a clarification loop cannot enter the extension unnoticed

#### Scenario: Removing the mechanism
- **WHEN** the protocol, the ledger and the gate are deleted
- **THEN** every shipped behaviour is unchanged; what is lost is the ability to show how a claim was
  reached

### Requirement: The gate reads the ledger and can fail (CP9)
`npm run test:clarity` SHALL validate the committed ledger and exit non-zero when a rule is broken.
The gate SHALL be exposed as its own command and SHALL NOT be presented as part of `npm run verify`
while the verify chain remains pinned to four commands by `tests/quality/gates.spec.ts`. Each rule
SHALL have a spec that proves it can fail.

#### Scenario: A well-formed ledger passes
- **WHEN** the committed ledger satisfies every rule
- **THEN** the gate prints the question count, the states and the stage coverage, and exits zero

#### Scenario: A drifted ledger fails the process
- **WHEN** a ledger violates any single rule
- **THEN** the gate exits non-zero and names the question and the rule it broke

#### Scenario: The gate's scope is stated rather than implied
- **WHEN** a reader asks whether `npm run verify` checks the ledger
- **THEN** `docs/CLARITY.md` states that it does not, and why the chain was not changed to make it

#### Scenario: The rules are not vacuous
- **WHEN** the spec is read
- **THEN** each rule is exercised by a deliberately malformed ledger that must trip it
