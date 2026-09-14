## ADDED Requirements

### Requirement: Passive capture is opt-in and provider-scoped (G1.7, G7.5)
When `autoCapture` is enabled, the system SHALL capture conversations from supported AI sites
without user interaction. When `autoCapture` is disabled, the system SHALL NOT perform *passive*
extraction of any conversation. `autoCapture` SHALL gate passive capture only and SHALL NOT gate
user-initiated capture: manual capture, context-menu capture and keyboard capture SHALL work
regardless of its value. It SHALL NOT gate delivery either: an entry already queued SHALL drain
whether the flag is on or off. The default value of `autoCapture` SHALL be `false`.

#### Scenario: Capture runs when enabled
- **WHEN** `autoCapture` is enabled and a supported AI conversation page loads
- **THEN** a capture event for that conversation is produced without any user action

#### Scenario: Passive capture is inert when disabled
- **WHEN** `autoCapture` is disabled and a supported AI conversation page loads
- **THEN** no passive extract call occurs and no capture event is produced

#### Scenario: Manual capture works while passive capture is off
- **WHEN** `autoCapture` is disabled and the user invokes a manual or context-menu capture
- **THEN** the capture is performed and reaches the transport

#### Scenario: Unsupported pages are never captured
- **WHEN** a page on a non-provider site loads with `autoCapture` enabled
- **THEN** no adapter is selected and no capture event is produced

#### Scenario: Toggling the flag mid-flight loses nothing (G7.5)
- **WHEN** `autoCapture` is switched off while unacknowledged entries are queued
- **THEN** the queue still drains, so the flag changes what is captured and never what is delivered

### Requirement: Conversation-level capture with observable change detection
The system SHALL treat a conversation as the unit of capture. When the conversation changes, the
system SHALL produce an updated capture event reflecting the current conversation rather than
appending a duplicate of previously captured content.

#### Scenario: New message produces an updated event
- **WHEN** a new message is added to a captured conversation
- **THEN** a new capture event is produced whose message list includes the full current conversation

#### Scenario: Unchanged conversation produces no repeat event
- **WHEN** a DOM mutation occurs that does not change the extracted conversation
- **THEN** no new capture event is produced

#### Scenario: Rapid mutations are debounced
- **WHEN** a conversation mutates repeatedly within the debounce window
- **THEN** extraction runs only after mutations settle and not once per mutation

### Requirement: Durable queue with acknowledged delivery (G2.7, G2.8, G2.9)
Failed forwards SHALL be persisted in `chrome.storage.local` under a single queue key. An entry
SHALL be removed ONLY after the local runtime acknowledges receipt. The system SHALL NOT discard
an entry that the runtime has not acknowledged. When the configured spill limit is reached the
system SHALL report the condition and SHALL NOT discard silently. The queue SHALL NOT be stored
in `chrome.storage.sync`.

#### Scenario: Failure enqueues the event
- **WHEN** a forward fails
- **THEN** the event is persisted in the queue in `chrome.storage.local` with a recorded attempt count and remains until acknowledged

#### Scenario: Acknowledgement removes only the acknowledged entry
- **WHEN** the runtime acknowledges one entry
- **THEN** that entry is removed and every unacknowledged entry remains

#### Scenario: Unacknowledged entries are never discarded
- **WHEN** the queue reaches its spill limit
- **THEN** no existing entry is removed, the limit condition is reported, and the unacknowledged count is reported as non-zero

#### Scenario: A 2xx response without a record id is not an acknowledgement (G2.1, G2.9)
- **WHEN** the runtime responds with HTTP 200 but the body carries no `record_id`
- **THEN** the entry is retained in the queue and remains unacknowledged

#### Scenario: A backlog survives the runtime being down (G2.8)
- **WHEN** the runtime is stopped, ten conversations are captured, and the runtime is started again
- **THEN** all ten are delivered and each is retrievable from the runtime, because the queue retains them until the runtime acknowledges them

#### Scenario: Drain order is FIFO
- **WHEN** the queue is drained successfully
- **THEN** entries are sent in insertion order

#### Scenario: Conversation content never enters sync storage
- **WHEN** the extension writes queue or captured content
- **THEN** `chrome.storage.sync` receives no conversation content and no queue entries

### Requirement: Backoff survives service-worker termination (G2.6)
Retry scheduling SHALL use `chrome.alarms` and SHALL persist each entry's next-attempt time in
storage. The delay SHALL follow `min(2000 * 2^attempts, 300000)` milliseconds. A terminated
service worker SHALL NOT lose the retry schedule.

#### Scenario: Backoff is monotonic and capped
- **WHEN** successive attempts fail
- **THEN** the computed delay increases per attempt and never exceeds 300000 ms

#### Scenario: Schedule is persisted
- **WHEN** an entry is enqueued
- **THEN** its `nextAttemptAt` is stored alongside it so a restarted worker can resume the schedule

#### Scenario: Drain is triggered on worker start
- **WHEN** the service worker starts and the queue is non-empty with due entries
- **THEN** a drain is attempted

#### Scenario: Alarm permission is declared
- **WHEN** `public/manifest.json` is parsed
- **THEN** `permissions` contains `alarms`

### Requirement: Unacknowledged backlog is reported and bounded (G2.2, G2.3, G2.4)
The system SHALL report the number of unacknowledged captures as a non-negative integer together
with a `paused` flag. The system SHALL NOT maintain or report a loss count, because no capture is
removed before acknowledgement. When the configured spill limit is reached the system SHALL set
`paused` and SHALL NOT remove any entry.

#### Scenario: Counters are reported
- **WHEN** the UI requests capture status
- **THEN** it receives the current queue length, the unacknowledged count and the paused flag

#### Scenario: Spill is reported as actionable
- **WHEN** the spill limit is reached
- **THEN** the UI receives a message naming the unacknowledged count and stating that capture is paused

#### Scenario: Backlog growth removes nothing
- **WHEN** the number of unacknowledged captures grows past the spill limit
- **THEN** the reported count equals the number stored and no entry has been removed

### Requirement: Capture failures are recorded with a reason and no content (G2.5, G2.10)
A failed forward SHALL be recorded with its reason. A validation failure and a transport failure
SHALL be distinguishable in the stored record. A failure record SHALL contain only a timestamp, a
path, a code and a provider id, and SHALL NOT contain conversation text or the rejected event
body, so that bounding the failure log can never destroy captured conversation content.

#### Scenario: Transport failure is distinguishable from validation failure
- **WHEN** a stored failure is inspected
- **THEN** its reason identifies whether validation or transport caused it

#### Scenario: Failure record carries no conversation content
- **WHEN** a stored failure record is serialized
- **THEN** it contains no message text, no `target` text and no event body

#### Scenario: Failure log is bounded
- **WHEN** failures accumulate beyond the configured bound
- **THEN** the oldest failure record is discarded and no conversation content is destroyed because none was stored
