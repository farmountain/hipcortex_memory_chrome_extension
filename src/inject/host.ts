/**
 * The content-script host for placement — the page's end of the write path (G4.5).
 *
 * It is reached through the *existing* content-script entry (`src/content/entry.ts`), not through a
 * second bundle. A second entry would mean a second `content_scripts` declaration and a second
 * chance for the two to be granted different hosts; `tests/quality/content-bundle.spec.ts` asserts
 * exactly one bundle exists, so the choice is enforced rather than merely intended.
 *
 * The listener is deliberately synchronous in its answer: the write happens inside the message
 * handler and the report goes back in the same turn. There is no retry loop and no timer, because a
 * placement that did not take on the first try will not take on the second — the page would have to
 * change, and the next attempt is the user's next click.
 *
 * What this file must never do is decide *whether* to place. The flag is the worker's to read (the
 * content bundle has no extension-storage access at all, by scanning rule), and the worker refuses
 * before it sends. A request that arrives here is therefore a request the user's setting already
 * allowed.
 */

import { placeContext } from "./place.js";
import { isPlaceContextRequest } from "./protocol.js";
import type { PlaceContextReply } from "./protocol.js";

export interface PlacementHostDeps {
  /** Defaults to the page's own URL. Injectable so a spec can place into a fixture as a provider. */
  readonly url?: () => string;
  readonly doc?: () => Document;
}

/**
 * Install the placement listener and return it, so the caller can tell whether one was installed.
 *
 * Idempotence is the caller's business, not this function's: `src/content/entry.ts` starts the
 * capture session once, from the same gate, so the listener is added once per page.
 */
export function registerContextPlacement(deps: PlacementHostDeps = {}): void {
  const url = deps.url ?? (() => location.href);
  const doc = deps.doc ?? (() => document);

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isPlaceContextRequest(message)) return false;

    const report = placeContext({
      document: doc(),
      url: url(),
      /**
       * `true` is not a default that can drift: this value is only ever consulted after the worker
       * has already read `injectIntoAiChats` and either refused or sent. The off state is proven
       * where it is decided — the worker's refusal and the option page's own diff — not here.
       */
      enabled: true,
      text: message.text,
      sourceProvider: message.sourceProvider,
    });

    const reply: PlaceContextReply = { ok: report.placed, report };
    sendResponse(reply);
    return true;
  });
}
