## Why

`cortexbridge-perception-layer` establishes **acknowledged delivery**: a queue entry is removed
only after the runtime returns `success: true` plus a non-empty `record_id`, reaching a spill limit
is reported as a paused state with an unacknowledged count, and there is deliberately no loss
counter and no oldest-entry eviction.

What that change does not state is a **retention policy**. How long may the extension hold an
unacknowledged conversation? What is a user told after the queue has been paused for a week? Can a
user get their undelivered captures out without the core? Until those questions are answered, "the
extension never loses a capture" is true only for the lifetime of a browser profile, and the line
between *a delivery queue* and *a second cognitive substrate* is left to inference. That line is the
whole distinction the products rests on: the core retains, the extension guarantees acknowledged
delivery.

## What Changes

- **State the retention policy explicitly.** What the queue retains, the states it can be in, and
  the retention limit that is a *pause with a count* rather than a silent drop.
- **State the boundary as a requirement, not a comment.** The queue is a transport buffer. No
  retrieval path, no user-facing search and no reasoning may read it. Nothing in the extension may
  interpret what an unacknowledged conversation means.
- **Give the user an exit.** An undelivered queue must be exportable in a shape that can be imported
  into the core later, because the alternative is a store the user cannot get out of.
- **Record the anti-goals.** No bounded drop-oldest buffer, no loss counter, no silent expiry, and
  no rewriting of an entry while it waits — a capture that changes shape in the queue is no longer
  the capture that was acknowledged.

## Impact

- New capability specification: `retention-policy`.
- Affected code, when implemented: `src/capture/queue/**`, `src/capture/pipeline/**`, the capture
  status surface (`src/surfaces/**`), and `docs/PROTOCOL.md` for the export shape.
- **No behaviour delivered by `cortexbridge-perception-layer` is modified.** This change adds the
  policy that change deliberately left open; the acknowledgement rule it depends on is already
  implemented and gate-verified.
- Goal G4 (migration) is referenced here only at its export-shape boundary. Its criteria are owned
  by `substrate-migration`.
