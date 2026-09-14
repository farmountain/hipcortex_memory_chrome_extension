## Why

G4 asks whether state established on one surface or platform can be used on another, losslessly and
verifiably. The interpreter locked four readings of "across platforms" and assigned owners. The
readings that need a real protocol — *across devices* and *across HipCortex surfaces* — were left
unspecified, and an unspecified migration path is indistinguishable from no migration path.

Two runtime facts make the protocol question concrete rather than theoretical, and both were
observed live during `cortexbridge-perception-layer`:

- `GET /memory/export?actor=` returns records with `metadata`, `priority`, `record_type` and `tags`
  intact.
- `POST /memory/bulk` reports `inserted: 1, failed: 0, errors: []` and still corrupts the record: on
  an export-to-export comparison it returned `tags: []`, `source: null` and `priority: "normal"` for a
  record whose source had `["capture","chatgpt"]`, `"cortexbridge"` and `"pinned"`. It mints a new
  `id` and `integrity`. So import goes through `POST /memory/add`, and it is *field-equivalent with a
  recorded remap*, never byte-equivalent.

A migration feature that claims byte-equivalence would be claiming something the runtime contradicts.
A migration feature with no remap record would make an imported record unresolvable back to the
record it came from.

## What Changes

- **Specify the export leg** as a contract, not as an endpoint list: which fields must survive, and
  what an empty actor must return.
- **Specify import as field-equivalent with a recorded `id` remap**: the mapping from old id to new
  id is durably recorded, so any reference to the original can still be resolved after import.
- **Reject a version mismatch with an actionable error.** A substrate whose schema version the
  importer does not understand must be refused, never coerced into the current shape, because silent
  coercion is how a field disappears without anyone noticing.
- **Specify the cross-surface verification**: the same capture, read from the extension, the CLI and
  MCP, must be the same capture.

## Impact

- New capability specification: `substrate-migration`.
- Affected code, when implemented: `src/api/transport/**` (export/import calls), a migration module,
  and the options surface for the user-facing import refusal.
- Cross-repo: if the core cannot currently express a recorded remap, this change depends on a core
  change and that dependency must be raised rather than worked around in the extension.
- **Non-goal: cross-browser migration.** Firefox and Edge are not in scope here; the seams are
  preserved, but a second browser engine would triple the verification surface for no user who has
  asked for it.
