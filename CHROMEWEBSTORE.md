# Chrome Web Store — where the submission package lives

Chrome's own guidance for coding agents says that an agent working on an extension should create and
maintain a `CHROMEWEBSTORE.md` at the repository root, tracking what a submission needs — including a
justification for each permission the code requests.

This file exists so that guidance is satisfied and so that tooling looking for that name finds it
rather than concluding this repository has no submission package.

**It is a pointer, not a second copy.** The submission package is
[docs/STORE.md](./docs/STORE.md), and that document is the single source of truth for it.

## What the convention expects to track, and where it actually is

| What the convention expects to track | Where it is |
|---|---|
| The artifact to upload | `docs/STORE.md` §1 |
| Graphic assets and screenshots | `docs/STORE.md` §2 and §9 |
| Listing name, short description, detailed description, category, language | `docs/STORE.md` §3 |
| The single-purpose statement | `docs/STORE.md` §4 |
| The data-usage declarations | `docs/STORE.md` §5 |
| Per-permission justifications, host permissions, the remote-code answer, the privacy-policy URL | `docs/STORE.md` §6 |
| Distribution and visibility | `docs/STORE.md` §7 |
| Test instructions for reviewers | `docs/STORE.md` §8 |
| What the document deliberately does not establish | `docs/STORE.md` §10 |
| Post-upload steps, including reconciling the extension ID | `docs/STORE.md` §11 |

## Why none of it is duplicated here

`docs/STORE.md` already carries more than the convention asks for, and
`tests/quality/store.spec.ts` reads it: every sentence in it that names a fact about
`public/manifest.json` is checked against that manifest rather than trusted, the permission table is
compared as an exact set in both directions, the paste-ready boxes are held to the character limits
the dashboard's own form enforces, and the artwork is measured by reading each PNG rather than by
checking that a file exists.

A root copy of any of those values would be a second statement of one fact, and the drift would be
silent — the gate reads `docs/STORE.md`, so a stale copy here would fail nothing. That is the same
shape of defect that four documents had to be corrected for once already: several statements of one
fact, written from one belief, agreeing with each other and with nothing else.

So this file carries no manifest value, no version, no size, no hash, no character count and no
paste-ready box. `tests/quality/store.spec.ts` enforces that — it requires this file to name
`docs/STORE.md`, and requires it to hold no fenced block and no copy of the manifest's description
or version.

## How to change the store copy

Edit `docs/STORE.md`, then run `npx vitest run tests/quality`. Do not add the value here.

The status of the submission is stated in `docs/STORE.md`, and only there: an upload is a manual act
performed in the Developer Dashboard, and nothing in this repository performs it or may claim it
happened.
