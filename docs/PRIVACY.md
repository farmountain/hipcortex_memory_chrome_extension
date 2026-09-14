# Privacy policy — HipCortex Memory

**Last updated: 2026-09-14.**

This policy covers the **HipCortex Memory** browser extension, whether it was installed from the
Chrome Web Store or loaded from source. It does not cover the HipCortex runtime, which is a separate
program the user installs and runs on their own computer.

The short version: **the extension sends your conversations to your own computer and to nothing
else, and the developer of this extension receives no data of any kind.**

## What the extension accesses

- **The text of AI conversations** on the sites it supports: ChatGPT, Claude, Gemini, Grok and
  DeepSeek, and only there. It reads the conversation when you are on one of those pages.
- **The title and URL of a page**, and only when you explicitly choose "Add page to HipCortex" from
  the right-click menu.
- **The text you have selected**, and only when you explicitly choose "Add selection to HipCortex"
  or run the quick-add shortcut.
- **The runtime address and options you enter**, stored as extension settings.

It does not read pages outside those five sites. It does not read your browsing history, your
bookmarks, your downloads, your other extensions, your passwords, or your files.

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
data, and has no way to access it. There is no account, no sign-in, no sync, no analytics, no
telemetry, no crash reporting, no advertising identifier and no remotely fetched configuration. The
extension contains no code fetched at runtime.

## Storage and deletion

Captured conversations that have not yet been delivered sit in the extension's own local storage
until the runtime acknowledges them, together with a local search index. Settings are stored
separately. Conversation content is never written to browser-synced storage, so it is never copied
to another machine by the browser.

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
