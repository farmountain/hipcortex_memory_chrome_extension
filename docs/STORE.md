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
| File | `hipcortex-chrome-extension-v0.1.0.zip` |
| Built by | `npm run package` |
| Size | 229,722 bytes |
| Entries | 168 |
| SHA-256 | `9D103409DE4C25AFA58C5984CC6B728B1DAE6EC994B8F9E79FD6AC4A2AF83639` |
| `manifest.json` | at the archive root, and **not** byte-identical to `public/manifest.json`: the archived copy has no `key`, because the store refuses any package that carries one (§11) |

`npm run package` refuses to write an archive whose entry names contain a backslash, whose
`manifest.json` is not at the root, or whose archived manifest still carries `key`, because each of
those is a package the store rejects — and the backslash one shipped once already, in a Windows-built
archive that was not ZIP-valid.

**The release asset is this tree's own output, byte for byte.** The file `npm run package` wrote was
uploaded to the `v0.1.0` release, and then downloaded back and compared: same size, same SHA-256, 168
entries on both sides, no `key` in either manifest. An earlier asset on that release was built before
the field was stripped and is the archive the store refused; it has been replaced. The in-repo writer
stamps every entry with the time it was built, so a rebuild is never byte-identical to a previous
one — if you rebuild, upload that file and hash the file you uploaded rather than trusting this
table.

Properties verified against the built archive with an independent ZIP implementation
(`System.IO.Compression`), not with the writer that produced it:

```
entries=168 backslash=0 fwdslash=148 rootManifest=1 nestedManifest=0 hasKey=0
icons/icon16.png  89 bytes   -> 16x16
icons/icon32.png  114 bytes  -> 32x32
icons/icon48.png  134 bytes  -> 48x48
icons/icon128.png 353 bytes  -> 128x128
```

## 2. Graphic assets

| Asset | Required | Size | Path |
|---|---|---|---|
| Store icon | yes | 128×128 | `public/icons/icon128.png` |
| Small promo tile | **yes** | 440×280 | `store/promo-tile-440x280.png` |
| Screenshots | **yes**, 1–5 | 1280×800 | `store/screenshots/` — see §9 |
| Marquee | no | 1400×560 | `store/marquee-1400x560.png` |

The icon, the promo tile and the marquee are **placeholders**. They share one visual identity — the
indigo ink `#4F46E5` and a hard-edged square mark — and they are generated, not designed:
`public/icons/` by `.scratch/make-icons.mjs`, the other two by `.scratch/make-store-art.ps1`. Both
generators live in a gitignored directory and are run by hand; neither is part of the build.
`docs/clarity-ledger.json` already records that the icons must be replaced before the listing goes
public, and the promo tile and marquee carry that same status. Replace all of them together.

The generator asserts that every string it draws fits inside its frame and re-opens each file to
check its dimensions, so a copy change that would clip the tile fails there instead of shipping.

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
Stop losing your AI conversations. Capture ChatGPT, Claude, Grok, Gemini and DeepSeek into a memory you own, on your own machine.
```

129 characters against a limit of 132. Three characters of headroom is deliberate: the field cannot
be edited in the dashboard, and a version bump is the only way to change it afterwards.

### Detailed description

```
Your best thinking happens in a chat window - and then it scrolls away. Across five of them, in fact: ChatGPT, Claude, Grok, Gemini and DeepSeek, each holding a piece of it.

HipCortex Memory captures the AI conversations you have in the browser and delivers them to a HipCortex runtime running on your own computer. Not to a service, not to an account, not to a copy on someone else's server: to a memory you own, on the machine in front of you.

It is a capture tool, not an assistant. It reads the conversation, normalises it into a provider-agnostic record, and hands it to your runtime. Everything that makes sense of that memory - consolidation, retrieval, ranking - is the runtime's job, on your machine.

WHAT YOU GET

