## ADDED Requirements

### Requirement: Provider adapter contract (G8.1)
The system SHALL define a `ProviderAdapter` interface with `id`, `displayName`,
`adapterVersion`, `verifiedAt`, `matches(url: string): boolean` and
`extract(input: { root: ParentNode, url: string }): ExtractResult`. `matches` SHALL be pure and
SHALL NOT access the DOM or the network. `adapterVersion` SHALL be a non-empty string that
changes whenever a DOM assumption changes. `verifiedAt` SHALL be an ISO-8601 UTC date recording
when the adapter's assumptions were last confirmed against the live site, and SHALL NOT be later
than the current date.

#### Scenario: Adapter exposes the required surface
- **WHEN** any registered adapter is inspected
- **THEN** it provides `id`, `displayName`, `adapterVersion`, `matches` and `extract`

#### Scenario: matches is pure
- **WHEN** `matches()` is called with a URL string
- **THEN** it returns a boolean without reading the DOM and without performing any network request

#### Scenario: matches handles malformed input
- **WHEN** `matches()` is called with a string that is not a valid URL
- **THEN** it returns `false` and does not throw

### Requirement: Single provider registry (G1.1)
Adapters SHALL be registered in one registry module. Adding a provider SHALL require exactly one
registry entry. No adapter SHALL import another adapter.

#### Scenario: Registry resolves by id
- **WHEN** the registry is queried for a known provider id
- **THEN** it returns the corresponding adapter

#### Scenario: Registry resolves by URL
- **WHEN** a URL belonging to a supported provider is passed to the registry
- **THEN** it returns exactly one matching adapter

#### Scenario: Unsupported URL yields no adapter
- **WHEN** a URL for an unsupported site is passed to the registry
- **THEN** the registry returns no adapter and does not throw

#### Scenario: Adapters are isolated siblings
- **WHEN** the source of a provider adapter is scanned
- **THEN** it contains no import from another file under the providers directory

### Requirement: URL matching for supported providers (G1.2)
Each of ChatGPT, Claude, Grok, Gemini and DeepSeek SHALL have an adapter whose `matches()` returns
`true` for its canonical conversation URL and for its known alternate subdomain, and `false` for
unrelated URLs.

#### Scenario: Canonical URL matches
- **WHEN** `matches()` is called with the provider's canonical conversation URL
- **THEN** it returns `true`

#### Scenario: Alternate subdomain matches
- **WHEN** `matches()` is called with a known alternate subdomain for that provider
- **THEN** it returns `true`

#### Scenario: Unrelated URL does not match
- **WHEN** `matches()` is called with `https://example.com/chat`
- **THEN** it returns `false`

#### Scenario: Every shipped adapter is covered
- **WHEN** the test suite runs
- **THEN** all five providers have at least three `matches()` cases each: canonical, alternate and non-matching

### Requirement: Extraction produces a normalized conversation (G1.3, G1.5, G1.6)
`extract()` SHALL return `{ ok: true, conversation }` where the conversation is fully populated
with ordered messages and complete provenance including the adapter's `adapterVersion` and the
provider `id`. Extraction SHALL NOT mutate the captured DOM.

#### Scenario: Saved fixture extracts all messages
- **WHEN** `extract()` runs against a saved conversation fixture containing at least three messages and two distinct roles
- **THEN** the returned conversation contains every message in document order with correct roles

#### Scenario: Provenance is complete and stamped by the adapter
- **WHEN** extraction succeeds
- **THEN** the conversation's provenance `provider` equals the adapter `id` and `adapterVersion` equals the adapter's declared version

#### Scenario: Extraction is side-effect free
- **WHEN** `extract()` runs against a fixture
- **THEN** the fixture's DOM serialization is identical before and after the call

