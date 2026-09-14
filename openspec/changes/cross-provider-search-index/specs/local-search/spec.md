## ADDED Requirements

### Requirement: Search returns captured conversations with the runtime stopped (G3.9)
The system SHALL answer a search over previously acknowledged captures without contacting the
runtime, and SHALL NOT attempt a network request on the offline search path. A query that matches
nothing SHALL return an empty success, not an error.

#### Scenario: Runtime stopped, query returns a captured conversation
- **WHEN** the runtime is stopped and a user searches for a phrase that appears in a conversation
  captured earlier
- **THEN** that conversation is returned, with its provider and capture time, and no request was
  attempted

#### Scenario: A query with no match is an empty success
- **WHEN** a user searches for a phrase that appears in no captured conversation
- **THEN** the result is an empty list and a success, and the surface shows "no matches" rather than
  an error

#### Scenario: Offline is the design, not a fallback
- **WHEN** the offline search path is exercised with the runtime both stopped and running
- **THEN** the result set is identical, because the local index never consults the runtime

### Requirement: The index holds only acknowledged captures (G2.1, G3.9)
The system SHALL add an entry to the index only after the core has acknowledged the capture. The
index SHALL therefore be a cache over stored records: clearing it, losing it, or failing to persist
it SHALL NOT lose a capture and SHALL NOT change what the core holds.

#### Scenario: An undelivered capture is not indexed
- **WHEN** a capture is queued but not yet acknowledged
- **THEN** it is absent from search results, and it appears in them once it is acknowledged

#### Scenario: Clearing the index loses nothing
- **WHEN** the index is cleared and search is run again with the runtime reachable
- **THEN** the same captures are retrievable from the core, so the only thing lost was the offline
  path itself

### Requirement: The index is lexical, never a reasoning layer (G5.4)
The system SHALL implement matching as text and metadata only. It SHALL NOT embed text, rank across
conversations by inferred meaning, cluster, summarise, or expose a similarity score as if it were
relevance.

#### Scenario: No embedding or model call exists
- **WHEN** the source tree is scanned for embedding, model or ranking calls on the search path
- **THEN** none is found, and the cognitive-vocabulary scan over production sources stays clean

#### Scenario: A hit is explained by text, not by interpretation
- **WHEN** a result is shown to the user
- **THEN** the matched text and its provider are shown, and no inferred relationship to another
  conversation is claimed

### Requirement: Local retention is separate from delivery retention (G3.9)
The system SHALL keep the index's retention independent of the unacknowledged queue. Clearing the
index and clearing undelivered captures SHALL be two distinct, separately described actions.

#### Scenario: Two clear actions, two meanings
- **WHEN** the user clears the index and then inspects the queue
- **THEN** the undelivered captures are untouched, and the surface says which of the two was cleared
