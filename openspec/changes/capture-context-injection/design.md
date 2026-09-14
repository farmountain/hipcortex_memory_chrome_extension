## Context

Injection is the only feature in this repository that **writes into a page the user is looking at**.
Everything else in `src/` reads: `src/capture/**` reads a conversation, `src/content/**` observes and
forwards, `src/index/**` reads back what the core confirmed, and the surfaces read what the worker
told them. A write path is a different kind of code. It can corrupt a draft, it can be mistaken for a
submission, and it can run on a page the user did not intend.

G4.5 therefore has two halves and they pull in opposite directions. The feature must work — a user who
selects a captured conversation must be able to place it in another provider's composer — and the off
state must be *provably* inert, not inert by convention. The only proof strong enough for the second
half is a diff of the page: serialise the DOM, attempt a placement, serialise it again, require the
two strings to be equal.

This change is deliberately not part of `cortexbridge-perception-layer`. The perception change is
about forwarding a capture; this one introduces a write path with its own threat model, its own
contract and its own containment scans, and folding it into the perception change would let a write
path be reviewed as an addition to a read path.

The boundary is unchanged and it is what keeps this small: **the core retains; the extension
guarantees acknowledged delivery.** Injection is not a second retention surface and not a second
reasoning surface. It places text the core already acknowledged into a box the user can see, and then
it stops. It has no session, no queue, no memory, and no opinion about what should be said next.

## Decisions

### 1. The composer contract is separate from the capture contract

`src/inject/**` declares its own contract — `ComposerAdapter` with `id`, `displayName`,
`adapterVersion`, `verifiedAt`, `landmarks`, `ladders`, `matches(url)` and
`resolve(document)` — and it is **not** an added method on `ProviderAdapter`. The two contracts share
the `id` values (`"chatgpt"`, `"claude"`, `"gemini"`, `"grok"`, `"deepseek"`) and nothing else.

The separation is what makes "capture never writes" structural instead of a convention. A read-only
contract with an optional `write()` on it is a contract that any future capture change may call.

*Rejected: adding `resolveComposer()` to `ProviderAdapter`.* It puts a write path inside the tree that
`tests/quality/source-scans.spec.ts` describes as read-only, and every existing assertion about that
tree would have to be read again with "except for this one method" in mind. Two contracts cost one
extra file and keep the read path's guarantees unconditional.

*Rejected: one generic composer resolver with a shared ladder.* Every provider page differs; a single
ladder would be a ladder that is wrong on four sites while looking verified, which is exactly the
failure G8.7 forbids.

### 2. The worker decides and the page writes — one message, one new `MessageType`

The decision needs the flag, the target tab and the acknowledged record; the write needs the DOM and
the composer ladder. Neither side has both, and the split is not a compromise:

- `injectIntoAiChats` lives in `chrome.storage.sync` and is read through `getSettings()` in the
  worker. A content script that read it would contain `chrome.storage`, and
  `tests/quality/content-bundle.spec.ts` asserts the shipped bundle contains no storage access at all
  (G8.2). It also could not read it: the extension's storage API is not exposed to a content script's
  page world in the way the bundle needs.
- The composer exists only in the page. The worker has no DOM and no `querySelector`.

So the read is one message with two names, in the same shape the capture path already uses:
`PLACE_CONTEXT` (surface → worker) and `PLACE_CONTEXT_REQUEST` (worker → tab). The worker sends it
with `chrome.tabs.sendMessage` to the **active tab** and relays the page's report back to the surface.
One new `MessageType` union member, one new router `case`, and the two are checked against each other
by `tests/quality/message-types.spec.ts`.

*Rejected: the content script reading the flag from storage.* The bundle scan forbids it, and a page
that decided for itself whether to be written to would put the guarantee on the page rather than on
the extension's own state.

*Rejected: a second long-lived `MessageType` for the reply.* The reply is the `sendResponse` of the
same channel; a second message would need its own correlation id and its own ordering rules for no
gain.

### 3. Exactly one bundled content-script entry, and `src/inject/**` is reached through it

`scripts/build-content.js` bundles exactly one entry, `src/content/entry.ts`, into one classic IIFE,
and `tests/quality/content-bundle.spec.ts` asserts properties of that one bundle. This change keeps
it that way: `src/content/entry.ts` imports `src/inject/host.js` and calls
`registerContextPlacement()`, which installs a `chrome.runtime.onMessage` listener that resolves the
composer for the page's URL, places the text, and answers with a typed report.

