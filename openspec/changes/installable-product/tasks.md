## 1. The half that was missing (G9.3)

- [x] 1.1 Ship the native messaging host at `host/bridge-host.mjs`: length-prefixed JSON frames on
      stdio in, `POST /memory/add` on the loopback core out, and nothing else. No memory, no
      decisions, no meaning extracted — the shim must not move the E5 boundary *G9.4*
- [x] 1.2 Implement per-user registration in `scripts/install-host.mjs`: host manifest plus the
      platform's registration record, under the user's home directory, with no elevation and no
      system-wide path *G9.3*
- [x] 1.3 Implement the reverse: `npm run uninstall:host` removes the registration record and the
      manifest it wrote *G9.3*
- [x] 1.4 Prove the plan is per-user and reversible, and that it is built for the target platform
      rather than the running one — a Windows plan stays a valid Windows path when produced
      elsewhere. See `tests/host/registration.spec.ts` *G9.3*

## 2. The envelope stops being an assumption (G9.4)

- [x] 2.1 Spawn the real host the way Chrome does and drive a real frame through it against a real
      HTTP core, asserting the reply carries the core's `record_id`. See
      `tests/host/end-to-end.spec.ts` *G9.4*
- [x] 2.2 Prove the framing rule itself: chunk-split frames, a truncated frame, a frame larger than
      one write, and a body that is not an object. See `tests/host/framing.spec.ts` *G9.4*
- [x] 2.3 Add a side-effect-free health request to the envelope: `{"type":"health"}` answers by
      reading `GET /health` and writes nothing. See `tests/host/framing.spec.ts` *G9.4*
- [x] 2.4 Route a probe and a capture down different core paths in one test, so the probe cannot
      silently become a write *G9.4*
- [x] 2.5 Report a stopped core as a typed failure naming the URL, distinct from a host that was never
      installed — never by throwing or hanging *G9.4*
- [x] 2.6 Refuse a non-loopback core URL in the host before any request is made, whatever the caller
      asked for *G9.4*
- [x] 2.7 Record in `docs/PROTOCOL.md` section 9 what was executed and what remains unrun. The
      envelope, the request shape, the response shape and the health probe are verified by execution;
      **Chrome itself resolving a registered host and handing the port to a loaded extension** is the
      one leg no spec can run, and the section must say so rather than implying otherwise *G9.4*

      Done. The section is now titled "Native Messaging — executed, with one leg unrun", its status
      table carries a per-row evidence pointer instead of the word *assumed*, and the closing
      paragraphs separate what was run from what needs a real browser. The same correction was
      applied to the README's known-limitations entry, to the stale header comments in
      `host/bridge-host.mjs` and `scripts/install-host.mjs`, and to the historical 10.8 record in
      `cortexbridge-perception-layer`, which now carries a supersession note. A stale claim that the
      host does not exist is how this gap stayed invisible; leaving the claim in place after closing
      the gap would have re-opened it.

## 3. A failure that names its next action (G9.1, G9.2)

- [x] 3.1 Add `ConnectionState` to the health contract, optional, because a transport with one failure
      mode has nothing to distinguish *G9.1*
- [x] 3.2 Rewrite `NativeTransport.health()` so a healthy verdict requires the host to report its core
      up — an open port alone is no longer health *G9.1*
- [x] 3.3 Rewrite `NativeTransport.resolve()` so each state's detail names the action that ends it *G9.2*
- [x] 3.4 Rewrite the options connection-test line so the not-registered state names
      `npm run install:host`, the registered-but-unreachable state names starting the core, and neither
      names the other's action *G9.2*
- [x] 3.5 Delete the retired sentence "Check that HipCortex is running" from every surface, because it
      was shown to users who had no HipCortex to check *G9.2*
- [x] 3.6 Route the popup badge and the side panel badge through one shared mapping, so the two
      surfaces cannot become two accounts of one state *G9.1*
- [x] 3.7 Prove a transport that reports no connection state keeps the endpoint wording and is not
      given the native advice *G9.1*
- [x] 3.8 Prove the states end to end through the **shipped** transport and the **shipped** options
      page, not against a hand-written report — see `tests/surfaces/connection-states.spec.ts` *G9.1*,
      *G9.2*

## 4. Either order works (G9.5)

- [x] 4.1 Prove host-first and extension-first reach a character-for-character identical healthy state
      *G9.5*
- [x] 4.2 Prove the reported state is a function of the current environment: a host removed after being
      healthy is reported as gone, not remembered as connected *G9.5*
- [x] 4.3 Keep Consumer Mode refusing a non-loopback base URL in both states, so no failure state
      becomes a reason to fall back to a network transport

## 5. Gates and honesty

- [x] 5.1 Update `README.md` known limitations to match reality: the installer exists, the POSIX legs
      are unexecuted, and the Chrome leg is unrun. Also added `npm run install:host` /
      `npm run uninstall:host` to the development block and listed this change in the roadmap, because
      a documented command is the whole difference between "installable" and "installable if you read
      the source"
