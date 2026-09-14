---
description: 'Use when editing Chrome Manifest V3 code in this repo: service worker, message router, popup, side panel, options page, manifest.json permissions, chrome.storage, context menus, commands, or side panel APIs.'
applyTo: ["src/**/*.ts", "public/manifest.json"]
---

# Manifest V3 mechanics (this repo)

This is an **unbundled** MV3 extension: `tsc` compiles `src/` to `dist/`, `scripts/copy-assets.js`
copies `public/*` and generates icons. There is no webpack/vite step.

## Layering — do not bypass it

- UI surfaces (`popup.ts`, `sidepanel.ts`, `options.ts`) must go through
  `chrome.runtime.sendMessage` and the `send()` helper. No direct `fetch`.
- `src/background.ts` is the only message router. Add new behavior as a `MessageType`
  union member in `src/types/index.ts` **plus** a `case` in the router's `switch`.
- The router listener must keep `return true` for async responses.

```ts
// correct: extend the contract, then the router
// src/types/index.ts
| { type: "CAPTURE_CONVERSATION"; url: string; title?: string };
// src/background.ts  -> case "CAPTURE_CONVERSATION": { ... break; }
```

## MV3 constraints that bite

- **Worker lifetime** — the service worker has no DOM and is terminated when idle. Never keep
  state in a module-level variable that must survive across events; persist to
  `chrome.storage.local` / `chrome.storage.session`.
- **No remote code** — `eval`, `new Function`, remote `<script src>`, and remotely hosted WASM
  are prohibited by store policy and by this project.
- **No `<all_urls>`** — add narrow hosts. `host_permissions` currently lists localhost
  endpoints only, and `optional_host_permissions` lists the six provider origins that `G1.9`
  requires to be declared. Nothing requests those optional hosts at runtime: `chrome.permissions.request`
  has no call site in this repository, and capture into those sites is granted by
  `content_scripts.matches`, which is what the install-time warning names.
  Permissions are least-privilege and changes here are reviewed as a security change.
- **Content scripts are declared, not injected** — `content_scripts` has one entry carrying the six
  provider origins, and its bundle is the single `dist/content.js` built by
  `scripts/build-content.js`. Changing it means updating `public/manifest.json` *and* keeping that
  one entry point; a second bundled entry is out of scope.
- **`chrome.sidePanel.open()` requires a user gesture** — call it from a click/command
  handler, not from a background timer.
- **`chrome.storage.sync` has small quotas** — bulk/captured data belongs in
  `chrome.storage.local`, never in sync.
- **`chrome.error` is silently swallowed** — `chrome.runtime.lastError` must be read in every
  callback-based API (`connectNative`, `sendNativeMessage`, `tabs.query`).

## Before you claim it works

Run `npm run build` and confirm the change is present in `dist/` before loading unpacked.
Adding an HTML/CSS file without updating the copy list in `scripts/copy-assets.js` produces a
build that "succeeds" and an extension that is broken at runtime.