- Nothing you worked out with an AI disappears into a scrollback. On a supported site the extension reads the conversation's turns and captures them as you go.
- A memory that outlives the tab. What you captured today is still there, searchable, on your disk, months later.
- Search that answers even when your runtime is stopped. Results come from a local index of what has already been captured, so a stopped server is not a blank screen.
- Capture you can audit instead of trusting. The popup shows whether capture is on, how many captures are queued, how many your runtime has not yet acknowledged, and a clearly marked paused state if the queue reaches its storage ceiling.
- Nothing dropped behind your back. A capture your runtime has not acknowledged is never discarded - the queue pauses and reports instead. There is no loss counter, because there is no loss.
- Take your data with you. Undelivered captures can be exported to a file at any time.
- Bring existing memory in. An existing HipCortex export can be imported, one record at a time, with a recorded id remap so an id from before the import still resolves afterwards.
- Quick add, and a side panel where the work happens. Right-click a selection or a page and choose "Add to HipCortex", or press Ctrl+Shift+M (Cmd+Shift+M on macOS). Search and capture beside the page at Ctrl+Shift+H.
- Two ways to reach your runtime. Native messaging to the HipCortex Desktop app, or HTTP to a server you started yourself on http://127.0.0.1:3030.

WHERE YOUR CONVERSATIONS GO

Nowhere, unless you say so. The extension ships with no remote host authorised: its only declared network destinations are 127.0.0.1 and localhost. Saving a runtime address that is not on your machine requires a confirmation dialog that names the exact host and says what will be sent there, and a banner stays on screen for as long as that address is in effect.

There is no HipCortex-hosted service for it to send anything to. It collects no analytics and no telemetry.

WHAT IT DOES NOT DO

It does not summarise, rank, embed or infer anything from your conversations, and it keeps no memory of its own. It never discards a capture that your runtime has not acknowledged.

REQUIREMENTS

A HipCortex runtime on your own machine: the HipCortex Desktop app, which registers the native messaging host, or a HipCortex server you started on http://127.0.0.1:3030. Without one, the extension reports that the runtime is unreachable and holds your captures in its queue rather than losing them - so nothing is at stake in the order you set things up in.

GET STARTED

1. Add HipCortex Memory to Chrome. It needs no account and asks for no sign-in.
2. Give it somewhere to deliver to: install the HipCortex Desktop app, or start a HipCortex server on http://127.0.0.1:3030.
3. Open a conversation on ChatGPT, Claude, Gemini, Grok or DeepSeek and watch the capture count in the popup - or press Ctrl+Shift+M to add the page you are reading right now.

Your conversations are already being written, by you, in five different places. This is the part that makes them yours.
```

### Category and language

| Field | Value |
|---|---|
| Category | Productivity |
| Language | English (United States) |
| Homepage URL | `https://github.com/farmountain/HipCortex` |

## 4. Privacy — single purpose

The dashboard requires a single-purpose statement. It is reviewed against the permissions.

```
Capture the AI conversations the user has in the browser and deliver them, unchanged, to a HipCortex runtime the user runs on their own machine. The extension does not analyse, summarise, rank or retain those conversations itself.
```

## 5. Privacy — data disclosure

The disclosure form asks which categories of user data the extension accesses, and then asks for a
justification in free text. Every free-text box must say the same thing, because it is the thing
that is true: **the destination is the user's own machine, and the developer receives nothing.**

| Category | Declared | Justification |
|---|---|---|
| Personal communications | **yes** | Conversation turns on the five supported sites. Stored in the extension's own local queue and index, and delivered to a runtime on the user's own machine over loopback or native messaging. Never sent to the developer. |
| Website content | **yes** | The page's title and URL, only when the user explicitly captures a page from the context menu. Same destination. |
| User activity | no | The extension does not read or record browsing activity outside the five supported sites. |
| Web history | no | No history API is used and no visited URLs are recorded. |
| Location, health, financial, authentication, personally identifiable information | no | Not read, not inferred, not transmitted. |

Certifications, and why each is true rather than merely ticked:

| Certification | True because |
|---|---|
| Not sold to third parties | There is no third party. The developer operates no server. |
| Not used or transferred for purposes unrelated to the single purpose | The only destination is a runtime on the user's own machine, chosen by the user. |
| Not used to determine creditworthiness or for lending | Not applicable to any data this extension touches. |

A privacy-policy URL is required once personal communications are declared. See
[`docs/PRIVACY.md`](./PRIVACY.md); the URL to paste is the rendered GitHub blob link.

