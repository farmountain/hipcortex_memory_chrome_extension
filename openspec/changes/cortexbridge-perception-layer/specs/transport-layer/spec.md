## ADDED Requirements

### Requirement: Transport interface abstraction
The system SHALL define a `Transport` interface exposing `mode`, `health()`, `send(event)`,
`search(query, limit)` and `addMemory(record)`. The transport layer SHALL be the only code
permitted to call `fetch` or `chrome.runtime.connectNative`.

#### Scenario: Both transports satisfy the interface
- **WHEN** the HTTP and native transports are type-checked against `Transport`
- **THEN** compilation succeeds for both

#### Scenario: Network access is confined to the transport layer
- **WHEN** all files under `src/` outside `src/api/` are scanned
- **THEN** none of them contains a `fetch(` call

#### Scenario: Native messaging is confined to the transport layer
- **WHEN** all files under `src/` outside `src/api/` are scanned
- **THEN** none of them calls `connectNative`

### Requirement: Developer Mode reproduces the verified HTTP surface
`HttpTransport` SHALL reproduce verified client behavior against the real runtime: default base
URL `http://127.0.0.1:3030`, `/health` accepting both a plain `ok` body and a JSON body,
advancing to the next endpoint on HTTP 404, and reporting `{ healthy: false }` on an unreachable
endpoint. The endpoint set SHALL be the one verified against the live runtime and recorded in
`docs/PROTOCOL.md`, not the historical four-by-four ladder.

#### Scenario: Plain-text healthy response
- **WHEN** `/health` returns the body `ok` with status 200
- **THEN** `health()` reports healthy with status `ok`

#### Scenario: JSON healthy response
- **WHEN** `/health` returns valid JSON with `status`, `service`, `version` and `tier`
- **THEN** those fields are surfaced in the health status and healthy is `true`

#### Scenario: Non-JSON non-ok body still counts as healthy
- **WHEN** `/health` returns 200 with an unparseable body
- **THEN** `health()` reports healthy with the body truncated as the status

#### Scenario: Unreachable endpoint is not healthy
- **WHEN** the `/health` request fails or times out
- **THEN** `health()` resolves to `{ healthy: false }` and does not throw

#### Scenario: Add advances past 404
- **WHEN** the first configured add endpoint returns 404 and a later one returns 200
- **THEN** `addMemory()` succeeds against the later endpoint

#### Scenario: Add reports an error when no endpoint works
- **WHEN** every configured add endpoint returns a non-200 response
- **THEN** `addMemory()` rejects with an error naming the last failure

#### Scenario: Search normalizes response shapes
- **WHEN** search returns a bare array, an object with `results`, or an object with `records`
- **THEN** each is normalized to a result with a results array and a count

#### Scenario: Auth headers are applied when configured
- **WHEN** an API key is configured
- **THEN** outbound requests carry both `Authorization: Bearer <key>` and `X-API-Key: <key>`

### Requirement: Capture egress uses only a positive-acknowledging endpoint (G2.1, G5.3)
`send()` SHALL post a `CaptureEvent` to `POST /memory/add` on the configured base URL. The system
SHALL NOT use `POST /memory/ingest` for capture egress. A delivery SHALL be treated as
acknowledged only when the response body parses to `success === true` AND carries a non-empty
`record_id`. An HTTP 2xx that does not satisfy both conditions SHALL be reported as a failed
delivery.

#### Scenario: Add is the capture endpoint
- **WHEN** a capture event is sent
- **THEN** the request targets `POST /memory/add`

#### Scenario: Ingest is never used for capture
- **WHEN** all production sources under `src/` are scanned
- **THEN** none references `/memory/ingest`

#### Scenario: Acknowledgement requires success and a record id
- **WHEN** the runtime responds with a body containing `success: true` and a non-empty `record_id`
- **THEN** `send()` resolves as acknowledged

#### Scenario: Bare 2xx without a record id is a failure
- **WHEN** the runtime responds with HTTP 200 and a body containing no `record_id`
- **THEN** `send()` reports a failure and the event is not treated as acknowledged

#### Scenario: The runtime's dedup warning does not fail a delivery
- **WHEN** the acknowledgement carries a non-empty `warning` array
- **THEN** the delivery is still acknowledged and the warning is recorded

### Requirement: Remote egress is opt-in and never silent (G7.1, G7.3)
In `auto` and `consumer` modes the transport SHALL refuse a base URL whose host is not a loopback
address and SHALL report the refusal. The manifest SHALL declare no non-loopback host in
`host_permissions`.

#### Scenario: Non-loopback base URL is refused outside developer mode
- **WHEN** mode is `auto` or `consumer` and the configured base URL host is not loopback
- **THEN** the transport reports an error naming the host and performs no request

#### Scenario: No remote host is pre-authorised
- **WHEN** `public/manifest.json` is parsed
- **THEN** every entry in `host_permissions` resolves to a loopback host

### Requirement: Retrieval uses the two mechanisms the runtime supports (G3.3, G3.4, G3.6, G3.7, G3.8, G5.6)
Retrieval SHALL use `POST /memory/search` for semantic search and `GET /memory/query` for
structured filtering by `actor`, `action` and `record_type`. Provider identity SHALL be conveyed to
`GET /memory/query` as `action = "capture:<providerId>"` and capture identity as
`record_type = "Perception"`, both applied server-side. The system SHALL NOT request the
unsupported combination of semantic search plus a provider filter and present the result as
filtered; when that combination is requested the system SHALL report the limitation. The system
SHALL NOT apply a filter only after retrieval, and SHALL NOT return unfiltered results as though
a requested filter had been applied. Records returned from retrieval SHALL expose provenance as
discrete fields.

