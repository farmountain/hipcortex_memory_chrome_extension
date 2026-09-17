# Privacy policy — HipCortex Memory

**Last updated: 2026-09-17.**

This policy covers the **HipCortex Memory** browser extension, whether it was installed from the
Chrome Web Store or loaded from source. It does not cover the HipCortex runtime, which is a separate
program the user installs and runs on their own computer.

The short version: **the extension sends your conversations to your own computer and to nothing
else, and the developer of this extension receives no data of any kind.**

## What the extension accesses

- **The text of AI conversations** on the sites it supports: ChatGPT, Claude, Gemini, Grok and
  DeepSeek, and only there. It reads the conversation when you are on one of those pages and have
  allowed the extension to read that site — see **You control which sites it can read** below.
- **The address and title of the page a capture comes from**, recorded with the capture so that a
  memory can be traced back to its source. For a conversation that is the conversation's own URL;
  it is also what is recorded when you explicitly choose "Add page to HipCortex" from the
  right-click menu.
- **The text you have selected**, and only when you explicitly choose "Add selection to HipCortex"
  or run the quick-add shortcut.
- **The runtime address and options you enter**, stored as extension settings. If you enter an API
  key for your runtime, that key is part of those settings.

It does not read pages outside those five sites. It does not read your browser's history, your
bookmarks, your downloads, your other extensions, your passwords, or your files. The only record it
keeps of a page you visited is the address of a page you captured, and the Chrome Web Store listing
declares that under "web history" rather than leaving it out.

## You control which sites it can read

**A newly installed extension reads nothing at all, on any site, until you allow it.** Chrome does
not let the extension read the supported sites on its own: the extension declares those addresses,
and Chrome grants them only when you approve them. The extension asks for exactly those sites, and
for nothing else, in one click from its own settings page; before you make that grant it is
installed and idle there.

That permission is yours to withdraw. Removing it from the Chrome extensions page takes effect
immediately — the extension stops reading those sites — and the popup shows a warning badge whenever
any of the supported sites is not allowed, so the state is visible rather than something you have to
remember.

The extension also has a passive-capture setting that decides whether it watches those sites as you
browse. It is on when you install, and the popup carries the switch that turns it off. With it off,
nothing is read as you browse; a capture you ask for yourself still works.

## Where that data goes

To a **HipCortex runtime running on the same computer as the browser**, and nowhere else. The
extension declares no remote destination at all. Its only declared network endpoints are
`127.0.0.1` and `localhost`. Delivery happens over one of two transports, both local:

- **Native messaging** to the HipCortex Desktop application, or
- **HTTP** to a HipCortex server you started yourself on `http://127.0.0.1:3030`.

If you configure a runtime address that is not on your own machine, the extension asks you to
confirm it first, naming the exact host and stating plainly that every captured conversation will be
sent there. A banner stays on screen for as long as such an address is in effect. If you decline,
the address is not saved.

## What the developer receives

**Nothing.** The developer of this extension operates no server, receives no copy of any captured
data, and has no way to access it. There is no account, no sign-in, no developer-operated storage,
no analytics, no telemetry, no crash reporting, no advertising identifier and no remotely fetched
configuration. The extension contains no code fetched at runtime.

## Storage and deletion

Captured conversations that have not yet been delivered sit in the extension's own local storage
until the runtime acknowledges them, together with a local search index. Conversation content is
never written to browser-synced storage, so it is never copied to another machine by the browser.

Settings are stored separately, and those are synced: the runtime address, transport mode and limits
you configure follow you to another browser you are signed in to. If you enter an API key it is part
of those settings and is stored there as well. The extension sends that key nowhere except to the
runtime address you set.

- To remove everything the extension stores, **uninstall the extension**. Nothing is retained.
- The local search index can be cleared from the popup without uninstalling.
- Undelivered captures can be exported to a file, or left to be discarded with the extension.
- Data already delivered to your HipCortex runtime is governed by that runtime, on your machine. The
  extension keeps no copy of acknowledged captures.

## Third parties

None. No data is sold, rented, shared or transferred to any third party, because no data reaches the
developer in the first place. The extension's use of data is limited to its single stated purpose:
capturing your conversations and delivering them to your own runtime.

## Children

The extension is not directed at children and collects no data from anyone.

## Changes

Any change to this policy will be published in this file in the extension's public repository, with
the date above updated. Because the extension has no way to send data to the developer, a change to
this policy cannot affect data already on your machine.

## Contact

Issues and questions: <https://github.com/farmountain/hipcortex_memory_chrome_extension/issues>
