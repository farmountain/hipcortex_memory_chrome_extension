# Chrome Web Store — submission package

**Status: not yet uploaded.** There is no listing to install from. This document is the change set
that makes a submission possible; it is not evidence that one happened. Evidence of an upload would
be a listing URL, and there is not one.

Uploading is a manual step performed in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). Nothing in this repository
uploads anything, and nothing should be written here that claims otherwise.

The publisher account is `742d17eb-82ee-46a9-9f3d-5cf0eee38065`. That identifier belongs to the
account and never appears in the package; the item's extension ID belongs to the item and cannot be
set by the package at all.

**The item's extension ID is not the ID the local build uses, and the package must not try to set
it.** `public/manifest.json` pins a `key` so that the extension loaded from `dist/` has a stable ID —
`eklnpdcephecmddelagbablmeajoogkf` — because the native messaging host has to name that ID in
`allowed_origins` before the extension has ever been loaded. The store works the other way round: it
**refuses the whole package** when the manifest carries a `key` (*"key field is not allowed in
manifest"*) and derives the item's ID from a public key it generates and holds. So `npm run package`
removes the field from the **archived copy only**; `dist/manifest.json` keeps it, and
`tests/host/registration.spec.ts` asserts that it must.

**§11 is the step that reconciles the two, and skipping it breaks the native host for everyone who
installed from the store.** It is the one part of this submission that changes an identifier the
repository already asserts.

## 1. The artifact to upload

| | |
|---|---|
| File | `hipcortex-chrome-extension-v0.2.2.zip` |
| Built by | `npm run package` |
| Size | 249,061 bytes |
| Entries | 171 |
| SHA-256 | `5167E2556DEF93B50E18C189B8921745FD56DC29DBA16F82B9825F1E61D45FE0` |
| `manifest.json` | at the archive root, and **not** byte-identical to `public/manifest.json`: the archived copy has no `key`, because the store refuses any package that carries one (§11) |

`npm run package` refuses to write an archive whose entry names contain a backslash, whose
`manifest.json` is not at the root, or whose archived manifest still carries `key`, because each of
those is a package the store rejects — and the backslash one shipped once already, in a Windows-built
archive that was not ZIP-valid.

**The release asset is this tree's own output, byte for byte.** `v0.1.0` established that the
mechanism preserves the bytes: the file `npm run package` wrote was uploaded to that release and then
downloaded back and compared — same size, same SHA-256, 168 entries on both sides, no `key` in either
manifest. An earlier asset on that release was built before the field was stripped and is the archive
the store refused; it has been replaced. So has the asset that carried the first icon set: replacing
the artwork rewrites four entries and therefore the whole archive.

`0.2.0` was the first release built since the capture-reachability change set, and every number in
the table above was measured on the file `npm run package` wrote for it, with an independent ZIP
implementation rather than the writer that produced the file — not carried over from `0.1.0`. The
entry count moved from 168 to 171, which is a net figure: the change set added compiled modules
(`capture/flush.js`, `ui/site-access.js` and their declarations) and an earlier change set retired
`api/client`, so the delta is not the number of files added.

`0.2.1` changes no shipped source at all. A working-tree diff restricted to the three trees that
reach the archive — `git diff --stat -- public/ scripts/ src/` — reports one changed file, and that
file is `public/manifest.json`, whose only differing line is the `version` field. The string is the
same length as the one it replaced, so the size and entry count above are unchanged; they were
re-measured on the new file rather than carried forward, and the SHA-256 is nevertheless a different
number, for the reason in the next sentence.

`0.2.2` changes no shipped source either. The same restricted diff reports one changed file,
`public/manifest.json`, and two changed lines inside it — `version` and `description`. Both lines are
the same number of characters as the ones they replaced, and the compiled output under `dist/` is
correspondingly unchanged, which is why the entry count is still 171. The size moved by one byte;
that figure carries no signal here, because the writer stamps every entry with its build time, so two
builds of an identical tree do not produce identical archives. What `0.2.2` is *for* is the second of
those two lines: the dashboard locks the description once the item has been uploaded, so changing it
after publication costs another version, and this is the last release before publication. §3 records
what changed in the sentence and why.

The in-repo writer stamps every entry with the time it was built, so a rebuild is never
byte-identical to a previous one — if you rebuild, upload that file and hash the file you uploaded
rather than trusting this table.

Properties verified against the built archive with an independent ZIP implementation
(`System.IO.Compression`), not with the writer that produced it:

```
entries=171 backslash=0 fwdslash=151 rootManifest=1 nestedManifest=0 hasKey=0
icons/icon16.png   274 bytes  -> 16x16
icons/icon32.png   374 bytes  -> 32x32
icons/icon48.png   620 bytes  -> 48x48
icons/icon128.png  1031 bytes -> 128x128
```

## 2. Graphic assets

| Asset | Required | Size | Path |
|---|---|---|---|
| Store icon | yes | 128×128 | `public/icons/icon128.png` |
| Small promo tile | **yes** | 440×280 | `store/promo-tile-440x280.png` |
| Screenshots | **yes**, 1–5 | 1280×800 | `store/screenshots/` — see §9 |
| Marquee | no | 1400×560 | `store/marquee-1400x560.png` |

The icon, the promo tile and the marquee are **placeholders**. They share one visual identity — the
indigo field `#4F46E5` and a mark that is a rounded plate carrying two lines of text — and that mark
is drawn from geometry rather than designed: `public/icons/` by `.scratch/make-icons.mjs`, the other
two by `.scratch/make-store-art.ps1`. Both generators live in a gitignored directory and are run by
hand; neither is part of the build. `docs/clarity-ledger.json` already records that the icons must be
replaced before the listing goes public, and the promo tile and marquee carry that same status.
Replace all of them together.

Both generators assert what they produced, because a file's existence is not its fitness. The icon
generator renders the mark at each size it is asked for instead of resampling one bitmap,
supersamples 16 times, writes filter type 0 on every scanline — because
`tests/quality/manifest.spec.ts` decodes those pixels — and re-opens every file to check its
dimensions, its colour type and the transparency of a corner pixel. The tile and marquee generator
asserts that every string it draws fits inside its frame and re-opens each file to check its
dimensions, so a copy change that would clip the tile fails there instead of shipping.

The screenshots in `store/screenshots/` are the part of the listing that is a photograph of the
product rather than artwork. §9 says what produced them, what state each was captured in, and which
scene in the plan was deliberately not supplied.

Store artwork deliberately does not live under `public/`. Only the files named in
`scripts/copy-assets.js` reach `dist/`, and listing artwork is not part of the extension package.

## 3. Paste-ready listing copy

The store's own description field is limited to 16,000 characters.

### Name

```
HipCortex Memory
```

16 characters against a limit of 45.

### Short description

This is the manifest's `description`, and it must stay byte-identical to it — the dashboard will not
let you edit package metadata after upload, so a divergence here means a version bump. It is also
what a search result shows first, which is why it opens with the problem rather than the mechanism.

```
Stop losing your AI conversations. Keep ChatGPT, Claude, Grok, Gemini and DeepSeek chats in a private memory on your own machine.
```

129 characters against a limit of 132. Three characters of headroom is deliberate: the field cannot
be edited in the dashboard, and a version bump is the only way to change it afterwards.

`0.2.2` rewrote this sentence and kept it at 129 characters, so the headroom above is unchanged.
Two things were wrong with the previous wording. *"a memory you own, on your own machine"* said
**own** twice in seven words, and *"Capture … into"* named the mechanism rather than the result —
what the extension does for a reader is keep the conversations, not capture them. The word **private**
is now in the sentence because it is the differentiator: every other tool in this category also
captures a ChatGPT conversation, and almost none of them can say the copies stay on the machine they
were made on. The provider list is untouched, and it is the part that costs the most budget — 42
characters, a third of the field, spent naming five products a reader is searching for by name.

### Detailed description

```
Your best thinking happens in a chat window - and then it scrolls away. Across five of them, in fact: ChatGPT, Claude, Grok, Gemini and DeepSeek, each holding a piece of it.

HipCortex Memory captures the AI conversations you have in the browser and delivers them to a HipCortex runtime running on your own computer. Not to a service, not to an account, not to a copy on someone else's server: to a memory you own, on the machine in front of you.

It is a capture tool, not an assistant. It reads the conversation, normalises it into a provider-agnostic record, and hands it to your runtime. Everything that makes sense of that memory - consolidation, retrieval, ranking - is the runtime's job, on your machine.

WHAT YOU GET

- Nothing you worked out with an AI disappears into a scrollback. Once you have allowed a site, the extension reads a conversation's turns as they appear and keeps them, without you copying anything.
- Capture never touches a site you have not allowed. Chrome will not let it read ChatGPT, Claude, Grok, Gemini or DeepSeek until you grant that site, and the grant is one click on the settings page, listed next to the sentence it is about. Until then the extension is installed and idle.
- Ask for the conversation in front of you, by name. "Capture this conversation" in the popup and in the side panel captures the whole of the conversation in the current tab on demand - not gated by any setting, because a click is not the extension acting on its own. It always answers: what it captured, what it is holding for your runtime, or why it could not - never silence.
- A switch that turns watching off, and says so where you can see it. Passive capture ships on, and the popup carries the switch that stops it. With it off nothing is read as you browse; the button above still works, and a capture already accepted still drains.
- A memory that outlives the tab. What you captured today is still there, searchable, on your disk, months later.
- Search that answers even when your runtime is stopped. Results come from a local index of what has already been captured, so a stopped server is not a blank screen.
- Capture you can audit instead of trusting. The popup shows whether capture is on, how many captures are queued, how many your runtime has not yet acknowledged, and a clearly marked paused state if the queue reaches its storage ceiling.
- Nothing dropped behind your back. A capture your runtime has not acknowledged is never discarded - the queue pauses and reports instead. There is no loss counter, because there is no loss.
- Take your data with you. Undelivered captures can be exported to a file at any time.
- Bring existing memory in. An existing HipCortex export can be imported, one record at a time, with a recorded id remap so an id from before the import still resolves afterwards.
- Quick add, and a side panel where the work happens. Right-click a selection and choose "Add selection to HipCortex", or right-click the page and choose "Add page to HipCortex". Keyboard: Ctrl+Shift+M (Command+Shift+M on macOS) adds the current selection, and Ctrl+Shift+H (Command+Shift+H on macOS) opens the side panel, which searches and captures beside the page you are already reading.
- Jump straight to what you wrote before. Right-click a selection and choose "Search HipCortex for selection" to look it up in what has already been captured.
- Two ways to reach your runtime. Native messaging to the HipCortex Desktop app, or HTTP to a server you started yourself on http://127.0.0.1:3030.

WHERE YOUR CONVERSATIONS GO

Nowhere, unless you say so. The extension ships with no remote host authorised: its only declared network destinations are 127.0.0.1 and localhost. Saving a runtime address that is not on your machine requires a confirmation dialog that names the exact host and says what will be sent there, and a banner stays on screen for as long as that address is in effect.

There is no HipCortex-hosted service for it to send anything to. It collects no analytics and no telemetry.

WHAT IT DOES NOT DO

It does not summarise, rank, embed or infer anything from your conversations, and it keeps no memory of its own. It never discards a capture that your runtime has not acknowledged.

REQUIREMENTS

A HipCortex runtime on your own machine: the HipCortex Desktop app, which registers the native messaging host, or a HipCortex server you started on http://127.0.0.1:3030. Without one the extension is inert by design - it reports that the runtime is unreachable and holds your captures in its queue rather than losing them.

GET STARTED

1. Add HipCortex Memory to Chrome. It needs no account and asks for no sign-in. The install prompt names the five AI sites and asks for no host beyond them.
2. Capture something straight away: right-click the page and choose "Add page to HipCortex", or select some text and press Ctrl+Shift+M. Quick add needs no setting found first.
3. Allow it to read a site: open Settings from the popup and click the button next to the list of the six supported addresses. From then on, opening a conversation on ChatGPT, Claude, Gemini, Grok or DeepSeek is enough - the popup's capture count is the running total, and the popup's "Capture this conversation" button captures one on demand. The popup shows a marked badge while any site is still unallowed, so a fresh install says what it is waiting for instead of looking broken.
4. Give it somewhere to deliver to: install the HipCortex Desktop app, or start a HipCortex server on http://127.0.0.1:3030. Until you do, the popup reports that the runtime is unreachable and holds everything you captured in the queue - nothing is at stake in the order you do these in.

Your conversations are already being written, by you, in five different places. This is the part that makes them yours.
```

### Category and language

| Field | Value |
|---|---|
| Category | Productivity |
| Language | English (United States) |
| Homepage URL | `https://github.com/farmountain/HipCortex` |

## 4. Privacy — single purpose

The dashboard requires a single-purpose statement, in a box that allows 1,000 characters. It is
reviewed against the permission list, so it has to say what the extension reads and where the data
goes. What follows is the box's text and nothing else.

**The box is already occupied, and it holds the wrong text.** The form reports 129 characters in it,
which is exactly the length of the short description in §3. If that is what is in there, replace it:
the short description is listing copy for the item page, while this box is the statement a reviewer
reads against the seven permission justifications, and the short description does not say what
happens to a captured conversation. The text below uses the room the box has.

#### Single purpose description

```
Capture the AI conversations a user reads and writes in their browser, and deliver them unchanged to a HipCortex runtime the user runs on their own computer. The extension reads conversation text on the five AI sites it supports, and only there, once the user has allowed those sites through Chrome's own permission prompt; plus a page's title and URL, or the selected text, when the user explicitly captures one. It forwards that content over native messaging or loopback HTTP to the user's own runtime, and holds it in local storage until the runtime acknowledges delivery, then keeps one bounded local copy so search answers while the runtime is stopped. That copy is truncated, evicted oldest-first, clearable from the popup, and removed with the extension. It does not summarise or analyse the content, sends nothing to the developer, and declares no remote destination. There is no developer-operated server, no account, no sign-in, no sync and no analytics.
```

964 characters against the box's limit of 1,000.

**The text above replaced a statement that was untrue, and that is the reason to read this section
again rather than trust a paste from an earlier draft.** What it used to say was that the extension
*"does not analyse, summarise, rank, index or retain conversation content for itself"*, and that
content is kept in local storage *"only until"* the runtime acknowledges it. Shipped code
contradicts both halves. `src/index/local.ts` writes a copy of every acknowledged capture — the
conversation's own text, truncated, plus its tokens — into `chrome.storage.local` under the key
`hipcortex.capture.index`, and leaves it there after the acknowledgement. That is the local search
index, it is what lets search answer while the runtime is stopped, and `docs/PRIVACY.md` discloses it
in the retention list and again in the removal instructions. The single-purpose box did not, and the
box is the one place a reviewer reads against a permission list for exactly this kind of claim. A
statement that denies indexing that the package performs is the sort of inconsistency that costs a
submission, so it is corrected rather than softened.

The corrected text says what happens in the order it happens — held until an acknowledgement, then one
bounded copy outliving it. It still declines to write the bound as a number. The bound is
`INDEX_MAX_RECORDS` in `src/index/local.ts`, and a form that cannot be edited after upload should not
carry a constant that source is free to change; *bounded*, *truncated* and *evicted oldest-first* are
the properties a reviewer needs, and each of them is a property of the mechanism rather than of the
value it currently holds.

## 5. Privacy — data disclosure

The data-usage section is nine checkboxes, and the answers are displayed publicly on the item page.
They are answered by what the extension demonstrably reads or stores, not by where the data ends up,
because Chrome's form has no "on-device only" answer and answering "no" to data an extension
demonstrably reads is the failure mode that gets a submission rejected.

| The form's category | Answer | What it covers, and why |
|---|---|---|
| Personally identifiable information | no | No name, address, email address, age or identification number is read. The extension has no account and no sign-in, so there is nothing of this kind for it to hold. The `defaultActor` setting is a free-text label the user chooses for their own records; it defaults to `browser-user` and is not an identity. |
| Health information | no | Not read, not inferred, not requested. |
| Financial and payment information | no | Not read, not inferred, not requested. The extension has no payment path of any kind. |
| Authentication information | **yes** | The options page has an optional **API key** field, and a non-empty value is sent to the configured runtime as `Authorization: Bearer` and `X-API-Key`. It is blank by default and no AI-site credential is ever read. It is declared rather than omitted for one reason worth knowing: settings live in `chrome.storage.sync`, so a key the user enters reaches the user's own Google account. See the note below. |
| Personal communications | **yes** | The conversation turns on the five supported sites — what the user typed and what the model replied. Held in the extension's own local queue until the runtime acknowledges delivery; after that one bounded, truncated copy remains in the local search index, so search still answers while the runtime is stopped. That copy is evicted oldest-first, clearable from the popup, and removed with the extension. Delivered over native messaging or loopback HTTP to a runtime on the user's own computer. Never sent to the developer, who operates no server. |
| Location | no | No region, IP address, GPS coordinate or nearby-device information is read or inferred. The only addresses the manifest pre-authorises are `127.0.0.1` and `localhost`. |
| Web history | **yes** | Every capture carries the conversation's canonical URL, its title when the provider exposes one, and the capture timestamp, and the form's own definition of this category is the pages a user visited together with associated data such as page title and time of visit. Nothing outside the six declared addresses is recorded, the history API is not used, and a URL is stored only for a conversation the user captured — by clicking capture, or by having allowed that site while passive capture is on. The extension reads no site the user has not allowed, so the default state of a fresh install is that nothing at all is recorded. |
| User activity | no | No network monitoring, click, mouse position, scroll or keystroke is recorded, and `chrome.tabs.onUpdated` has no call site. The extension's only observation is of the conversation DOM on the five supported sites, which is the thing it exists to read. |
| Website content | **yes** | The text of the conversation page on the five supported sites; a page's title and URL when the user chooses *Add page to HipCortex*; and the current text selection when the user runs quick-add or *Add selection to HipCortex*. Read from the page, stored locally, delivered to the user's own runtime. No page outside the five sites is read unless the user selects text on it and invokes quick-add. |

**Two of those answers are judgment calls, and they are the two that changed.** The extension's
previous draft answered `no` to both. *Web history* is `yes` because `Provenance.conversationUrl` is
a required field of the capture contract, so the URL of the captured page is stored on every capture
along with a title and a timestamp — data the form enumerates under that heading. *Authentication
information* is `yes` because the options page holds a credential field. Both are answered `yes` so
that the declaration is a superset of what the code does rather than a subset, which is the direction
the risk runs in: an undeclared category is a policy violation, an over-declared one is a sentence of
explanation. The account owner can flip either back after reading the reasoning here.

**A third correction landed with `0.2.2`, in the personal-communications row.** It used to say content
is held *"until the runtime acknowledges delivery, then not kept"*. The queue does release on
acknowledgement; the search index does not, and that row is the one a reviewer reads for what happens
to a conversation. The row now describes the bounded copy that outlives the acknowledgement, in the
same terms §4 uses. The lesson is worth more than the fix: a disclosure can name a mechanism
correctly — *"local queue and search index"* — and still get the retention wrong one clause later, so
each clause about lifetime is worth checking against `src/index/local.ts` rather than against the
paragraph above it.

The same sentence was wrong in a second place, and that one mattered more. `docs/PRIVACY.md` is the
policy this submission publishes as a URL, and its storage section ended *"The extension keeps no copy
of acknowledged captures."* That is the opposite of what `recordAcknowledgedCapture` does, and it was
the one claim in the document set a reader could falsify from the extension's own popup, which reports
how many conversations are searchable offline. The policy now describes the queue and the index as the
two kinds of local copy they are, and its deletion list says that clearing the index removes the
extension's remaining copy of a delivered conversation. Correcting the box without the policy would
have left the more exposed of the two documents wrong.

**One consequence of the API key worth acting on rather than only disclosing.** `apiKey` is part of
`DEFAULT_SETTINGS`, and durable settings are written to `chrome.storage.sync`, so a key the user
enters is uploaded to that user's own Google account. Nothing else in the settings is secret, and
conversation content never enters `sync`. Moving the key to `chrome.storage.local` would remove the
exposure at the cost of not following the user to a second machine. That is a product decision and it
is recorded here rather than made quietly.

Certifications, and why each is true rather than merely ticked:

| Certification | True because |
|---|---|
| Not sold to third parties | There is no third party. The developer operates no server and receives nothing to sell. |
| Not used or transferred for purposes unrelated to the single purpose | The only destination is a runtime on the user's own machine, chosen by the user, and the extension has no other purpose to put data to. |
| Not used to determine creditworthiness or for lending | Not applicable to any data this extension touches. |

**Where the data goes, for the record.** All three declared categories are stored on the user's own
machine and delivered to a program on that machine. The developer has no way to reach any of it.

#### Privacy policy URL

```
https://github.com/farmountain/hipcortex_memory_chrome_extension/blob/main/docs/PRIVACY.md
```

The field accepts 2,048 characters and needs one URL. Paste exactly the block above, which is the
rendered policy in this repository's default branch. That URL resolves today, the repository is
public, and [`docs/PRIVACY.md`](./PRIVACY.md) is the file it renders. The policy has to describe the
three declarations above, which is why it names the captured URL and title and the optional API key
rather than only the conversation text.

## 6. Permission justifications

One row per entry in the manifest's `permissions` array. Removing a permission that has a real call
site breaks the feature; adding one without a row here fails `tests/quality/store.spec.ts`.

| Permission | Why it is needed | Where it is used |
|---|---|---|
| `storage` | Holds the capture queue, the local search index and the id remap in `local`, durable settings in `sync`, and an ephemeral search handoff in `session`. Conversation content never enters `sync`. | `src/capture/queue/queue.ts`, `src/index/local.ts`, `src/migration/remap.ts`, `src/api/transport/acknowledge.ts` |
| `contextMenus` | Adds the three right-click entries: "Add selection to HipCortex" and "Add page to HipCortex", plus "Search HipCortex for selection". | `src/background.ts` |
| `activeTab` | Grants temporary access to the current tab so Ctrl+Shift+M can read the page selection. It is scoped to the one tab the user is on, at the moment they invoke the command, and is revoked when they navigate away. | `src/background.ts` |
| `sidePanel` | Renders the side panel and opens it for the current window when the user presses Ctrl+Shift+H. | `src/background.ts`, `src/popup.ts` |
| `scripting` | Reads the current selection with `executeScript` when the user runs the quick-add command. It injects no code that the extension did not ship. | `src/background.ts` |
| `nativeMessaging` | The default transport. Consumer Mode talks to the HipCortex Desktop app through the host `com.hipcortex.bridge`, which the desktop app registers; the extension cannot register it and says so when it is missing. | `src/api/transport/native.ts` |
| `alarms` | Drives the periodic queue drain. A service worker is terminated when idle, so a timer that must survive that has to be an alarm. One minute is the smallest period Chrome honours for a packed extension. | `src/capture/lifecycle.ts` |

### Paste-ready justifications

The dashboard gives each permission its own free-text box with a 1,000-character limit, and asks for
the host permissions and remote code in separate boxes of the same size. One fence per box follows,
headed by the dashboard's own label. Copy the block; the table above is the reasoning behind it, and
these are the strings. `tests/quality/store.spec.ts` holds them to the limit and to the label, so a
block that the form would reject fails the build instead of failing the submission.

#### storage justification

```
Required rather than convenient, because a Manifest V3 service worker is stopped whenever it goes idle and has no DOM. State that must survive that has to live in the extension's own store: the capture queue, the local search index and the extension-ID remap are in chrome.storage.local, durable settings such as the runtime address are in chrome.storage.sync, and an ephemeral search handoff is in chrome.storage.session. Without it a capture would be lost when the worker stopped, which is the one thing this extension must not do. Conversation content never enters sync, so the browser never uploads a captured conversation. Used at: src/capture/queue/queue.ts, src/index/local.ts, src/migration/remap.ts, src/api/transport/acknowledge.ts.
```

#### contextMenus justification

```
Provides the three right-click entries a user captures with: Add selection to HipCortex, Add page to HipCortex, and Search HipCortex for selection. Capture is an explicit act and the context menu is its primary entry point; the toolbar popup offers the same actions for the page the user is already looking at. The entries are created once from a fixed list, never dynamically per page, and no entry is offered on a site the extension does not support. Used at: src/background.ts.
```

#### activeTab justification

```
Lets the quick-add shortcut read the text the user selected on the tab they are currently on, without the extension holding access to that site in advance. The grant covers only the active tab, is created by the user's own invocation of Ctrl+Shift+M or of the matching context-menu entry, and expires when the user navigates away. It is the reason the extension asks for no broad host access: the user decides, one invocation at a time, which page is read. Used at: src/background.ts.
```

#### sidePanel justification

```
Renders the side panel, which is where the capture queue's delivery state and the local search live, and lets the extension open it for the current window when the user presses Ctrl+Shift+H or opens it from the toolbar popup. The panel is the extension's only surface that stays open while the user works, and it is what makes a paused queue visible instead of silent. Used at: src/background.ts, src/popup.ts.
```

#### scripting justification

```
Used at exactly one call site: to read the current text selection with executeScript when the user runs the quick-add command, and to deliver that selection as a record. No code is fetched, evaluated or constructed — the function passed to executeScript is a literal inside the extension's own package, and the extension ships no remote script, no remote WebAssembly and no dynamically created script element. The permission is not used to inject the content script; that is declared in the manifest. Removing it would mean dropping the quick-add feature. Used at: src/background.ts.
```

#### nativeMessaging justification

```
The default transport. In Consumer Mode the extension talks to the HipCortex Desktop application through the native host com.hipcortex.bridge, which the desktop application installs and registers; a browser extension cannot register a native host itself, so when the host is absent the extension reports that clearly and falls back rather than failing silently. This is the transport that opens no network socket at all, which is why the install flow recommends it. Used at: src/api/transport/native.ts.
```

#### alarms justification

```
Drives the periodic drain of the capture queue. A service worker is stopped when idle, so a retry timer that has to outlive the worker must be an alarm rather than a timeout; one minute is the shortest period Chrome honours for a packed extension. Without it a queued capture would wait for the next page visit before delivery was attempted again, and a user who had closed the tab would be left with undelivered content and nothing prompting a retry. Used at: src/capture/lifecycle.ts.
```

#### Host permission justification

```
This extension has two host needs and no others.

1. Content scripts on the five supported AI sites, as six origins because ChatGPT has two hostnames: https://chatgpt.com/*, https://chat.openai.com/*, https://claude.ai/*, https://gemini.google.com/*, https://grok.com/* and https://chat.deepseek.com/*. Reading conversations there is its entire function, and it reads no other site. The same six addresses are declared under optional_host_permissions, and the settings page requests exactly that list in one click; until then Chrome does not let it read them.

2. Loopback access, to deliver to a HipCortex runtime on the user's own computer: http://127.0.0.1:3030/* and http://localhost:3030/*.

No remote host is pre-authorised. A non-loopback address is refused in auto and consumer modes, and in developer mode it requires a confirmation naming the host plus a banner that persists while it is in effect.
```

#### Remote code justification

```
No. All JavaScript is inside the package. tsc compiles the extension into dist/ and scripts/build-content.js bundles the single content-script entry into dist/content.js at package time; the service worker loads background.js as a module and nothing else. There is no eval, no new Function, no remote script, no remote WebAssembly, no dynamically created script element and no string-based evaluation anywhere in src/. The extension also fetches nothing at runtime that could carry code or change behaviour: the provider selector ladders are compiled in, which is deliberate, because a selector table fetched at run time would be remote code under another name. The only network requests it makes are JSON requests to the runtime address the user configured.
```

### Host permissions

`host_permissions` is loopback only — `http://127.0.0.1:3030/*` and `http://localhost:3030/*`. No
remote host is pre-authorised anywhere in the manifest. A non-loopback runtime address is refused in
`auto` and `consumer` modes, and in `developer` mode it requires a confirmation that names the host
and a banner that persists while it is in effect.

### Provider origins, and the optional declaration

`content_scripts.matches` carries the six provider origins (ChatGPT on two hostnames, Claude,
Gemini, Grok, DeepSeek). That is the mechanism that puts the capture script on those sites, and it
is what the install-time warning names.

`optional_host_permissions` lists the same six origins because `docs/END-STATE.md` **G1.9** requires
it, and the options page requests **that list, unchanged**, through `chrome.permissions.request` —
`src/options.ts` is the one call site in `src/`. Two deliberate properties of that request are worth
stating for a reviewer comparing the two lists:

- **It names every declared origin at once and nothing else.** There is no per-host grant, no
  origin built from a string, and no address the manifest does not declare, so the permission asked
  for is exactly the permission declared.
- **It is made from the options page, in the page, and not routed through the service worker.**
  Chrome answers `permissions.request` only for a gesture in the document that made the call, a
  gesture does not survive a message hop, so routing it through the worker would turn one click into
a silent no-op. This is why the grant is one click on a page the user is already looking at rather
than something other surfaces can trigger.

### Remote code

None. No `eval`, no `new Function`, no remotely hosted script and no remote WASM. The only bundled
script is `dist/content.js`, built at package time by `scripts/build-content.js`. The paste-ready
answer is the **Remote code justification** block above; this subsection is why it is true, and it is
checkable rather than asserted —

```powershell
git grep -n -E "\beval\s*\(|new Function|WebAssembly|importScripts" -- src
git grep -n "createElement" -- src
```

The first command returns nothing in `src/`. The second returns only `document.createElement` calls
for `div`, `span`, `option`, `a`, `button` and `p` — DOM construction, never a `script` element and
never an evaluated string.

## 7. Distribution and visibility

| Field | Value | Why |
|---|---|---|
| Pricing | Free | There is nothing to charge for; the runtime is the product the user already runs. |
| Visibility | Public | — |
| Regions | All regions | No region-specific behaviour exists. |
| Mature content | No | — |

The dashboard's confirmation dialog has a **deferred publish** checkbox. Leaving it ticked publishes
on approval; unticking it stages the item, and a staged item reverts to a draft after 30 days. Opt
into publish and staged emails on the **Account** page — they are off by default, and a rejection
notice is not something to learn about from a support thread.

## 8. Test instructions for reviewers

This is the part most likely to produce a rejection, so it is written to be followed literally.

**The reviewer will not have a HipCortex runtime**, and the extension cannot function without one.
That is expected and it is not a defect. What a reviewer can verify without any runtime is the
whole of the security-relevant behaviour, because every path that would leave the machine fails
closed and says why.

1. Install the extension. It appears with the name **HipCortex Memory**. The install prompt names
   the six permitted addresses — five AI sites, ChatGPT being declared under two hostnames — and
   asks for no host beyond them.
2. Click the toolbar icon. The popup opens and shows a health indicator reporting that the runtime
   is unreachable, alongside a capture status section showing the passive switch, queue length and
   unacknowledged count. **Nothing is silently failing.** With no runtime installed, quick-add
   reports a refusal and the capture stays in the queue — it is not discarded and not reported as
   delivered.
3. Open the options page from the popup's Settings link. It lists the six permitted addresses with
   the sentence *"HipCortex is allowed to read…"* or *"Nothing is captured from a site until you
   allow it"*, and a button beside it. Click the button: Chrome asks to allow exactly those six
   addresses and nothing else. **That grant is the whole of what the extension may read**, and it is
   revocable from `chrome://extensions` at any time. Then, from the same page, set transport mode to
   `developer` and enter a base URL on a host that is not this machine, for example
   `http://example.com:3030`. A confirmation dialog appears that names that exact host and states
   that every captured conversation will be sent there. Choose Cancel: the address is not saved and
   the previously saved address is named. This is the anti-exfiltration behaviour, and it is the
   reason this extension exists in the shape it does.
4. Press Ctrl+Shift+H. The side panel opens beside the page.
5. Right-click a text selection on any page. The menu shows "Add selection to HipCortex" and "Search
   HipCortex for selection". Right-click a page with no selection and it shows "Add page to
   HipCortex".
6. Click **Capture this conversation** in the popup on any page that is not one of the six — for
   example this dashboard. It reports a typed sentence saying the page is not a conversation on a
   site the extension reads. **A capture control that hangs instead of answering is the defect this
   control exists to make impossible**, so the check is that it answers at all.
7. Open `https://chatgpt.com` and start a conversation. Before the grant in step 3 the extension is
   idle there and the popup's badge is marked `!`, which is what a fresh install shows. After the
   grant, and with no runtime, the extension reports that capture is on but delivery is blocked, and
   the queue length rises. The captures are held, not lost.

To exercise a successful capture end-to-end, a HipCortex runtime is required. It is a local
component and is not something the extension can provide.

## 9. Screenshots

Three screenshots ship in `store/screenshots/`, each exactly 1280×800 and each a 24-bit PNG with no
alpha channel. The dashboard accepts JPEG or 24-bit PNG without alpha; alpha is the failure worth
naming, because the extension's own icons are RGBA and a screenshot that inherited their colour type
would be the wrong asset in the wrong slot. `tests/quality/store.spec.ts` reads the dimensions and the
colour-type byte of every file in that directory, so the directory and the requirement cannot drift
apart unnoticed.

| File | Shows |
|---|---|
| `01-popup.png` | The toolbar popup: health badge, the "Capture this conversation" button, the passive-capture switch with the three capture counters, the quick-add field and the offline search |
| `02-side-panel.png` | The side panel — the second surface, where a capture is made beside the page being read |
| `03-runtime-settings.png` | The options page: base URL, transport mode, default actor, and the migration section |

**How they were produced.** `.scratch/store-capture.mjs` launches a real Chromium, loads `dist/`
unpacked, opens each surface and screenshots the viewport over the Chrome DevTools Protocol;
`.scratch/store-compose.mjs` then crops each frame to the page's own body box, resamples it to its CSS
size and lays it on the indigo field at exactly 1280×800. Nothing is drawn, captioned, arrowed or
mocked, and the browser's own chrome is absent **by construction** rather than cropped out, because a
viewport screenshot never had any. Both scripts live in a gitignored directory and are run by hand;
neither is part of the build, so no gate depends on a browser being installed.

**What state they are in, and why it matters.** Every frame was captured against a live runtime
reporting version `3.11.0`, from an unpacked build whose install prompt names no host beyond the six
AI sites. The popup's search scope is left on its offline default — "Captured conversations
(offline)" — so no frame contains a query against the runtime's memory, a captured conversation, an
API key or a personal actor name. The search panel reports zero offline records because that is the
truthful state: nothing on this machine has been acknowledged by the runtime yet, and the panel says
so in words rather than looking broken. The quick-add field holds a sample sentence typed by the
capture script to show the control, and the script never submits it, so taking these pictures created
no record.

**The scenes that are not here.** Two rows of the plan below are deliberately unfilled. The context
menu is drawn by the operating system and no automation in this repository can open it — the same
limitation `.scratch/browser-e2e.mjs` records for that surface. The populated search result is the
other: filling it means querying the user's own memory, which is the one thing a public listing must
not put in an image. Both are recorded as gaps rather than filled with a reconstruction, because a
screenshot of a menu that was never opened, or a result set that was never returned, would be a
fabricated one.

The plan below is the reasoning for which surfaces earned a frame, and the surfaces are the ones gate
**8.12** in
[`openspec/changes/cortexbridge-perception-layer/`](../openspec/changes/cortexbridge-perception-layer/)
already requires loading `dist/` unpacked to exercise:

| # | Show | Why it is worth a slot | Status |
|---|---|---|---|
| 1 | The popup with the runtime reachable, quick-add field, and capture status | The whole product in one frame | shipped, `01-popup.png` |
| 2 | Search results with the provider filter in use | Cross-provider retrieval is the distinctive feature | **not shipped** — see "the scenes that are not here" |
| 3 | The context menu open over a selection on a supported site | Shows capture is a deliberate act, not passive surveillance | **not shipped** — see "the scenes that are not here" |
| 4 | The options page, transport mode and base URL | Shows the user controls where captures go | shipped, `03-runtime-settings.png` |
| 5 | The side panel beside a conversation | The second surface | shipped, `02-side-panel.png` |

Do not include the browser's own chrome, a macOS menu bar, the Windows taskbar, or any text stating
the store's own category, rank or price. Screenshots are the first thing a reviewer looks at and the
first thing that gets a listing rejected when they do not match the extension.

## 10. What this document does not establish

- **That the item is listed.** It is not. No upload has happened. A draft item exists in the
  Developer Dashboard — *HipCortex Memory*, status **Draft**, item ID
  `pjapbnibehgmgilenkgndfpfjkokikbl` — and the Privacy tab of that draft is what §4–§6 fill in. That
  ID is the store's, and §11 says what to do with it: it is not `eklnpdcephecmddelagbablmeajoogkf`,
  because the manifest currently pins a key of this repository's own making, so an unpacked build
  reports the latter until §11's key exchange has been done. Both numbers are real and neither is
  wrong; §11 says which one ends up where.
- **That the artwork is a brand asset.** The mark is drawn geometry — a rounded plate and two lines —
  not a designed identity. Replace all three files together before the listing is promoted.
- **That the screenshots show a populated product.** Three frames exist and §9 names them; each is a
  truthful capture of a runtime-connected extension whose offline index is empty, and two scenes in
  the plan are recorded as gaps rather than supplied.
- **That a submission would be approved.** These are the inputs; approval is a reviewer's decision.
- **That the declarations in §4–§6 have been made.** They are drafted to be pasted, under the
  publisher account, by the person who owns that account.
- **That the two judgment calls in §5 are settled.** *Web history* and *Authentication information*
  are answered `yes` for the reasons §5 gives. Both can be flipped by the account owner; neither flip
  requires a code change, and flipping either back to `no` means disagreeing with the reasoning
  written next to it rather than correcting a mistake in this document.
- **That the API key's storage scope is settled.** §5 records that `apiKey` is part of
  `DEFAULT_SETTINGS` and therefore reaches browser-synced storage. Moving it to
  `chrome.storage.local` is the change that would let *Authentication information* be answered `no`,
  and it is not made here.
- **That the retention language was already consistent.** It was not, before `0.2.2`. The
  single-purpose box, the personal-communications row and `docs/PRIVACY.md` each denied, in their own
  words, a copy of an acknowledged capture that `src/index/local.ts` writes and the popup reports. All
  three now describe the same mechanism in the same terms, and none of them states a number,
  deliberately — §4 gives the reason. This is worth a line here because it is the kind of defect that
  no test in this repository can catch: the assertions compare documents to the manifest, and the
  manifest does not describe retention.

## 11. After the first upload — make the extension ID the store's

This is not optional, and it is the only part of the submission that changes a number the repository
already asserts.

**Why the two IDs differ.** An extension loaded from `dist/` is identified either by the `key` in its
manifest or, with no key, by a hash of the folder it was loaded from. The native messaging host has
to name that ID in `allowed_origins` *before* the extension has ever been loaded, so the manifest
pins a `key` and `scripts/install-host.mjs` derives the ID from it. The store is the reverse: it
refuses a package whose manifest carries a `key`, and it derives the item's ID from a public key it
generates and holds. So the store item will **not** be `eklnpdcephecmddelagbablmeajoogkf`.

**The ID it will be is already known, which removes the guesswork from step 6.** The draft item
reports `pjapbnibehgmgilenkgndfpfjkokikbl`, and that is the value the unpacked build must report once
step 4 has replaced the `key` — because a store item's ID is derived from the public key the store
holds, which is the key step 3 copies. The derivation is the one `scripts/install-host.mjs` already
performs, and it can be read off without writing anything:

```powershell
npm run install:host -- --dry-run
```

The plan that prints carries `allowed_origins`, and today it reads
`chrome-extension://eklnpdcephecmddelagbablmeajoogkf/`. After step 4 it must read
`chrome-extension://pjapbnibehgmgilenkgndfpfjkokikbl/`. Step 6 is then a comparison of two known
strings rather than a hunt through the dashboard.

**What to do, in order.**

1. Upload the archive from §1. Its manifest carries no `key`, which is what the validator requires.
2. In the Developer Dashboard, open the item, go to the **Package** tab and click **View public key**.
3. Copy the text between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----`, and remove the
   newlines so that it is one line.
4. Replace the `key` value in `public/manifest.json` with it. No other field changes.
5. `npm run build`, then `npm run install:host` — that second command is what puts the store ID into
   `allowed_origins` — then reload the extension from `dist/`.
6. Check that the two agree: the ID on `chrome://extensions` must equal the **Item ID** the dashboard
   shows. That comparison is Chrome's own documented check, and it is the one that matters.

**What goes wrong if it is skipped.** The store build and the local build keep different IDs. Someone
who installed from the store, then runs `npm run install:host` from this repository, gets a host
manifest whose `allowed_origins` names `chrome-extension://eklnpdcephecmddelagbablmeajoogkf/`, which
is not the extension they have. Chrome refuses the connection to the native host, and the error it
reports names neither the key nor the ID nor this document.

**Why not simply drop the field.** Without a `key`, an unpacked extension's ID is a hash of the folder
it was loaded from, so it would differ per checkout and per machine, and
`deriveExtensionId` returns `null` for a manifest that pins nothing — `npm run install:host` could
not compute an ID at all. Keeping the field and replacing its value after the first upload leaves the
unpacked build stable *and* answering to the same ID as the store item.