*Rejected: a second content-script entry for injection.* Two bundles would both run on the same six
provider hosts, both be declared in `public/manifest.json`, and both be checked by a spec written for
one; the containment assertions that matter most (`no fetch(`, no `chrome.storage`, no
`connectNative` in the shipped bytes) would have to be duplicated or weakened.

*Rejected: `chrome.scripting.executeScript` from the worker.* It injects code the repository does not
build into the page, needs a function serialised as a string, and cannot import the composer ladders
— so the selectors would either live in the worker (a second home for selector knowledge) or be
inlined as a string literal (unreachable by every scan in this repository).

### 4. Placement is anchored to a record the core acknowledged, not to a live page

A placement names an `indexedId` — the `record_id` the core returned — and the worker reads the text
from `src/index/local.ts`, the cache that by construction contains only acknowledged captures
(G3.9). The record must still be present; if it has been evicted by the cap or removed by the clear
action, the refusal is `CONTEXT_NOT_FOUND` and nothing is written anywhere.

*Rejected: re-reading the source conversation from its own tab.* The source page is usually not open,
the tab may be signed out or showing a different conversation, and a fresh scrape can produce text
the core never acknowledged — which would make the extension the author of the placed text.

*Rejected: passing the text from the surface to the worker.* The surface would become a transport for
conversation content and the worker would have no way to tell an acknowledged record from typed text.
The surface names the record; the worker reads it.

### 5. The composer is resolved through an ordered ladder after a landmark pre-check, and the rung is recorded

`resolveComposer(adapter, document)` mirrors `extractConversation` exactly:

1. A structural landmark pre-check. If no declared landmark is present, the result is
   `DOM_SHAPE_UNRECOGNIZED` with `slot: "composerRoot"` **before any text is read and before anything
   is written**. A signed-out or interstitial page fails here.
2. Each slot resolves through its ordered ladder, first rung that matches wins.
3. The rung each slot resolved at is returned in the report (`rungs`), so a page that has drifted one
   rung is visible in the result rather than silently absorbed.
4. A slot that resolves to more than one node is **not** a match: an ambiguous composer is a refusal
   (`COMPOSER_AMBIGUOUS`), never a coin flip.

*Rejected: a single `querySelector` with a null check.* A null check cannot distinguish "there is no
composer here" from "the composer changed shape", and the user gets no code to act on. G8.7 is the
statement that a typed refusal beats a plausible wrong capture; the same reasoning applies to a
plausible wrong write, only more so.

*Rejected: `document.activeElement` as the target.* Focus follows the user's last click anywhere on
the page, including a menu or a search box, and a placement into the wrong box is indistinguishable
from a placement into the right one until it is read.

### 6. The draft is captured first and restored on failure; nothing is submitted and no request is issued

Before any write, the resolved composer's current value is recorded. The write itself is one
operation chosen per node kind (`value` for `textarea` and `input`, `textContent` for a
`contenteditable` element), and the report says which was used. If the node cannot be written — for
instance a read-only or disabled control — the result is `COMPOSER_NOT_WRITABLE`, and the draft is
restored to the bytes it had before the attempt.

Nothing in the placement path dispatches a `click`, a `keydown` or a submit event, so the provider's
own submit handler is never reached: the extension places text and stops. "No request carrying the
context is issued by the extension" is proven two ways — the injection tree contains no network call
at all (scan), and the spec records every `fetch`, `XMLHttpRequest` and native `connectNative` call
made during a placement and requires the count to be zero.

*Rejected: clicking the provider's send button after placing the text.* It is a submission on the
user's behalf, it is a non-goal of this change, and it is the one action that cannot be undone.

*Rejected: dispatching the input events a framework needs to notice the text.* A React-controlled
composer ignores a raw `textContent` write until its own state changes, which is a real limitation
and is stated as one; the alternative is to simulate the user's typing, which means synthesising
keystrokes the user did not make. The refusal to do that is deliberate: the report tells the user the
text was placed and that the page decides when it is submitted.

### 7. The budget is 2000 characters, truncated at a boundary, and truncation is always reported

`INJECTION_MAX_CHARS = 2000`. A record longer than that is truncated at the last word boundary inside
the budget (falling back to a hard cut when there is no boundary), and the report carries
`placedChars`, `sourceChars` and `truncated: true`. The surface must show the truncation sentence
next to the result.

*Rejected: placing the whole record.* Two failure modes, both silent: a composer with its own
`maxlength` truncates without telling anyone, and a truncated placement that looks complete is worse
than a refusal because the user will submit it believing it is the whole thing.

