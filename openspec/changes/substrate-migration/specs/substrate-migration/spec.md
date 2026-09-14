## ADDED Requirements

### Requirement: Export returns every record with its fields intact (G4.1)
The system SHALL export all records for an actor in a single, self-describing document that carries
a schema version. Every record SHALL retain `metadata`, `priority`, `record_type` and `tags`
exactly as stored. An actor with no records SHALL export an empty, valid document rather than an
error.

#### Scenario: Every record and field survives the export leg
- **WHEN** an actor with stored captures is exported
- **THEN** the document contains every record, and each one's `metadata`, `priority`, `record_type`
  and `tags` match what the runtime returns for that record

#### Scenario: An empty actor exports an empty document
- **WHEN** an actor with no records is exported
- **THEN** the result is a valid document with zero records, not an error and not a missing field

#### Scenario: The export states its schema version
- **WHEN** the document is inspected before import
- **THEN** it names the schema version it was written with, which is what makes the mismatch rule
  below enforceable

### Requirement: Import is field-equivalent with a recorded id remap (G4.2)
The system SHALL import an exported document such that `action`, `record_type` and `metadata` are
preserved exactly, and SHALL record the mapping from each source `id` to the newly generated `id`.
The system SHALL NOT claim byte-equivalence, because the runtime regenerates `id` and `integrity` on
`POST /memory/bulk`. The remap SHALL be durable and resolvable after the import completes.

#### Scenario: Fields are equivalent across the boundary
- **WHEN** a document is imported and the records are read back
- **THEN** for every record `action`, `record_type` and `metadata` are equal to the source, and only
  `id` and `integrity` differ

#### Scenario: The remap resolves an old id
- **WHEN** an id from the source document is looked up in the remap
- **THEN** it resolves to the imported record's new id, forever after, because a reference that
  resolves only during the import is not a record of anything

#### Scenario: A malformed record is refused, and the refusal names the record
- **WHEN** a document contains a record missing a required field
- **THEN** the import refuses it with an error naming the record, and does not import a coerced
  version of it while reporting success elsewhere

### Requirement: A schema-version mismatch is rejected with an actionable error (G4.3)
The system SHALL refuse to import a document whose schema version it does not understand. It SHALL
NOT coerce unknown fields into the current shape, drop them, or partially import the document. The
refusal SHALL name the version found and the version understood.

#### Scenario: Unknown version is refused, not coerced
- **WHEN** a document declaring a future schema version is imported
- **THEN** nothing is written, and the error names both the version found and the version understood

#### Scenario: Refusal is all-or-nothing
- **WHEN** a document is refused for its version
- **THEN** the store is unchanged, so a retry after an upgrade imports the complete document

### Requirement: A capture is retrievable unmodified from every surface (G4.4)
The system SHALL make a capture written by the browser extension retrievable, unmodified, from the
CLI and from MCP. "Unmodified" means the message sequence and text are identical, message for
message; a surface may add its own presentation but SHALL NOT rewrite a capture's content.

#### Scenario: Extension capture, read from the CLI
- **WHEN** a conversation is captured in the browser and then read through the CLI
- **THEN** the message count and every message's text and order are identical to what was captured

#### Scenario: Extension capture, read from MCP
- **WHEN** the same conversation is read through MCP
- **THEN** it is identical to the CLI read, because the surface is a view of one substrate rather
  than a second copy of it

#### Scenario: A surface does not rewrite what it shows
- **WHEN** any surface renders a captured conversation
- **THEN** it shows the stored text and adds no summary, no inferred role and no truncation that the
  user cannot see
