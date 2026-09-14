## ADDED Requirements

### Requirement: Typecheck gate (G6.1)
The project SHALL provide a typecheck gate that compiles all TypeScript with the existing
`strict` settings and exits non-zero on any diagnostic. The gate SHALL NOT emit output.

#### Scenario: Clean tree passes
- **WHEN** `npx tsc --noEmit` runs on a tree with no type errors
- **THEN** it exits 0

#### Scenario: Type error fails the gate
- **WHEN** a type error is introduced
- **THEN** the gate exits non-zero and names the offending file and line

#### Scenario: Strictness is not weakened
- **WHEN** `tsconfig.json` is parsed
- **THEN** `strict` is `true` and no `any`-suppressing option has been added to the compiler options

### Requirement: Test gate (G6.3)
The project SHALL provide a test gate that discovers and runs committed specs and exits non-zero
if any spec fails or if no specs are found. Committed specs SHALL NOT contain focused or skipped
tests.

#### Scenario: Specs run and pass
- **WHEN** `npm test` runs
- **THEN** it exits 0 and reports a non-zero number of passing tests

#### Scenario: Missing specs fail the gate
- **WHEN** no spec files exist
- **THEN** the gate exits non-zero

#### Scenario: Failing spec fails the gate
- **WHEN** any assertion fails
- **THEN** the gate exits non-zero and reports the failing spec name

#### Scenario: No focused or skipped tests are committed
- **WHEN** the test sources are scanned
- **THEN** no `it.only`, `describe.only`, `it.skip` or `describe.skip` appears

### Requirement: Lint gate (G6.2)
The project SHALL provide an ESLint flat configuration and a lint gate that lints the
TypeScript sources and exits non-zero on any error.

#### Scenario: Lint config exists
- **WHEN** the repository is inspected
- **THEN** an ESLint flat config file is present and referenced by the lint script

#### Scenario: Clean sources pass
- **WHEN** `npm run lint` runs on conforming sources
- **THEN** it exits 0

#### Scenario: Violation fails the gate
- **WHEN** a rule violation is introduced
- **THEN** the gate exits non-zero and reports the rule and location

### Requirement: Build gate produces a loadable bundle (G6.4)
The build SHALL compile TypeScript, bundle the content-script entry point into a classic script,
copy assets, and generate icons, so that `dist/` is directly loadable as an unpacked extension.
Any new HTML, CSS or content-script asset SHALL be included in the copy or build step.

#### Scenario: Build succeeds
- **WHEN** `npm run build` runs
- **THEN** it exits 0 and `dist/` contains `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `options.html`, `options.js`, `sidepanel.html`, `sidepanel.js` and the four icon sizes

#### Scenario: Content script is a classic script
- **WHEN** `dist/content.js` is inspected
- **THEN** it contains no top-level `import` or `export` statement and declares no module type

#### Scenario: New HTML cannot be silently missed
- **WHEN** an HTML file exists in `public/` that is not referenced by the manifest
- **THEN** a spec fails naming the uncopied file

#### Scenario: Manifest paths resolve
- **WHEN** every path referenced by `dist/manifest.json` is resolved against `dist/`
- **THEN** each referenced file exists

### Requirement: Manifest and permission invariants (G1.9, G6.5)
The manifest SHALL declare Manifest V3, SHALL remain least-privilege, SHALL NOT request
`<all_urls>`, SHALL NOT request permissions it does not use, and SHALL NOT load remote code.

#### Scenario: Manifest V3
- **WHEN** `public/manifest.json` is parsed
- **THEN** `manifest_version` is `3`

#### Scenario: No broad host access
- **WHEN** the manifest is parsed
- **THEN** no host pattern in `host_permissions` or `optional_host_permissions` contains `<all_urls>` or a bare `*://*/*`

#### Scenario: Declared permissions are used
- **WHEN** the source is scanned for each declared permission's API
- **THEN** every declared permission has at least one corresponding API usage

#### Scenario: No remote host is pre-authorised
- **WHEN** the manifest is parsed
- **THEN** every host pattern in `host_permissions` resolves to a loopback host and no non-loopback host appears there

#### Scenario: No remote code
- **WHEN** all sources and HTML files are scanned
- **THEN** none contains `eval(`, `new Function(`, or a `<script>` tag with an `http` URL

#### Scenario: Provider hosts are optional and never pre-granted (G1.9)
- **WHEN** the manifest is parsed
- **THEN** `optional_host_permissions` lists every supported provider host and `host_permissions` lists none of them