**These declarations are made under the publisher account, so confirm them before submitting.**
They are written to over-disclose: both categories above are accessed but never leave the machine,
and Chrome's form has no "on-device only" answer. Declaring a category and explaining the destination
is the honest reading; silently answering "no" to data the extension demonstrably reads is not.

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
| `alarms` | Drives the periodic queue drain. A surface worker is terminated when idle, so a timer that must survive that has to be an alarm. One minute is the smallest period Chrome honours for a packed extension. | `src/capture/lifecycle.ts` |

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
it. Be aware of one thing when filling the form: **nothing requests them at runtime.**
`chrome.permissions.request` has no call site anywhere in `src/`. Capture into those sites does not
depend on the optional grant, so the declaration is currently redundant. It stays — G1.9 requires it —
and it is described here rather than quietly left unexplained, because a reviewer comparing the two
lists will notice.

### Remote code

None. No `eval`, no `new Function`, no remotely hosted script and no remote WASM. The only bundled
script is `dist/content.js`, built at package time by `scripts/build-content.js`.

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
   the six AI sites and asks for no host beyond them.
2. Click the toolbar icon. The popup opens and shows a health indicator reporting that the runtime
   is unreachable, alongside a capture status section showing capture state, queue length and
   unacknowledged count. **Nothing is silently failing.** With no runtime installed, quick-add
   reports a refusal and the capture stays in the queue — it is not discarded and not reported as
   delivered.
3. Open the options page from the popup's Settings link. Set transport mode to `developer` and enter
   a base URL on a host that is not this machine, for example `http://example.com:3030`. A
   confirmation dialog appears that names that exact host and states that every captured
   conversation will be sent there. Choose Cancel: the address is not saved and the previously saved
   address is named. This is the anti-exfiltration behaviour, and it is the reason this extension
   exists in the shape it does.
4. Press Ctrl+Shift+H. The side panel opens beside the page.
5. Right-click a text selection on any page. The menu shows "Add selection to HipCortex" and "Search
   HipCortex for selection". Right-click a page with no selection and it shows "Add page to
   HipCortex".
6. Open `https://chatgpt.com` and start a conversation. With no runtime the extension reports that
   capture is on but delivery is blocked, and the queue length rises. The captures are held, not
   lost.

To exercise a successful capture end-to-end, a HipCortex runtime is required. It is a local
component and is not something the extension can provide.

## 9. Screenshots

Screenshots are **not** in this repository, and none were fabricated for it. A screenshot depicts
behaviour, and the only honest way to produce one here is with the extension loaded and a runtime
attached — which is a human step with a browser, not something this repository can do.

Capture them while running gate **8.12** in
[`openspec/changes/cortexbridge-perception-layer/`](../openspec/changes/cortexbridge-perception-layer/),
which already requires loading `dist/` unpacked and exercising exactly these surfaces:

| # | Show | Why it is worth a slot |
|---|---|---|
| 1 | The popup with the runtime reachable, quick-add field, and capture status | The whole product in one frame |
| 2 | Search results with the provider filter in use | Cross-provider retrieval is the distinctive feature |
| 3 | The context menu open over a selection on a supported site | Shows capture is a deliberate act, not passive surveillance |
| 4 | The options page, transport mode and base URL | Shows the user controls where captures go |
| 5 | The side panel beside a conversation | The second surface |

Size each to exactly 1280×800. Do not include the browser's own chrome, a macOS menu bar, the
Windows taskbar, or any text stating the store's own category, rank or price. Screenshots are the
first thing a reviewer looks at and the first thing that gets a listing rejected when they do not
match the extension.

## 10. What this document does not establish

- **That the item is listed.** It is not. No upload has happened.
- **That the artwork is a brand asset.** It is placeholder geometry and typography.
- **That the screenshots exist.** §9 is a capture plan, not a directory listing.
- **That a submission would be approved.** These are the inputs; approval is a reviewer's decision.
- **That the declarations in §4–§6 have been made.** They are drafted to be pasted, under the
  publisher account, by the person who owns that account.

## 11. After the first upload — make the extension ID the store's

This is not optional, and it is the only part of the submission that changes a number the repository
already asserts.

**Why the two IDs differ.** An extension loaded from `dist/` is identified either by the `key` in its
manifest or, with no key, by a hash of the folder it was loaded from. The native messaging host has
to name that ID in `allowed_origins` *before* the extension has ever been loaded, so the manifest
pins a `key` and `scripts/install-host.mjs` derives the ID from it. The store is the reverse: it
refuses a package whose manifest carries a `key`, and it derives the item's ID from a public key it
generates and holds. So the store item will **not** be `eklnpdcephecmddelagbablmeajoogkf`.

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