*Rejected: refusing anything over the budget.* A memory of 2500 characters is a normal capture; a
feature that fails on it is a feature that fails on most of them. The budget is a limit that is
*reported*, not a limit that is hidden.

*Rejected: `{maxlength}` from the resolved node as the budget.* The attribute is advisory on a
`contenteditable`, absent on most of them, and reading it makes the placed amount depend on the page
rather than on a constant a reviewer can see.

### 8. Off means off, and the off state is proven by the page, not by the code path

The flag is read in the worker. When it is false the refusal is `INJECTION_DISABLED` and
`chrome.tabs.sendMessage` is **never called** — so no page code runs at all. That is the first line.

The second line is the one that matters for the criterion: the spec serialises a fixture page, runs
`placeContext()` with `enabled: false`, serialises again and requires byte equality — and it does the
same for a page whose composer cannot be resolved, so "off" is not the only inert state. A third
assertion proves the flag does not gate capture: the same capture is forwarded, normalized and
delivered with the flag off as with it on.

*Rejected: checking the flag inside the inject module only.* The page would still be messaged, and
"nothing was written" would rest on the module remembering to check. The worker check makes the
guarantee one step earlier and testable without a DOM.

### 9. The specs live in the projects that already have the environment they need

- `tests/capture/injection.spec.ts` — jsdom. Composer resolution (landmark pre-check, ladder order,
  rung record, ambiguity refusal), the byte-identical off proof, the write, the draft restore, the
  truncation report, and the no-network assertion.
- `tests/router/injection.spec.ts` — node. The worker decision: the flag gate before any tab message,
  the record lookup, the tab relay, an unreachable tab, and the flag-does-not-gate-capture proof.
- `tests/quality/source-scans.spec.ts` — extended with a containment group for `src/inject/**`.
- `tests/options/inject.spec.ts` — revised. Its assertions that `injectIntoAiChats` is read by exactly
  two files and that no DOM write exists in the perception layer cannot survive a write path; what
  replaces them is the stronger statement that the flag's readers are the option itself, the types,
  the injection tree and the worker, and that a live document is unchanged when the flag is false.

*Rejected: a new `tests/inject/**` directory.* `vitest.workspace.ts` routes every path that is not in
the jsdom include list to the `node` project, so a new directory would silently lose `DOMParser` and
`document`. Widening the include list would move the meaning of the two projects under every other
spec in the repository to buy one directory name.

### 10. Selector knowledge is code, and it never leaves the injection tree

The composer ladders are literals in `src/inject/composers/*.ts`. Nothing is fetched, nothing is read
from storage, nothing is imported dynamically, and no selector string appears anywhere else in `src/`
— which is checked by a scan with a positive control, in both directions: the selectors must be found
inside the tree and must be absent outside it.

The single unavoidable duplication is that the *page* module and the *worker* module must agree that a
composer exists; they agree by the provider `id` values in `src/capture/providers/registry.ts`, which
are already the one place provider identity is defined.

*Rejected: sharing a ladder constant between `src/capture/providers/**` and `src/inject/composers/**`.*
The capture landmark `[contenteditable="true"]` is already declared by two adapters; reusing it as a
composer selector would mean a change made for reading is a change made for writing, and the two have
opposite failure modes.

*Rejected: `document.querySelectorAll` with a selector built at runtime from the adapter's own
configuration.* It reads as configuration-friendly and is exactly the shape G8.4 forbids: a ladder
that arrives at runtime can be changed by something other than a reviewed commit.

## Recorded limitations

These are stated rather than hidden, because each one is a place where the feature is less than it
looks:

1. **A framework-controlled composer may not notice a direct text write.** The text is in the DOM;
   whether the provider's own state updates without a keystroke is not something this extension can
   promise. The report says the text was placed, not that the page agrees.
2. **The ladders are hypotheses about pages nobody in this repository controls.** `verifiedAt` records
   the date the shape was last checked, exactly as the capture adapters do, and a drift in the top
   rung is visible in the report's `rungs` rather than swallowed.
3. **Placement needs the target page to be the active tab.** The composer has to exist in a document,
   and `chrome.tabs` reach is the existing `activeTab` grant — no new permission, and no tab the user
   has not surfaced.
4. **The manual gate is a human step.** Task 4.3 moves G4.5 out of the follow-up list only after a
   person has placed context into a real composer on a real provider page and recorded what happened.
   No spec in this repository can discharge it.
