# The retention horizon

**This document is about the queue, not about memory.** "Retention" here means *the extension is
still holding a capture it has not delivered yet*. It is not a TTL, not an expiry policy and not a
lifecycle for stored records — those belong to the core, and `docs/ARCHITECTURE.md` lists a
retention policy as something this repository must never gain. The two words collide; the
distinction is the whole point of this page.

## What is retained

One thing: a **capture event that was accepted and not yet acknowledged** by the runtime. It is
held as a queue entry in a single `chrome.storage.local` key (`hipcortex.capture.queue`), in FIFO
order, with its own retry schedule. Nothing else in this extension retains anything: settings live
in `chrome.storage.sync`, a search handoff lives in `chrome.storage.session`, and conversation
content never enters either.

An entry holds the event exactly as it was captured, plus four fields of bookkeeping:

| Field | Why it exists |
|-------|---------------|
| `attempts` | Counts deliveries attempted **through the queue**. The inline send that caused the enqueue is not one, so the first backoff is not double-counted. |
| `enqueuedAt` | When the capture was accepted, so FIFO order survives a restart. |
| `nextAttemptAt` | The schedule, persisted. A service worker evicted between attempts resumes the schedule instead of retrying on every wake. |
| `outcome`, `refusalReason` | What the last attempt concluded, and the runtime's own words if it refused. |

## The states an entry can be in

`EntryOutcome` has exactly three values, and they are three values rather than one "unacknowledged"
count on purpose:

| State | Meaning | What happens next |
|-------|---------|-------------------|
| `pending` | Enqueued, never attempted through the queue, or the last attempt's verdict was cleared. | It is due once `nextAttemptAt` passes. |
| `transient` | The attempt failed for a reason another attempt could still fix — the core was down, timed out, or answered with a status that is not an acknowledgement. | It is retried on the backoff schedule. |
| `refused` | The runtime made a **decision about this record** and said so, with its own reason text. | It is still retried, but the retry repeats the same answer until the condition the runtime named is fixed. |

The distinction is load-bearing and was the finding that produced this change. A `403` from the
runtime's PII precondition and a dropped connection used to produce the same number and no
explanation, so a capture that could never be delivered waited forever with nothing on screen to
say so. Collapsing a decision into an interruption is how a permanent refusal becomes invisible.

There is no fourth state. In particular there is no `dropped`, no `expired` and no `discarded`, and
adding one would be the failure this document exists to prevent.

## The horizon is a pause with a count, never an expiry

`QUEUE_SPILL_LIMIT = 500` is a **pause threshold, not a capacity**. At the limit:

- nothing is removed — not the oldest entry, not a batch, not anything;
- the queue reports `paused: true` and a count of what it is holding;
- **new** captures stop being accepted, and the refusal names the unacknowledged count and the
  paused state so the user can see why.

That is the entire horizon. There is no elapsed time after which a waiting capture stops being the
extension's responsibility, and no volume after which it does. The only way a count goes down is an
acknowledgement, and acknowledgement is **positive**: `success: true` *plus* a non-empty
`record_id`. A bare HTTP 2xx is a failure by design — that shape is the silent-success mode the
runtime's own read path was probed for.

An entry that cannot be delivered therefore waits **indefinitely** while the condition persists, and
the extension's answer to that is a number on screen and an export the user can take, not a policy
that quietly ends the wait.

## The user's exit

A horizon with no expiry needs an exit that does not require delivery, or "retained forever" is a
polite word for "stuck". `EXPORT_QUEUE` renders the backlog as an export document in the core's own
record shape (`docs/PROTOCOL.md` section 6.3), and the popup offers it exactly while there is
something to export.

Exporting **removes nothing and rewrites nothing**. An entry that has been exported is still an
entry that will be delivered, so "the user took their captures out" and "the runtime came back" are
not two competing futures. A refused entry is exported through the same path as a retrying one, with
the retry bookkeeping left behind — a verdict is this extension's opinion about a send attempt, not
part of the record.

## What this rules out

- **A bounded queue with drop-oldest.** Converts an outage into permanent data loss, which is the
  exact failure the product must not have. This policy existed in an early `design.md` (D5,
  500 entries) and was removed.
- **A loss counter.** A "dropped" figure is a number the product could display while having lost a
  conversation. `RetentionState` has no field for it, and the queue has no code path that could
  increment one.
- **Any eviction, including at the spill limit.** The limit pauses; it does not evict.
- **Silent expiry.** No TTL, no `expires_at`, no age-based removal. The core may attach its own
  expiry to what it stores — the extension has no opinion about the lifetime of a record it has
  handed over, and no mechanism for the lifetime of one it has not.
- **Retrying a refusal until it accidentally succeeds**, or re-shaping the record to get past a
  precondition. The refusal is recorded and reported in the runtime's own words, and left visible
  rather than worked around: redacting, filtering or rewriting captured text to make a send succeed
  is out of scope by decision, not by omission.
- **Reading the queue for meaning.** Measuring the backlog is the one use outside the queue; a
  module that reads individual entries, searches them, ranks them or derives an interpretation from
  a waiting capture would give the extension two claims about what was captured with no rule about
  which wins. A source scan enforces this.

## Evidence

- `tests/capture/queue.spec.ts` — removal is acknowledged-only, the spill limit removes nothing,
  the spill message names the count and the paused state, the backoff schedule, FIFO across a
  restart, the sync-storage ban, and a 2xx without a `record_id` leaving the entry unacknowledged.
- `tests/capture/queue-export.spec.ts` — the export is in the core's record shape, survives a round
  trip through a file, and removes nothing.
- `tests/quality/source-scans.spec.ts` — no module outside the queue reaches an entry or names a
  verdict; no recollection vocabulary where retention vocabulary is meant.
- **Executed against the live runtime on 2026-09-14** (runtime 3.11.0, `127.0.0.1:3030`): with the
  core stopped, 10 conversations were captured and reported `queued=10`; a drain reported
  `delivered=0 retained=10`; exporting that backlog returned `total=10` and left the queue at
  `queued=10`; after `hipcortex start` a single drain reported `delivered=10`, and
  `GET /memory/query?actor=…` returned 10 records with provenance and tags intact. The same run
  produced a real refusal — `delivered=0 refused=1 retrying=0` with the reason
  `precondition blocked: PII risk=0.90 patterns=["PII:1789363055"]` — and that refused capture was
  exportable while it was refused, with the queue unmoved at `queued=1 refused=1`. Quoted output is
  in `docs/END-STATE.md` section *Live verification*.

## What would falsify this

If a capture is ever lost without the user being able to see that it was lost, this policy is
broken regardless of how the loss occurred — a truncated storage write, an eviction added later, a
"cleanup" on start, a size cap on the value. If the product later promises browser-local memory —
recall of a conversation from the browser rather than a handover to the core — then this
interpretation has to be revisited, because the extension cannot both be a pass-through and a
memory. The two cannot both hold.
