## ADDED Requirements

### Requirement: The delivery queue reports its retention state instead of dropping entries (G2.2, G2.3)
The system SHALL retain every unacknowledged capture for as long as the capture has not been
acknowledged, and SHALL expose the retention state as discrete, user-visible values: the count of
unacknowledged entries, whether delivery is paused, and the reason for a pause. Approaching a
storage limit SHALL be reported as a paused state with an unacknowledged count. The system SHALL NOT
discard an entry to make room for a newer one, and SHALL NOT maintain a loss counter, because there
is no loss to count.

#### Scenario: A long-unacknowledged capture is still present
- **WHEN** a capture is queued and the runtime stays unreachable past the retention horizon
- **THEN** the entry is still in the queue, delivery is reported as paused, and the unacknowledged
  count still includes it

#### Scenario: Retention state is what the user sees
- **WHEN** the capture status surface renders while delivery is paused
- **THEN** it shows the paused state, the reason, and the unacknowledged count, and it never shows a
  "dropped" or "lost" figure

#### Scenario: A paused queue resumes without replaying a stale order
- **WHEN** the pause clears and delivery resumes
- **THEN** entries leave in FIFO order, each still carrying the `capturedAt` it was created with

### Requirement: A stopped core never expires an entry (G2.8)
The system SHALL treat the runtime being absent as a temporary condition. A stopped core SHALL NOT
be interpreted as a reason to expire, compact, or rewrite queue entries.

#### Scenario: Stop, capture, restart, deliver
- **WHEN** the core is stopped, several conversations are captured, and the core is started again
- **THEN** every one of them is delivered, in capture order, with its original content

### Requirement: The queue is a delivery mechanism, not a memory store (G2.1)
The system SHALL remove an entry only after the runtime acknowledges it with `success: true` and a
non-empty `record_id`. No retrieval path, no user-facing search and no reasoning logic SHALL read
the queue, and nothing in the extension SHALL derive meaning from an entry that is waiting.

#### Scenario: Only acknowledgement removes an entry
- **WHEN** the runtime answers with a 2xx that carries no `record_id`
- **THEN** the entry stays queued and is retried, and nothing is removed on the strength of the
  status code alone

#### Scenario: No read path exists over undelivered captures
- **WHEN** the source tree is scanned for readers of the queue outside `src/capture/queue/`
- **THEN** none is found, so an unacknowledged conversation cannot be searched, summarised or shown
  as if it were memory

### Requirement: Undelivered captures can always be taken out by the user (G4.1)
The system SHALL offer an export of the undelivered queue that uses the same record shape the core's
export uses, so that a queue export and a core export can be imported together without a translation
step. Export SHALL NOT delete anything.

#### Scenario: Export then continue delivering
- **WHEN** a user exports a non-empty queue and then the runtime becomes reachable
- **THEN** the export contains exactly the undelivered captures, and every one of them is still
  delivered afterwards

#### Scenario: Export shape matches the core's
- **WHEN** the exported records are compared with the fields the core's export preserves
- **THEN** `metadata`, `record_type` and the capture's own identifiers are present and named the same
  way, because a queued record and a stored record are the same record at different points in its
  life

### Requirement: A refusal that will never succeed is reported, not retried invisibly (G2.2, G2.3)
The system SHALL distinguish a temporary send failure, which is retried, from a deterministic
refusal the runtime reports with `success: false` and a reason, which cannot succeed on a retry. A
deterministic refusal SHALL be surfaced to the user together with the reason the runtime gave, and
SHALL NOT be indistinguishable from a temporary failure. Retention is unchanged by a refusal: the
capture SHALL remain in the queue and SHALL remain exportable, because discarding a capture the user
made is never the extension's decision.

#### Scenario: A capture the runtime refuses on policy
- **WHEN** the runtime answers a capture with `success: false` and a precondition reason, such as the
  PII risk refusal documented in `docs/PROTOCOL.md` §3.2
- **THEN** the capture stays queued and exportable, and the status surface names the refusal and its
  reason instead of showing one more unexplained unacknowledged entry

#### Scenario: A temporary failure is still retried
- **WHEN** the runtime is unreachable or answers with a transient error
- **THEN** the entry is retried with backoff and is not reported as refused

#### Scenario: A refused capture is delivered once the refusal lifts
- **WHEN** the runtime later accepts a capture it had refused
- **THEN** it is delivered and removed from the queue exactly like any other acknowledged capture
