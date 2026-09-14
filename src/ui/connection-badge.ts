/**
 * The one place a connection state becomes words and a colour.
 *
 * Both the popup and the side panel render a connection badge, and both used to answer every
 * failure with "offline". That is the same defect the options page had: a user with nothing
 * installed and a user whose core is merely stopped were shown one word, so the badge could not say
 * which of the two they were looking at. Sharing the mapping is what stops the two surfaces from
 * becoming two different accounts of one state (G9.1).
 *
 * The badge stays short on purpose — it is a glanceable indicator, and the options page is where the
 * full sentence with the next action lives (G9.2).
 */

import type { HealthReport } from "../types/index.js";

export interface BadgeState {
  readonly text: string;
  readonly className: string;
}

/**
 * Map a report to badge text.
 *
 * `undefined` means no report arrived at all, which is its own state: the worker did not answer, so
 * nothing can be said about the host or the core. Reporting that as "core offline" would be a
 * guess dressed as an observation.
 */
export function badgeFor(report: HealthReport | undefined): BadgeState {
  const health = report?.health;

  if (!health) return { text: "unknown", className: "badge unknown" };
  if (health.healthy) return { text: "online", className: "badge healthy" };
  if (health.connection === "host-not-registered") {
    return { text: "host not installed", className: "badge unhealthy" };
  }
  return { text: "core offline", className: "badge unhealthy" };
}