### Requirement: Typed extraction failures (G1.4, G7.6, G8.7)
`extract()` SHALL return `{ ok: false, error }` with `code` in
`"EMPTY_CONVERSATION" | "NO_ROLE_SIGNAL" | "UNSUPPORTED_LAYOUT" | "DOM_SHAPE_UNRECOGNIZED"`
for any input it cannot fully parse. It SHALL NOT throw an untyped error and SHALL NOT return a
partially-populated conversation marked as successful. A typed failure SHALL always be preferred
to a wrong capture: when the adapter cannot establish that it read the page correctly it SHALL
fail rather than emit a best-effort conversation.

#### Scenario: Empty DOM yields a typed failure
- **WHEN** `extract()` runs against an empty-page fixture
- **THEN** it returns `ok: false` with code `EMPTY_CONVERSATION` or `NO_ROLE_SIGNAL`

#### Scenario: Missing role signal yields a typed failure
- **WHEN** messages are present but no role signal can be resolved
- **THEN** it returns `ok: false` with code `NO_ROLE_SIGNAL`

#### Scenario: Partial parse is never reported as success
- **WHEN** a fixture contains messages whose text cannot be resolved
- **THEN** the result is `ok: false` rather than a success containing only the resolvable subset

### Requirement: Extraction is independent of the network (G8.9)
Extraction SHALL be a pure function of the DOM it is given. It SHALL produce the same result with
the network available and with the network unavailable, because a provider page that has not
finished loading, or a machine that is offline, must not change what was read out of the page.

#### Scenario: Same success with and without the network
- **WHEN** the same fixture is extracted once with the transport reachable and once with every network call failing
- **THEN** both calls return the same conversation

#### Scenario: Same refusal with and without the network
- **WHEN** a degraded fixture is extracted with and without the network
- **THEN** both calls return the same typed failure code

#### Scenario: The offline probe is not vacuous
- **WHEN** the no-network case is exercised
- **THEN** a transport call attempted during that window would be observed, so a zero-request result proves the absence rather than assuming it

#### Scenario: Extraction failure never reaches transport
- **WHEN** an adapter reports a typed extraction failure
- **THEN** no transport method is invoked for that conversation

### Requirement: Provider specifics are contained
Provider hostnames, CSS selectors and provider-specific identifiers SHALL appear only under the
capture tree. Service-worker, transport and UI modules SHALL NOT reference any provider by name.

#### Scenario: Service worker contains no provider knowledge
- **WHEN** `src/background.ts` is scanned
- **THEN** it contains no provider hostname and no provider CSS selector

#### Scenario: Transport contains no provider knowledge
- **WHEN** files under `src/api/` are scanned
- **THEN** they contain no provider hostname and no provider name

#### Scenario: A DOM change is fixable in one file
- **WHEN** a provider's markup changes
- **THEN** the required production change is confined to that provider's adapter file plus its fixtures

### Requirement: Host permissions for every supported provider
`public/manifest.json` SHALL declare the canonical host of each of the five supported providers
in `optional_host_permissions`. No provider host SHALL be added to `host_permissions`.

#### Scenario: All five providers are declared
- **WHEN** `public/manifest.json` is parsed
- **THEN** `optional_host_permissions` contains an entry for each of OpenAI/ChatGPT, Claude, Grok, Gemini and DeepSeek

#### Scenario: Host permissions stay minimal
- **WHEN** `public/manifest.json` is parsed
- **THEN** `host_permissions` contains only local runtime origins and contains no AI provider host

### Requirement: Each slot resolves through an ordered selector ladder (G8.2)
Each extractable slot (conversation root, turn container, message text, role signal) SHALL be
declared as an ordered list of candidate selectors. Extraction SHALL use the first candidate that
resolves to a non-empty result and SHALL record which candidate index was used for each slot. An
adapter SHALL NOT depend on a single selector for any slot.

#### Scenario: Later rung is used when an earlier rung is absent
- **WHEN** a fixture omits the selector for the first rung of a slot and supplies the second
- **THEN** extraction succeeds using the second rung

