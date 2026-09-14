# Requirements — where the specification actually lives

This file is an **index, not a specification**. The requirements work that used to live here had
drifted: it required the client to "tolerate multiple historical endpoint paths" (old R1.3), which
the verified contract later proved to be a defect, and it restated acceptance criteria that now
exist in exactly one place with verification commands attached.

Two documents own the specification:

| Document | Owns |
|----------|------|
| [`docs/END-STATE.md`](./END-STATE.md) | The end-state goals `G1`–`G8`, each with measurable acceptance criteria (`G#.#`), the command that verifies each one, locked interpretations, non-goals with reasons, and risks |
| [`docs/PROTOCOL.md`](./PROTOCOL.md) | The verified network contract — every endpoint that may be called, every one that must never be, and the acknowledgement rule |

The plan that discharges them is the OpenSpec change set under
[`openspec/changes/`](../openspec/changes/): `cortexbridge-perception-layer` is the base, and
`cortexbridge-retention-boundary`, `cross-provider-search-index`, `clarity-protocol`,
`substrate-migration`, `capture-context-injection` and `installable-product` discharge the goals that
change left open. Every task in a `tasks.md` names the `G#.#` criterion it discharges and the spec
that proves it. A task that cites a criterion which does not exist, or a test path that is not on
disk, fails `npm run test:traceability` (`G6.8`).

## Requirement areas

| Area | Criteria | Primary proving specs |
|------|----------|-----------------------|
| Capture fidelity — analyze before extracting, provenance on every capture, fail closed | `G1.1`–`G1.9` | `tests/capture/providers/*.spec.ts`, `tests/schema/*.spec.ts` |
| Durability — acknowledged delivery, no loss counter, bounded backlog reported as paused | `G2.1`–`G2.10` | `tests/capture/queue.spec.ts`, `tests/capture/failures.spec.ts` |
| Cross-provider retrieval — discrete provider identity, filterable, semantic path unwrapped, searchable with the runtime stopped | `G3.1`–`G3.9` | `tests/schema/egress.spec.ts`, `tests/api/transport.spec.ts`, `tests/index/offline-search.spec.ts`, `tests/index/empty-results.spec.ts` |
| Migration across boundaries — export, field-equivalent import through `POST /memory/add` with a recorded `id` remap, and a version refusal that writes nothing | `G4.1`–`G4.5` | `tests/migration/*.spec.ts`, `tests/router/import.spec.ts`, `tests/surfaces/import.spec.ts`, `tests/capture/queue-export.spec.ts` |
| Cognitive distillation — the extension stays out of it, and says so | `G5.1`–`G5.6` | `tests/quality/source-scans.spec.ts`, `tests/schema/validate.spec.ts` |
| Provable claims — typecheck, lint, tests, build, clean, package, not committing `dist/` | `G6.1`–`G6.8` | `tests/quality/*.spec.ts` |
| Anti-exfiltration — loopback by default, confirmation before remote egress | `G7.1`–`G7.6` | `tests/options/remote-egress.spec.ts`, `tests/surfaces/egress-banner.spec.ts`, `tests/quality/manifest.spec.ts` |
| Provider drift resilience — ladder, landmark pre-check, cardinality check, drift reporting | `G8.1`–`G8.9` | `tests/capture/providers/*.spec.ts`, `tests/capture/drift.spec.ts` |

## Requirements that were withdrawn, and why

| Withdrawn | Reason |
|-----------|--------|
| "Must tolerate multiple historical endpoint paths for add/search" (old R1.3) | Replaced by a single verified egress, `POST /memory/add`. A ladder of 404s reads as a transient failure and hides a misconfiguration — and one rung, `POST /memory/ingest`, returns HTTP 200 while destroying the provenance metadata and imposing a 24-hour TTL. Evidence in [`docs/PROTOCOL.md`](./PROTOCOL.md) §3.1. |
| "Add memory from the popup → appears in subsequent search" as an MVP acceptance criterion | Too weak to be worth verifying: it is satisfied by a device-local store. Retention is the core's job; this repository's obligation is *acknowledged delivery*, which is both stronger and testable (`G2.1`, `G2.9`). |
| "Tolerate multiple historical endpoint paths" as a resilience feature | Same entry as above: resilience in this codebase means the queue retains until acknowledged, not that the client guesses at endpoints. |

## Submission documents

| Document | Owns |
|----------|------|
| [`docs/STORE.md`](./STORE.md) | The Chrome Web Store submission: the archive to upload, the paste-ready listing copy, the per-permission and host-permission justifications, the remote-code answer, the nine data-disclosure declarations and the privacy-policy URL the Privacy tab is filled from, the reviewer instructions, the post-upload step that reconciles the local extension ID with the ID the store assigns, and an explicit list of what is still missing |
| [`docs/PRIVACY.md`](./PRIVACY.md) | The privacy policy the store requires once personal communications are declared. It is a user-facing surface, so its claims are checked like any other assertion |

Uploading is a manual step in the Developer Dashboard. Nothing in this repository uploads anything,
and `docs/STORE.md` opens by saying so.

## Still open

Nothing here. Runtime questions that remain unprobed are listed in
[`docs/PROTOCOL.md`](./PROTOCOL.md) §8; scope questions and risks are in
[`docs/END-STATE.md`](./END-STATE.md).