### Requirement: The build output directory is never committed (G6.7)
The build output directory SHALL be ignored by version control and SHALL contain no tracked file,
because a committed build artifact can mask a broken build by being newer than the sources that
produced it.

#### Scenario: The build output is ignored
- **WHEN** the ignore rules are read
- **THEN** the build output directory is listed as ignored

#### Scenario: No built artifact is tracked
- **WHEN** version control is asked for the tracked files under the build output directory
- **THEN** it returns nothing

### Requirement: Cross-platform build scripts (G6.6)
Repository scripts SHALL behave identically on Windows and POSIX shells. `clean` SHALL remove
the build output directory and `package` SHALL produce a zip archive, or SHALL fail with an
actionable message naming the missing tool.

#### Scenario: Clean works on Windows
- **WHEN** `npm run clean` runs under PowerShell
- **THEN** it exits 0 and the build output directory no longer exists

#### Scenario: Clean is idempotent
- **WHEN** `npm run clean` runs twice with no build output present
- **THEN** both runs exit 0

#### Scenario: Package produces an archive
- **WHEN** `npm run package` runs
- **THEN** it produces a zip file containing the built extension

#### Scenario: Missing archiver is explained
- **WHEN** no zip tool is available on the platform
- **THEN** the script fails with a message naming the required tool rather than an opaque shell error

#### Scenario: The unverified platform is not reported as passing
- **WHEN** only one platform has executed the scripts
- **THEN** the other platform is recorded as unverified rather than assumed to pass

### Requirement: Source-level invariant scans (G1.8, G2.7, G5.4, G5.5)
The project SHALL include a source-scanning test helper and SHALL use it to enforce
project-shaped invariants that conventional lint rules do not express.

#### Scenario: Scan helper is available
- **WHEN** a spec imports the scan helper
- **THEN** it can enumerate source files and test each against a pattern

#### Scenario: Helper reports offenders with paths
- **WHEN** a scan finds a violation
- **THEN** the failure message includes the file path and the matched text

#### Scenario: Scan covers the full source tree
- **WHEN** the scan helper enumerates sources
- **THEN** it includes every file under `src/`

#### Scenario: Cognitive vocabulary is absent
- **WHEN** production sources outside the schema and types modules are scanned
- **THEN** none of them implements belief, goal, world-model or consolidation logic

#### Scenario: The lossy capture endpoint is not used
- **WHEN** every production source under `src/` is scanned
- **THEN** no source references `/memory/ingest`

#### Scenario: Conversation content stays out of sync storage
- **WHEN** every production source under `src/` is scanned
- **THEN** no `chrome.storage.sync` write receives conversation text

### Requirement: One command runs the whole gate chain
The repository SHALL expose a single script that runs the gates in order — typecheck, lint, test,
build — and SHALL stop at the first failing gate so a later gate cannot be reported as passing on
a tree that already failed an earlier one.

#### Scenario: The chain runs every gate in order
- **WHEN** the gate-chain script runs
- **THEN** it executes typecheck, then lint, then tests, then the build

#### Scenario: The chain stops at the first failure
- **WHEN** an earlier gate in the chain exits non-zero
- **THEN** the chain exits non-zero without running the later gates

#### Scenario: The chain is green on a healthy tree
- **WHEN** the gate-chain script runs on a conforming tree
- **THEN** it exits 0

### Requirement: Criteria are traced to tests (G6.8)
The repository SHALL provide a traceability gate that cross-checks the end-state acceptance
criteria, the requirement headings that cite them, and the committed specs that verify them. The
gate SHALL fail when a criterion is cited by no requirement, when a requirement cites a criterion
that does not exist, or when a cited test path does not exist on disk. This gate SHALL be distinct
from structural validation, which does not check coherence.

#### Scenario: Every criterion is linked
- **WHEN** the traceability gate runs
- **THEN** every criterion id in `docs/END-STATE.md` is cited by at least one requirement

#### Scenario: Dangling citations fail the gate
- **WHEN** a requirement cites a criterion id absent from `docs/END-STATE.md`
- **THEN** the gate exits non-zero naming the citation and its file

#### Scenario: Missing test paths fail the gate
- **WHEN** a traceability entry names a test path that does not exist
- **THEN** the gate exits non-zero naming the missing path

#### Scenario: The gate is wired into the test run
- **WHEN** `npm test` runs
- **THEN** the traceability check is executed as part of the suite

### Requirement: Build output is not committed
The build output directory SHALL be excluded from version control so a stale build cannot mask a
failed build.

#### Scenario: Build output is ignored
- **WHEN** the ignore file is inspected
- **THEN** the build output directory is listed and no built artifact is tracked
