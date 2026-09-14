## ADDED Requirements

### Requirement: Versioned contract identifiers
The system SHALL export `SCHEMA_VERSION` as a numeric literal and SHALL stamp it on every
capture event. The contract SHALL live under `src/schema/` so that it compiles under the
existing `rootDir: "src"` configuration.

#### Scenario: Schema version is exported and stable
- **WHEN** `SCHEMA_VERSION` is imported from `src/schema/index.ts`
- **THEN** it is `1` and its TypeScript type is the literal `1`, not `number`

#### Scenario: Contract compiles under existing rootDir
- **WHEN** `npx tsc --noEmit` runs with the existing `tsconfig.json`
- **THEN** it exits 0 without any "is not under rootDir" diagnostic

### Requirement: Conversation and message shape
The system SHALL define `Conversation`, `Message` and `Attachment` types. `Message` SHALL carry
`role` limited to `"user" | "assistant" | "system"`, non-empty `text`, and a zero-based `index`
that is unique and contiguous within its conversation.

#### Scenario: Message shape is provider-agnostic
- **WHEN** a `Conversation` is constructed for any provider
- **THEN** every `Message` has `role`, `text` and `index` and contains no provider-specific field

#### Scenario: Message order and roles survive round-trip
- **WHEN** a six-message conversation alternating roles is serialized to JSON and parsed back
- **THEN** roles and indices match the original exactly and order is unchanged

#### Scenario: Attachments may be empty
- **WHEN** a conversation is created with no attachments
- **THEN** `attachments` is an empty array and validation succeeds

### Requirement: Provenance is mandatory on every event
Every `CaptureEvent` SHALL carry a `Provenance` object with `schemaVersion`, `provider`,
`adapterVersion`, `source`, `conversationUrl` and `capturedAt`. `capturedAt` SHALL be an
ISO-8601 UTC timestamp ending in `Z`. `eventId` SHALL be present and unique per event.

#### Scenario: Complete provenance passes validation
- **WHEN** an event has all six provenance fields populated and a valid `capturedAt`
- **THEN** validation reports no provenance errors

#### Scenario: Missing provenance field is reported by path
- **WHEN** any one required provenance field is absent
- **THEN** validation returns an error whose `path` names that exact field and whose `code` is `REQUIRED`

#### Scenario: Non-UTC timestamp is rejected
- **WHEN** `capturedAt` is a local time without a `Z` suffix or is not parseable
- **THEN** validation returns an error with `path: "provenance.capturedAt"` and `code: "INVALID_TIMESTAMP"`

#### Scenario: Unknown schema version is rejected
- **WHEN** `schemaVersion` is not a supported version number
- **THEN** validation returns an error with `path: "provenance.schemaVersion"` and `code: "UNSUPPORTED_VERSION"`

### Requirement: Validation returns field-level errors
`validateCaptureEvent()` SHALL return a result object of the shape
`{ valid: boolean, errors: Array<{ path: string, code: string }> }` and SHALL NOT throw for
malformed input. Every `path` SHALL be a dot-delimited location into the event.

#### Scenario: Valid event reports valid
- **WHEN** a fully-populated event is validated
- **THEN** the result is `valid: true` with an empty `errors` array

#### Scenario: Malformed input does not throw
- **WHEN** validation is called with `null`, a string, or an object missing required sections
- **THEN** it returns `valid: false` with at least one error and never throws

#### Scenario: Empty conversation is invalid
- **WHEN** `conversation.messages` is an empty array
- **THEN** validation returns an error with `path: "conversation.messages"` and `code: "EMPTY_CONVERSATION"`

#### Scenario: Multiple errors are all reported
- **WHEN** an event is missing provenance `provider` and has an empty message list
- **THEN** the `errors` array contains an entry for each problem, not only the first

### Requirement: Invalid events are rejected before transport
The capture pipeline SHALL validate an event before invoking any transport, and SHALL NOT
invoke a transport method when validation fails. A rejected event SHALL be recorded locally as
diagnostics only: a timestamp, a provider id, a code and the validation `errors` array. The
rejected event body SHALL NOT be stored, so bounding the diagnostics store can never destroy
conversation content.

#### Scenario: Invalid event never reaches the transport
- **WHEN** the pipeline processes an event that fails validation
- **THEN** the transport spy records zero calls and a failure diagnostic is recorded

#### Scenario: Validation failure is observable
- **WHEN** an invalid event is rejected
- **THEN** the rejection is retrievable with its `errors` array intact so a caller can display the field paths