- [x] 5.2 Re-run `npm run verify` and quote the output; G9 is not met until the full gate is green

      ```
      npm run verify -> typecheck && lint && test && build
      ✓ |jsdom| tests/surfaces/connection-states.spec.ts (15 tests) 1043ms
      ✓ |jsdom| tests/options/connection-test.spec.ts (6 tests) 266ms
      Test Files  41 passed (41)   Tests  655 passed (655)
      [build-content] wrote dist/content.js
      Assets copied to dist/
      exit=0
      ```

      Baseline at the start of this change was 40 files / 630 tests; the change adds 25 tests and one
      spec file, and it touched five shipped modules, so the gate was the only thing that could
      confirm the whole repo still typechecked, linted and built. It did.
- [x] 5.3 Re-run the traceability gate: every criterion this change cites must resolve to a requirement
      heading and every cited test path must exist on disk

      ```
      [traceability] criteria declared : 67 (docs/END-STATE.md)
      [traceability] criteria cited    : 67/67 by 56 requirement headings
      [traceability] test paths cited  : 162 in tasks.md
      [traceability] OK — every criterion is cited and every cited test path exists
      exit=0
      ```

      Up from 62/62: G9.1-G9.5 were declared before they were cited, which is exactly the order that
      makes an uncited criterion visible rather than quietly unowned.
- [ ] 5.4 Do not add a non-loopback host to `host_permissions`, and do not wire the installer into
      `npm run verify`: it writes to the user's home directory, so it is not a gate

      Left unticked on purpose. It is a standing constraint, not a task, and a constraint that gets a
      tick reads as discharged. Both halves hold: `host_permissions` is still loopback-only, and
      `npm run verify` is still exactly typecheck, lint, test, build.

## 6. Executed on a real machine, not planned

The install had never actually been run. The installer existed and was spec-covered **as a plan**,
and that was all: no registry key, no install directory, and no Chrome profile that had ever loaded
the extension. So "installable" was itself only planned, and the gap was one level deeper than the
one this change set out to close.

- [x] 6.1 Pin the extension ID so the host-first install order is possible at all. An unpacked
      extension's ID is derived from its path and cannot be known before the first load, so
      `--extension-id` was unsuppliable offline and the host could never be registered first. Added a
      `key` to `public/manifest.json`, added `deriveExtensionId` and `defaultExtensionId` to the
      installer, and demoted the flag to an override. See `tests/host/registration.spec.ts` *G9.3*,
      *G9.5*
- [x] 6.2 Run the real install and read the result back rather than trusting its exit code: exit 0,
      program plus launcher plus four HKCU keys (chrome, chromium, edge, brave), and `reg query`
      resolving to a host manifest whose `allowed_origins` names the ID the build derives *G9.3*
- [x] 6.3 Spawn the **installed** artefact the way Chrome does and require an answer from it — one
      length-prefixed health frame in, a framed reply out, empty stderr, and the same reply through
      the launcher and through the host file directly. No capture was sent, so the live substrate was
      left untouched. Kept as a re-runnable command rather than a script that ran once:
      `node scripts/probe-installed-host.mjs` *G9.4*
- [x] 6.4 Fix what that run found. An unrecognised request was forwarded to `POST /memory/add`, the
      core answered 422, and the reply read *"core replied with a body that is not JSON"* — safe,
      since nothing was stored, but it blamed the core for a request this repository should never have
      sent. A capture body never carries `type`, so a `type` is always a control message and an
      unrecognised one is a gap here; the host now refuses it locally, before the network. See
      `tests/host/framing.spec.ts` *G9.4*
- [x] 6.5 Re-run the whole gate after the key, the installer and the new host tests landed *G9.3*

      ```
      npm run verify -> typecheck && lint && test && build
      Test Files  41 passed (41)   Tests  660 passed (660)
      [build-content] wrote dist/content.js
      Assets copied to dist/
      exit=0
      ```

      The count moved 655 -> 660 because 6.1 and 6.4 added tests; 5.2's quote is left as the record of
      the run it describes rather than rewritten. The install itself is deliberately not part of this
      gate — it writes to the user's home directory, so it is a command a person runs, not a gate.
- [x] 6.6 Record it where it changes a claim: `docs/END-STATE.md` gained the live-install evidence,
      and open risk 2 was narrowed rather than deleted — what remains unrun is only the step no spec
      can perform, Chrome handing the port to a loaded extension *G9.4*
- [x] 6.7 Execute the reversal rather than infer it from the same script: `npm run uninstall:host`
      exited 0, all four HKCU keys read back absent, the install directory was left with 0 files, and
      a following `npm run install:host` plus repeat probes restored the installed state. An installer
      and its reversal that have only been read are the same kind of claim as a host that has only been
      planned *G9.3*

