## Context

`cortexbridge-perception-layer` established how claims are *proved*: one acceptance criterion at a
time, a real command, recorded output, no deferred verification. What it did not establish is how a
question that has no artifact behind it gets answered, or how either "I'll work it out" or "let me ask"
stops.

The repository already contains the raw material for the answer. `docs/CLARITY.md` is new; the
behaviour it codifies is not, and the ledger's first entries are real questions from the change that
preceded this one rather than invented examples.

## Decisions

### 1. The mechanism is process, not product, and it never enters `src/`

`AGENTS.md` states the extension perceives and does not reason, and G5.4 has a source scan enforcing
it. A clarification loop inside the extension — reading its own uncertainty, generating a question,
waiting for an answer — is cognition in the perception layer, and it would also make shipped behaviour
depend on a document. So the mechanism lives in `docs/`, `scripts/`, `tests/` and `.github/`, and
`tests/quality/clarity.spec.ts` scans `src/` for any mention of it.

*Alternative rejected:* a "pending question" entry in the queue state. It would put the protocol on the
delivery path, where a malformed ledger could stall a capture. Correctness of delivery outranks
convenience of process.

### 2. The ledger is JSON, and the prose is a separate document

A table inside `docs/CLARITY.md` was the first shape considered and rejected: parsing a Markdown table
in a gate is a source of false failures, and this repository has already lost time to shell text
scraping. `docs/clarity-ledger.json` is data; `docs/CLARITY.md` explains the rules the data must
satisfy. The gate reads the data and prints the prose-relevant summary (states, stage coverage).

### 3. Evidence must be reducible, and the gate checks that mechanically

The rule "evidence is a command, a file or a probe, never a recollection" is only real if something
enforces it. Each evidence item must match a command marker, an output arrow, or a filename with an
extension. That is a coarse test — it cannot tell whether the command output was honest — but it
cheaply rejects the specific failure mode this change is about: a resolution recorded as prose.

Every `self-resolved` entry must also carry `doesNotEstablish`. This is the discipline the previous
change arrived at the hard way (a spec that proves a function's behaviour is not evidence that a
browser renders anything), promoted from a habit into a required field.

### 4. Parking is a state, not a gap, and parking requires an exit condition

An unknown nobody can answer must not block the work, and it must not silently disappear either. The
compromise is `open-with-exit`: the question is recorded, marked non-critical, and carries the
condition that closes it. The gate rejects an exit condition that is vague ("TBD", "at some point") or
that names no owner — a change, a section, a gate, a probe or an actor. The first run of the gate
failed on exactly this rule, on a real ledger entry whose exit condition contained the words "later
than 3.11.0": the rule was too blunt and the check was refined to require a named owner.

### 5. The budgets are the stop condition, and they are policy, not litterature

Five self-prompt attempts, one escalation round, no re-open without new evidence, all in
`policy` in the ledger and enforced per entry. The gate also refuses a ledger whose policy budget has
been raised above five: raising the bound to keep a looping question alive is the failure the bound
exists to prevent. The first time this mattered was real — five shell attempts at one measurement
before the strategy changed.

### 6. The gate is its own command, and that costs something

Folding the ledger check into `npm run verify` reads better than not folding it in. It was not done
because `tests/quality/gates.spec.ts` pins `verify` to exactly four commands in order, and a change
that loosens a test in order to add a document is the trade this protocol exists to refuse. So
`npm run test:clarity` stands alone beside `test:traceability`, and `docs/CLARITY.md` §6 states the
consequence plainly: `verify` alone does not check the ledger.

## Risks

- **A ledger can be filled in carelessly and still pass.** The gate checks shape, not truth; a
  fabricated command string satisfies it. The mitigation is structural, not mechanical: the ledger is
  small, referenced from `AGENTS.md`, and its entries are read by whoever is doing the work. This is
  recorded as the mechanism's own limit rather than presented as a solved problem.
- **Two authorities could drift.** `docs/CLARITY.md` and `scripts/clarity.js` must agree on the rules.
  The spec asserts the document names the ledger file and the gate command, which is a weak check on
  purpose: the strong check is that the gate's messages name the rule they enforce, so a reader of a
  failure lands on the right paragraph.
- **The stage list is a claim about how work happens.** Six stages, each of which must record an entry
  (possibly an empty one). If a stage never applies to this repository, the honest fix is to remove it
  from the list rather than to fill it with noise.