#### Scenario: Provider filter is applied server-side
- **WHEN** a provider-filtered retrieval runs
- **THEN** the outbound request carries `action=capture:<providerId>` and `record_type=Perception` on `GET /memory/query`

#### Scenario: Semantic search is used only without a provider filter
- **WHEN** a search is issued with no provider filter
- **THEN** it uses `POST /memory/search` with `query` and `limit`

#### Scenario: Filtered search excludes other providers
- **WHEN** a retrieval filtered to provider P runs against records captured from P and from Q
- **THEN** the result contains the P records and contains no record whose provider is Q

#### Scenario: A provider with no captures returns an empty result not an error
- **WHEN** a retrieval is filtered to a provider that has no captured records
- **THEN** the result is an empty successful result rather than an error

#### Scenario: Unsupported filter is reported rather than ignored
- **WHEN** semantic search is requested together with a provider filter
- **THEN** the transport reports the limitation and does not present unfiltered results as filtered

#### Scenario: A lossy read path is not used for provenance
- **WHEN** retrieval must expose provenance
- **THEN** it does not use `GET /memory/search-flat`, whose members are plain strings carrying no metadata

#### Scenario: Returned records expose provenance fields
- **WHEN** a record is returned from retrieval
- **THEN** its provider provenance is available as a discrete field rather than only as free text

#### Scenario: A capture round-trips through the live runtime (G3.7)
- **WHEN** a conversation is captured from provider P and the runtime is queried with `action=capture:P`
- **THEN** the record for that capture is returned, and the same query for a different provider's filter does not return it

#### Scenario: A capture is retrievable after the runtime restarts (G5.6)
- **WHEN** the runtime is restarted after acknowledging a capture, and the record is queried again
- **THEN** the capture is still returned, proving it was retained by the runtime rather than merely received

### Requirement: Semantic search results are unwrapped (G3.2)
The system SHALL unwrap `record` from each member of the `results` array returned by
`POST /memory/search`, whose members have the shape `{ score, record }`, and SHALL expose `score`
as a discrete optional field. The system SHALL NOT expose a wrapper object as though it were a
memory record, and SHALL NOT return a record whose fields are undefined because a wrapper was
passed through.

#### Scenario: Wrapped results are unwrapped
- **WHEN** the runtime returns `{ results: [{ score, record }] }`
- **THEN** the normalized result contains the `record` members with `score` attached

#### Scenario: A malformed wrapper is a typed error
- **WHEN** a member of `results` has no `record` member
- **THEN** retrieval reports a typed error rather than returning a record with undefined fields

### Requirement: Consumer Mode uses native messaging
`NativeTransport` SHALL communicate with a local runtime through
`chrome.runtime.connectNative(hostName)`. It SHALL read `chrome.runtime.lastError` after each
native operation and SHALL surface a host-unavailable condition as a typed result rather than an
unhandled exception.

#### Scenario: Native host unavailable is reported not thrown
- **WHEN** `connectNative` sets `chrome.runtime.lastError`
- **THEN** the transport reports the host as unavailable and does not throw synchronously

#### Scenario: Successful native send resolves
- **WHEN** the native host responds successfully
- **THEN** `send()` resolves with a success result

#### Scenario: Native permission is declared
- **WHEN** `public/manifest.json` is parsed
- **THEN** `permissions` contains `nativeMessaging`

### Requirement: Automatic mode selection with fallback
The system SHALL support mode values `"auto"`, `"consumer"` and `"developer"`, defaulting to
`"auto"`. In `"auto"`, the system SHALL attempt the native host first and fall back to HTTP on
`127.0.0.1:3030` when the native host is unavailable. A fallback SHALL be recorded in state and
reported to the UI, never applied silently.

#### Scenario: Auto prefers the native host
- **WHEN** mode is `auto` and the native host is available
- **THEN** the resolved transport is the native transport

#### Scenario: Auto falls back to HTTP
- **WHEN** mode is `auto` and the native host is unavailable
- **THEN** the resolved transport is the HTTP transport and the result reports that fallback occurred

#### Scenario: Explicit consumer mode does not silently fall back
- **WHEN** mode is explicitly `consumer` and the native host is unavailable
- **THEN** the transport reports an unavailable error and the HTTP transport is not used

#### Scenario: Explicit developer mode skips native entirely
- **WHEN** mode is `developer`
- **THEN** no native connection is attempted

#### Scenario: Mode selection is persisted
- **WHEN** the mode is changed in settings
- **THEN** it survives a settings round-trip through `chrome.storage.sync`

### Requirement: Resolved mode is reported
The system SHALL report the currently resolved transport mode and whether a fallback occurred,
so the UI can display it.

#### Scenario: Status message reports mode
- **WHEN** the UI requests transport status
- **THEN** it receives the resolved mode and a fallback indicator

#### Scenario: Fallback is visible in the reported status
- **WHEN** auto mode has fallen back to HTTP
- **THEN** the reported status indicates fallback and names the HTTP endpoint in use
