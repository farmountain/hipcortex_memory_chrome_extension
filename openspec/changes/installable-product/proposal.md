## Why

`cortexbridge-perception-layer` builds the **browser half** of the loopback path and verifies it
exhaustively: capture, normalization, the acknowledgement rule, the provider ladders, the gates. Read
as a set, G1–G8 describe what the extension does *once a working state exists* — and none of them
creates one. "Installed" was never defined.

That gap is not cosmetic. A person following the earlier specification ended up with a correctly
built component that stores nothing, and when it failed it told them **"Check that HipCortex is
running"** — to someone who had never had HipCortex. Two different situations (nothing installed at
all; installed but stopped) produced one sentence and it was wrong for one of them. That is the
defining symptom of a component rather than a product, and `docs/END-STATE.md` records the goal that
owns it as G9.

## What Changes

- **State the impossibility, then build the thing that is possible.** Chrome cannot install
  software: `public/manifest.json` declares neither `downloads` nor `management`,
  `chrome.runtime.connectNative` connects to an *already registered* host and cannot register one,
  and policy forbids silent external installation. The half that is missing is therefore the
  **native messaging host**, and it is this repository's to build — its registered name is
  `com.hipcortex.bridge`, which is *CortexBridge*, the layer `AGENTS.md` names as this repo's.
- **Ship the host as a transport shim.** `host/bridge-host.mjs` translates Chrome's length-prefixed
  JSON over stdio into `POST /memory/add` on the loopback core. It holds no memory, makes no
  decisions and extracts no meaning, so it does not move the E5 boundary.
- **Register it with one unelevated command.** `npm run install:host` writes a per-user host manifest
  and the platform's registration record; `npm run uninstall:host` reverses it. Nothing is written to
  a system-wide location and no administrator prompt is required.
- **Make reachability a probe, not a handshake.** The host answers a side-effect-free
  `{ "type": "health" }` with a `GET /health` result, and the extension reports three states
  distinctly. A port that opens proves the host is registered; it does not prove the core is up.
- **Give each state its own next action.** The not-registered state names the command that completes
  the install; the registered-but-unreachable state names starting the core. This is the specific
  sentence that used to be actively misleading.
- **Keep the contract executed, not assumed.** `docs/PROTOCOL.md` §9 has said since it was written
  that the envelope and the host name were "assumed, not verified, because no host installer exists
  yet". After this change that statement is false and is replaced by what was actually run.

## Impact

- New capability specification: `native-host-install`.
- New code: `host/bridge-host.mjs` (the host), `scripts/install-host.mjs` (the installer),
  `src/ui/connection-badge.ts` (the shared state mapping read by the popup and the side panel).
- Changed code: `src/api/transport/native.ts` (`health()` and `resolve()` now distinguish three
  states), `src/options.ts` (the connection-test line), `src/popup.ts` and `src/sidepanel.ts` (badges
  stop collapsing every failure into "offline"), `src/types/index.ts` (the optional
  `ConnectionState`).
- Changed documents: `docs/PROTOCOL.md` §9, `README.md` known limitations.
- **No delivery-path behaviour changes.** `addMemory` is untouched, and the acknowledgement rule
  (a bare 2xx is not delivery) is unchanged. Consumer Mode still does not fall back to HTTP.

## Non-goals

- Vendoring core code, or bundling/fetching a core binary inside the extension package. It would put
  cognition in this repo and require `downloads`/`management`; the reasons are recorded in
  `docs/END-STATE.md` G9.
- System-wide registration (`HKLM`, `/etc`, `/usr/local`). It requires elevation, and a product that
  needs an administrator prompt to record a memory is one most people will not install.
- Declaring the install complete because the host registered. Registration and reachability are
  different facts, and reporting the first as the second is the same dead end in a new costume —
  which is why G9.4 asserts execution rather than a manifest on disk.
- Amending E10 or G7.2/G7.3 to allow a hosted core. That is a decision for the user, and the
  falsification condition in `docs/END-STATE.md` G9 names the allow-list flow it would require.
