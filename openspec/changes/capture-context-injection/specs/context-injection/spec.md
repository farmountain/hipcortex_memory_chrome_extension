## ADDED Requirements

### Requirement: No provider page is mutated while injection is off (G4.5)
While the `injectIntoAiChats` setting is off, the system SHALL NOT mutate any provider page. Capture,
normalization and forwarding SHALL continue to work with the flag off, because the flag gates
injection and nothing else.

#### Scenario: Flag off, DOM unchanged
- **WHEN** the injection path runs against a provider fixture with `injectIntoAiChats` off
- **THEN** the serialized DOM is byte-identical before and after, and the result is a typed refusal

#### Scenario: The flag does not gate capture
- **WHEN** the flag is off and a conversation is captured
- **THEN** capture, normalization and delivery behave exactly as they do with the flag on

### Requirement: Context can be placed in a second provider's composer (G4.5)
The system SHALL place selected context from a captured conversation into a second provider's
composer when the user asks for it, and SHALL leave the decision to send to the user. The system
SHALL NOT submit, and SHALL NOT schedule a submission.

#### Scenario: ChatGPT context reaches the Claude composer
- **WHEN** a user selects a captured conversation from ChatGPT and asks for it in Claude's composer
- **THEN** the composer contains the selected context and the page has not been submitted

#### Scenario: Nothing is sent on the user's behalf
- **WHEN** the injection completes
- **THEN** no network request carrying the context has been issued by the extension, because the
  only egress the extension performs is capture egress

#### Scenario: A failed injection leaves the draft intact
- **WHEN** the composer cannot be resolved
- **THEN** the action reports a typed refusal, the user's existing draft text is unchanged, and
  nothing is inserted anywhere else on the page

### Requirement: Composer resolution uses an ordered ladder and fails closed (G8.2, G8.7)
The system SHALL resolve the composer through an ordered selector ladder after a structural
landmark pre-check, SHALL record which rung was used, and SHALL fail with a typed error when no rung
resolves. Composer selectors SHALL live under `src/inject/**` and SHALL be configured from code
only — never fetched and never stored.

#### Scenario: The ladder is ordered and recorded
- **WHEN** the first rung resolves
- **THEN** the result names that rung, and a mutated fixture where the first rung is removed resolves
  through the next one instead of failing

#### Scenario: An unrecognized surface is a typed refusal
- **WHEN** the page is a sign-in interstitial with no composer landmark
- **THEN** the result is a typed unrecognized-shape error before any text is read or written

#### Scenario: Selector knowledge does not escape the injection tree
- **WHEN** the source tree is scanned
- **THEN** no composer selector appears outside `src/inject/**`, and neither the injection tree nor
  the capture tree performs a network request of its own
