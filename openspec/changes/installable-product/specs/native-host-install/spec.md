## ADDED Requirements

### Requirement: The health surface reports the connection states distinctly (G9.1)
The system SHALL report three connection states as separate values — the host is not registered with
this browser, the host is registered but its core is unreachable, and the connection is healthy — and
SHALL NOT render the first two as one message. A transport that can observe only a single failure
mode SHALL report no connection state, because inventing one from a single observation is a guess
presented as a measurement. A successful port handshake SHALL NOT on its own produce the healthy
state: opening a native messaging port proves the host is *registered*, and nothing more.

#### Scenario: Nothing is installed at all
- **WHEN** the browser has no host registered and the health surface is rendered
- **THEN** the not-registered state is shown, and the text reads as a missing install rather than as
  a reachability failure

#### Scenario: The host is registered and the core is stopped
- **WHEN** the host answers that its core refused the connection
- **THEN** the registered-but-unreachable state is shown, and the message is not the not-registered
  message

#### Scenario: An open port is not a healthy service
- **WHEN** the transport opens a native port successfully but the host reports its core is down
- **THEN** the state is registered-but-unreachable, because the handshake proved registration and not
  reachability

#### Scenario: One state, one account of it
- **WHEN** the popup badge and the side panel badge are rendered for the same report
- **THEN** they show the same state, because a single shared mapping produces both, so neither
  surface can drift into a second account of the same condition

#### Scenario: A transport with one failure mode is not given the native advice
- **WHEN** a report carries no connection state because its transport cannot distinguish the two
  failures
- **THEN** the endpoint wording is used and the native-only next action is absent, rather than the
  native advice being applied to a condition it does not describe

### Requirement: Every failure state names the action that ends it (G9.2)
The system SHALL name a next action for each failure state it reports, and the not-registered state
SHALL name the exact command that completes the install. No state the extension can observe SHALL be
reported as a failure with no next action, and no state SHALL name an action that cannot apply to it.

#### Scenario: The install was never completed
- **WHEN** the not-registered state is rendered
- **THEN** the message names `npm run install:host`, so a person who installed only the extension is
  told the one thing that finishes the job

#### Scenario: The core is stopped
- **WHEN** the registered-but-unreachable state is rendered
- **THEN** the message names starting HipCortex and does not name the install command, because
  reinstalling a host that is already registered cannot fix a stopped core

#### Scenario: The retired sentence does not return
- **WHEN** either failure state is rendered
- **THEN** the text "Check that HipCortex is running" does not appear, since it was the sentence shown
  to users who had no HipCortex to check

#### Scenario: Consumer Mode does not quietly use another transport
- **WHEN** either failure state is rendered in Consumer Mode
- **THEN** the message states that Consumer Mode does not fall back to HTTP, because a silent fallback
  would make the reported state untrue

### Requirement: Host registration is per-user and reversible (G9.3)
The installer SHALL register the host for the current user only. It SHALL NOT require elevation, SHALL
NOT write to a system-wide location, and SHALL be reversible by a documented command that removes both
the registration record and the manifest it wrote.

#### Scenario: No elevation, no system-wide write
- **WHEN** the installer plans an install on any supported platform
- **THEN** every path it would write is under the current user's home directory, and no plan targets a
  privileged location

#### Scenario: The target platform's separator is used
- **WHEN** an install is planned for a platform other than the one running
- **THEN** the paths are joined with the target platform's separator, so a plan for Windows is a valid
  Windows path even when produced elsewhere

#### Scenario: Uninstall reverses install
- **WHEN** the documented uninstall command runs after an install
- **THEN** the registration record and the manifest are both gone, and the host is no longer
  registered

### Requirement: The Consumer Mode envelope is executed, not assumed (G9.4)
The system SHALL exercise the native messaging contract rather than describe it: a real length-prefixed
frame written to the host's stdin SHALL be answered by a real length-prefixed frame on stdout, against
a real HTTP core. The host SHALL answer a side-effect-free health request without writing anything, and
SHALL report a stopped core as a typed failure rather than throwing or hanging.

#### Scenario: A capture frame crosses the boundary
- **WHEN** a capture frame is written to the host's stdin by a process that starts it the way Chrome
  does
- **THEN** a frame comes back on stdout carrying the core's `record_id`, and the core recorded the
  record that was sent

#### Scenario: The health probe writes nothing
- **WHEN** the health request is answered
- **THEN** the core was read with `GET /health` and no record was created, because a health check that
  writes is a health check nobody can run

#### Scenario: A stopped core is distinguishable from a host that never started
- **WHEN** the core URL points at a closed port
- **THEN** the host answers with a typed failure naming that URL, rather than exiting, throwing, or
  appearing identical to a host that was never installed

#### Scenario: Neither request type may leave this machine
- **WHEN** a capture or a health request targets a non-loopback URL
- **THEN** it is refused before any request is made, whatever the caller asked for

#### Scenario: The one leg no spec can run
- **WHEN** the Consumer Mode contract is described as verified
- **THEN** the description states that Chrome itself resolving a registered host and handing the port to
  a loaded extension is the single leg still unrun, because it requires a real browser and a loaded
  extension rather than a spawned process

### Requirement: Both install orders reach the same healthy state (G9.5)
The system SHALL reach the same healthy state whether the host was registered before the extension was
loaded or after it. The product SHALL NOT assert an ordering between installing the extension and
installing the host, and the reported state SHALL be a function of the current environment rather than
of the best state ever observed.

#### Scenario: Host first, then extension
- **WHEN** the host is registered and the extension is loaded afterwards
- **THEN** the connection test reports the healthy state

#### Scenario: Extension first, then host
- **WHEN** the extension is loaded first and the host is registered afterwards
- **THEN** the connection test reports the same healthy state, character for character identical to the
  host-first order

#### Scenario: A state that goes away is reported as gone
- **WHEN** a host that was healthy is later removed
- **THEN** the next test reports it as not registered, because a remembered success is not an
  observation
