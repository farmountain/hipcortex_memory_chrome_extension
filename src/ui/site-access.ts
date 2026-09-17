/**
 * Site access: who may read which page, said once (G1.10).
 *
 * This is a pure mapping from two browser answers to a sentence and a verdict. It lives in `src/ui/`
 * because both the options page and the service worker need the same answer, and because a spec about
 * the copy must not mount a surface to ask for it — importing a controller module from a spec
 * registers its `DOMContentLoaded` listener, which the surface harness cannot then remove, and the
 * next mounted surface answers every message twice.
 *
 * ## Why two browser answers and not one
 *
 * The extension declares its six provider origins in `optional_host_permissions` and lets the user
 * grant them. Whether a given origin is allowed can be asked two ways, and **on an unpacked install
 * the two disagree**:
 *
 * - `chrome.permissions.contains()` answers `false` for all six, while `chrome.permissions.getAll()`
 *   lists all six, because a `--load-extension` install receives the declared origins without the
 *   user ever being asked.
 * - On a packaged install it is the other way round before a grant: `contains()` is `false` and
 *   `getAll()` is empty, which is the state the user is actually in.
 *
 * Either answer alone is therefore wrong in one of the two installs. `contains` alone reports a
 * working unpacked install as entirely blocked — a `!` badge nothing clears and a page saying "nothing
 * is captured" while captures arrive. `getAll` alone reports a packaged install as fully allowed
 * before anything has been allowed, which is the false reassurance this criterion exists to end.
 *
 * The union is right in both, and the cost of being wrong is asymmetric: an origin that cannot be
 * classified counts as **not allowed**, because the failure that matters is telling a user their
 * conversations are being saved when they are not.
 */

/** `https://chat.example.com/*` → `chat.example.com`. Presentation only; never a permission. */
export function originLabel(origin: string): string {
  return origin
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^\*\./, "");
}

/**
 * Which declared origins are actually allowed, from both answers.
 *
 * `contained` is one `chrome.permissions.contains` result per declared origin; `granted` is
 * `chrome.permissions.getAll().origins`. An origin counts as allowed when *either* says so — see the
 * module note for why neither is sufficient. A query that threw is recorded as `false` by the caller,
 * so an unanswerable question is never read as a grant.
 */
export function resolveAllowed(
  origins: readonly string[],
  contained: ReadonlyMap<string, boolean>,
  granted: readonly string[]
): string[] {
  const listed = new Set(granted);
  return origins.filter((origin) => contained.get(origin) === true || listed.has(origin));
}

/**
 * The sentence the options page shows and whether it is good news.
 *
 * `granted` is filtered **against** `origins` rather than counted directly: a permission granted under
 * an earlier version whose host has since left the manifest would otherwise inflate coverage, and the
 * page would report "all six allowed" about four hosts it can actually read.
 *
 * The false branches name the origins that are missing. That is the whole point of the criterion — a
 * user whose extension does nothing needs to know *where* it does nothing, not that a setting is off.
 */
export function describeSiteAccess(
  origins: readonly string[],
  granted: readonly string[]
): [string, boolean] {
  if (origins.length === 0) {
    return ["This build declares no optional site access.", false];
  }

  const listed = new Set(granted);
  const allowed = origins.filter((origin) => listed.has(origin));

  if (allowed.length === origins.length) {
    return [`Active on all ${origins.length} AI chat sites.`, true];
  }

  const names = origins
    .filter((origin) => !listed.has(origin))
    .map(originLabel)
    .join(", ");

  if (allowed.length === 0) {
    return [
      `Off — none of the ${origins.length} AI chat sites is allowed, so nothing is captured there. Not allowed: ${names}.`,
      false,
    ];
  }

  return [
    `Partly active — ${allowed.length} of ${origins.length} allowed. Not allowed: ${names}.`,
    false,
  ];
}

/**
 * The origins the shipped manifest declares, as a plain list of strings.
 *
 * Read from `chrome.runtime.getManifest()` rather than written out again, so a page cannot promise
 * access to a host the manifest never asked for, and removing a host from the manifest removes it
 * from the sentence too. A manifest whose field is missing or malformed yields `[]`, which every
 * caller reports as "no optional site access" rather than as coverage.
 */
export function declaredOrigins(): string[] {
  const manifest = chrome.runtime.getManifest() as { optional_host_permissions?: unknown };
  const declared = manifest.optional_host_permissions;
  if (!Array.isArray(declared)) return [];
  return declared.filter((origin): origin is string => typeof origin === "string");
}

/**
 * Ask both permission questions about the declared origins and answer with the ones that are allowed.
 *
 * This is the only place the two queries are made, so the service worker's verdict and the options
 * page's sentence cannot drift apart — a page that says "allowed" while the worker refuses to read the
 * page is the exact failure G1.10 exists to end. Each query is individually guarded: an exception is
 * recorded as `false`, because a question that could not be answered must never be read as a grant.
 */
export async function queryAllowedOrigins(origins: readonly string[]): Promise<string[]> {
  const contained = new Map<string, boolean>();
  for (const origin of origins) {
    try {
      contained.set(origin, await chrome.permissions.contains({ origins: [origin] }));
    } catch {
      contained.set(origin, false);
    }
  }

  let granted: string[] = [];
  try {
    granted = [...((await chrome.permissions.getAll()).origins ?? [])];
  } catch {
    granted = [];
  }

  return resolveAllowed(origins, contained, granted);
}

/** The declared origins that are not allowed yet — what a first-run page has to act on (G1.11). */
export async function ungrantedOrigins(): Promise<string[]> {
  const declared = declaredOrigins();
  const allowed = new Set(await queryAllowedOrigins(declared));
  return declared.filter((origin) => !allowed.has(origin));
}