#### Scenario: The rejection record holds no transcript
- **WHEN** the stored rejection diagnostic is serialized
- **THEN** it contains no message text, no `target` text and no copy of the rejected event

### Requirement: Provenance survives egress as structured metadata (G3.1, G3.5, G5.1)
Provenance SHALL be transmitted to the local runtime under the single reserved metadata key
`hipcortex.capture`, whose value is a versioned object with discrete fields. The system SHALL NOT
flatten provenance into free text. The reserved object SHALL carry `schemaVersion`, `provider`,
`adapterVersion`, `source`, `conversationUrl`, `eventId` and `capturedAt` as separate keys.
Conveying provider identity only inside the message body SHALL be treated as a defect, because it
makes the provider dimension unqueryable and every cross-provider retrieval requirement
unimplementable.

#### Scenario: Egress carries discrete provenance fields
- **WHEN** a valid capture event is sent
- **THEN** the outbound payload carries `hipcortex.capture` whose value is an object with separate `schemaVersion`, `provider`, `adapterVersion`, `source`, `conversationUrl`, `eventId` and `capturedAt` entries

#### Scenario: The reserved key name is exactly pinned
- **WHEN** the outbound payload is inspected
- **THEN** the provenance object is reachable at exactly `metadata["hipcortex.capture"]` and no other reserved key is used

#### Scenario: Provider is not flattened into the body
- **WHEN** the outbound payload for a capture event is inspected
- **THEN** the reserved provenance key is present and no provider identity appears only as free text

#### Scenario: Provenance key carries its own version
- **WHEN** the reserved provenance object is inspected
- **THEN** it contains its own `schemaVersion` so a consumer can validate it independently of the enclosing event

#### Scenario: Provenance round-trips through retrieval
- **WHEN** an event from provider P is sent and later retrieved by an action filtered to `capture:P`
- **THEN** the retrieved record's reserved provenance object reports `provider` equal to the sent value

### Requirement: The capture record maps to the runtime's add contract (G5.3)
The outbound record SHALL be mapped onto the runtime's documented add fields: `actor` from the
configured default actor, `action` as `capture:<providerId>`, `record_type` as `Perception`,
`source` as `cortexbridge`, `target` as the serialized conversation transcript, and `metadata`
holding the reserved `hipcortex.capture` object. The system SHALL NOT send a `ttl_seconds` value,
so a captured record is never implicitly expiring.

#### Scenario: Outbound record uses the documented add fields
- **WHEN** the outbound payload for a valid capture event is inspected
- **THEN** `action` is `capture:<providerId>`, `record_type` is `Perception`, `source` is `cortexbridge` and the reserved metadata object is present

#### Scenario: No implicit expiry is requested
- **WHEN** the outbound payload is inspected
- **THEN** it contains no `ttl_seconds` key

#### Scenario: The endpoint cannot silently discard provenance
- **WHEN** the capture egress endpoint is inspected
- **THEN** it is `POST /memory/add`, whose request schema declares a `metadata` object, and not an endpoint that accepts text without metadata

### Requirement: The verified protocol is documented as part of the contract (G5.2)
`docs/PROTOCOL.md` SHALL record, for every request the extension issues: the endpoint and method,
whether it may be used at all, the acknowledgement rule, the reserved metadata key, and the schema
version the core must accept. A request that document does not list SHALL NOT be added to the
extension, and a response shape that document marks as assumed SHALL NOT be reported as verified.

#### Scenario: The capture endpoint and its acknowledgement rule are documented
- **WHEN** `docs/PROTOCOL.md` is read
- **THEN** it names `POST /memory/add` and states that a delivery is acknowledged only when the body carries `success === true` and a non-empty `record_id`

#### Scenario: Endpoints that must never be used are recorded as forbidden
- **WHEN** `docs/PROTOCOL.md` is read
- **THEN** it records `POST /memory/ingest` and `GET /memory/search-flat` as endpoints that must not be used, with the observed reason for each

#### Scenario: The reserved metadata key and schema version are recorded
- **WHEN** `docs/PROTOCOL.md` is read
- **THEN** it states the reserved metadata key `hipcortex.capture` and the contract schema version carried in `schemaVersion`

#### Scenario: Verified and assumed are distinguished
- **WHEN** a response shape has not been observed against a live runtime
- **THEN** the document marks it as assumed rather than verified