#### Scenario: The used rung is reported
- **WHEN** extraction succeeds
- **THEN** the result records, for each slot, which candidate index satisfied it

#### Scenario: Ladders are declared per slot
- **WHEN** an adapter's declaration is inspected
- **THEN** every slot exposes an ordered list of at least two candidates

### Requirement: A structural pre-check runs before extraction (G8.3)
Before reading any message, an adapter SHALL validate a declared set of required landmarks
against the page. If a required landmark is absent the adapter SHALL return
`{ ok: false, error: { code: "DOM_SHAPE_UNRECOGNIZED" } }` and SHALL NOT attempt message
extraction.

#### Scenario: Missing landmark fails before any message is read
- **WHEN** the page lacks a required landmark
- **THEN** the result is a typed `DOM_SHAPE_UNRECOGNIZED` failure and no message text is produced

#### Scenario: Recognised shape proceeds to extraction
- **WHEN** every required landmark is present
- **THEN** the pre-check passes and extraction continues normally

#### Scenario: The pre-check is cheaper than a wrong capture
- **WHEN** the pre-check cannot be satisfied by any ladder rung
- **THEN** the adapter reports failure rather than emitting an empty or partial conversation as success

### Requirement: Extracted message count is checked against the page (G8.8)
After extraction an adapter SHALL count the turn containers it observed and compare that count to
the number of messages produced. When the counts disagree the adapter SHALL return a typed
failure instead of a partial conversation.

#### Scenario: Count mismatch fails extraction
- **WHEN** a fixture contains N turn containers and extraction produces fewer than N messages
- **THEN** the result is a typed failure and not a success containing the subset

#### Scenario: Count agreement succeeds
- **WHEN** a fixture's turn-container count equals the produced message count
- **THEN** extraction succeeds

### Requirement: Extraction is configured from code only (G8.4)
Adapters SHALL resolve every selector and landmark from values compiled into the extension
bundle. The system SHALL NOT fetch selector, landmark or adapter configuration from the network,
and SHALL NOT read such configuration from `chrome.storage`. A remote configuration source SHALL
be treated as a bypass of the local-only egress promise as well as a drift amplifier.

#### Scenario: No remote configuration path exists
- **WHEN** production sources are scanned for remote or stored selector configuration
- **THEN** none is found

#### Scenario: Extraction works with no network reachable
- **WHEN** every adapter runs against its fixtures with no network available
- **THEN** extraction behaves identically to a run with network available

### Requirement: Each ladder rung and a broken page have fixtures (G8.5)
Every provider SHALL ship, at minimum, one saved fixture exercising each ladder rung plus one
fixture whose shape is deliberately unknown to the adapter. The unknown shape fixture SHALL assert
a typed failure, not a success.

#### Scenario: Every rung is covered
- **WHEN** the adapter fixtures are enumerated
- **THEN** each declared rung of each slot has at least one fixture that selects it

#### Scenario: The broken fixture must fail
- **WHEN** the unknown-shape fixture is run
- **THEN** the result is `ok: false` with a typed code and no message text

#### Scenario: Fixtures are local
- **WHEN** the test suite runs
- **THEN** no fixture is fetched over the network

### Requirement: Repeated drift is surfaced to the user (G8.6)
The system SHALL report that capture from a provider requires an adapter update once that provider
has recorded a configured number of consecutive typed extraction failures, naming the provider and
the slot or rung that failed. The system SHALL NOT report drift for isolated failures below the
threshold.

#### Scenario: Threshold is crossed
- **WHEN** consecutive typed failures for one provider reach the configured threshold
- **THEN** the reported status names that provider and states that its capture needs updating

#### Scenario: A single failure does not alarm
- **WHEN** a provider records one typed failure below the threshold
- **THEN** no drift warning is reported

#### Scenario: A success clears the drift state
- **WHEN** a successful extraction follows reported drift for that provider
- **THEN** the drift warning is cleared
