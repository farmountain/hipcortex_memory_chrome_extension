## ADDED Requirements

### Requirement: Settings shape covers modes and capture
`ExtensionSettings` SHALL include `apiUrl`, `apiKey`, `defaultActor`, `autoCapture`,
`injectIntoAiChats`, `headroomMode` and `transportMode`. The defined defaults SHALL be applied
whenever settings are read, so a missing stored key never yields `undefined`. Settings SHALL
persist through `chrome.storage.sync`; ephemeral handoff such as `pendingSearch` SHALL remain in
`chrome.storage.session`.

#### Scenario: Defaults fill missing keys
- **WHEN** settings are read from empty storage
- **THEN** the result equals the defined defaults including `autoCapture: false` and `transportMode: "auto"`

#### Scenario: Partial settings merge over defaults
- **WHEN** storage contains only `apiUrl`
- **THEN** the read result contains the stored `apiUrl` plus defaults for every other key

#### Scenario: Settings round-trip
- **WHEN** settings are saved and read back
- **THEN** every persisted field matches what was saved

#### Scenario: Ephemeral handoff does not use sync
- **WHEN** a pending search query is handed to the side panel
- **THEN** it is written to `chrome.storage.session` and no sync key is written

### Requirement: Options page exposes transport mode
The options page SHALL offer a transport mode control with `auto`, `consumer` and `developer`
choices, SHALL persist the selection, and SHALL display the resolved mode and fallback state
after a connection test.

#### Scenario: Mode control reflects stored value
- **WHEN** the options page loads
- **THEN** the mode control shows the stored mode

#### Scenario: Mode change persists
- **WHEN** the user selects a different mode and saves
- **THEN** a subsequent settings read returns the new mode

#### Scenario: Test connection reports resolved mode
- **WHEN** the user tests the connection successfully
- **THEN** the status text names the resolved mode and indicates whether a fallback occurred

#### Scenario: Test failure is actionable
- **WHEN** the connection test fails
- **THEN** the status text states that the local runtime is unreachable and names the endpoint or host that was tried

### Requirement: Capture status is visible (G2.3, G2.4)
The extension SHALL display capture state: whether passive capture is enabled, the current queue
length, the number of unacknowledged captures, and whether capture is paused. A non-zero
unacknowledged count SHALL be visually distinguishable from zero. The UI SHALL NOT display a
loss counter, because no capture is removed before acknowledgement.

#### Scenario: Status renders queue counters
- **WHEN** the UI requests capture status
- **THEN** it displays the queue length, the unacknowledged count and the paused flag

#### Scenario: Backlog is emphasized
- **WHEN** the unacknowledged count is greater than zero
- **THEN** the UI marks that value distinctly from a zero value

#### Scenario: Paused state is stated, not implied
- **WHEN** the spill limit has been reached and capture is paused
- **THEN** the UI states that capture is paused and names the unacknowledged count

#### Scenario: Passive capture disabled is stated
- **WHEN** `autoCapture` is disabled
- **THEN** the UI states that passive capture is off rather than showing a stale count, and still offers manual capture

### Requirement: Capture actions give feedback
Every user-initiated capture action SHALL produce observable feedback on success and on failure.
A failing action SHALL NOT silently reset the input.

#### Scenario: Manual capture reports success
- **WHEN** a manual capture succeeds
- **THEN** a success indication is shown and the input is cleared

#### Scenario: Manual capture failure preserves input
- **WHEN** a manual capture fails
- **THEN** an error containing the failure reason is shown and the entered text is preserved

#### Scenario: Badge reflects capture outcome
- **WHEN** a context-menu or keyboard capture succeeds or fails
- **THEN** the action badge reflects the outcome and later clears

### Requirement: Injection is gated and inert by default
`injectIntoAiChats` SHALL default to `false`. When `false`, the extension SHALL NOT write any
content into a provider page. When `true`, the setting SHALL gate the behavior but SHALL NOT by
itself enable any page mutation that is not implemented.

#### Scenario: Injection default is off
- **WHEN** settings are read from empty storage
- **THEN** `injectIntoAiChats` is `false`

#### Scenario: No page writes while injection is off
- **WHEN** capture runs with `injectIntoAiChats` disabled
- **THEN** no provider page DOM node is created, modified or removed by the extension

#### Scenario: Enabling the flag does not mutate pages
- **WHEN** `injectIntoAiChats` is enabled before context injection is implemented
- **THEN** no page mutation occurs and no error is produced

### Requirement: Remote egress requires confirmation and a banner (G7.2, G7.4)
The extension SHALL require explicit confirmation before a non-loopback egress base URL can be
saved. The confirmation SHALL name the exact host. While a non-loopback base URL is configured,
the extension SHALL display a persistent banner in the popup and side panel stating that captured
conversations leave the machine. The banner SHALL NOT be dismissible in a way that suppresses it
permanently while the configuration stands.

#### Scenario: Non-loopback base URL requires a naming confirmation
- **WHEN** the user saves a base URL whose host is not loopback
- **THEN** a confirmation naming that host is required before the value is persisted

#### Scenario: Declining leaves the previous value
- **WHEN** the user declines the confirmation
- **THEN** the stored base URL is unchanged and no request is made to the new host

#### Scenario: Banner shows while remote egress is configured
- **WHEN** the stored base URL host is not loopback
- **THEN** the popup and side panel display a persistent banner naming the host

#### Scenario: Banner disappears when egress returns to local
- **WHEN** the stored base URL host is loopback
- **THEN** no remote-egress banner is displayed

### Requirement: Messaging contract stays in one place
Every new cross-context behavior SHALL be expressed as a `MessageType` union member in
`src/types/index.ts` with a matching `case` in the service-worker router. The router SHALL keep
the response channel open for asynchronous handlers.

#### Scenario: New message types are declared
- **WHEN** the message union is inspected
- **THEN** it includes variants for settings read/write, health check, capture status, memory add, memory search and quick capture

#### Scenario: Router covers every declared variant
- **WHEN** the router's switch is compared against the message union
- **THEN** every variant has a handling case and there is no fallthrough for a declared type

#### Scenario: Unknown message types are rejected
- **WHEN** the router receives an unrecognized message type
- **THEN** it responds with `success: false` and an error naming the unknown type

#### Scenario: Async handlers keep the channel open
- **WHEN** the router handles a message that performs asynchronous work
- **THEN** the listener returns `true` so the response can be sent later
