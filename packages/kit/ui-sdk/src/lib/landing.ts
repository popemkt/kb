/**
 * Where a page that loads at the root opens (DESIGN.md → Provider roles;
 * DESIGN-UI.md → Days): the page role `ui.landing`, whose provider answers
 * the node to open, or null to stay home. Core owns it and stays home
 * ({@link stayHome}); a family that replaces it (days, with today) is
 * elected over it. The shell asks once per page load ({@link landOnce}),
 * so a family switched on later, or a plugin reloaded, never moves the page.
 */
import { LANDING_ROLE } from "@kb/contracts";
import { Role, Service } from "@kb/plugin";
import { nodePath } from "@kb/views";
import { callPageRole } from "./plugins.ts";
import { getPath, replacePath, subscribePath } from "./router";
import { toast } from "./toast";

/** The node a page that loads at the root opens on, or null to stay home. */
export type Landing = () => Promise<string | null>;

export const LandingService = Service<Landing>()(LANDING_ROLE.role, LANDING_ROLE.spec);

const LandingRole = Role(LandingService);

/** Core's answer, the role's default: the page stays home. */
export const stayHome: Landing = () => Promise.resolve(null);

/**
 * No budget: a landing waits for what it needs to be ready (days, for
 * today's node to reach the page), however long a slow machine takes, and
 * ends with an answer or a failure, never with a clock.
 */
const NO_BUDGET = Number.POSITIVE_INFINITY;

/** Whether the page stands at the root with nothing in its URL. */
function atRoot(): boolean {
  return getPath() === "/" && (typeof window === "undefined" || window.location.search === "");
}

/**
 * Ask the landing role where this page opens, and go there, if the page is
 * at the root with nothing in its URL now and has not moved by the time the
 * answer comes: a person who leaves while it is asked stays where they went.
 * The move replaces the root's history entry, so Back leaves the page rather
 * than returning to a root that would land again. A provider that fails is
 * demoted and the page stays home, and the person is told why, since they
 * expected to land elsewhere.
 */
export async function land(): Promise<void> {
  if (!atRoot()) return;
  const route = { moved: false };
  const stop = subscribePath(() => {
    route.moved = true;
  });
  try {
    const failures: unknown[] = [];
    const ask = (landing: Landing) =>
      landing().catch((cause: unknown) => {
        failures.push(cause);
        throw cause;
      });
    const id = await callPageRole(LandingRole, ask, NO_BUDGET).catch(() => null);
    if (route.moved || !atRoot()) return;
    if (id !== null) replacePath(nodePath(id));
    else if (failures.length > 0) toast(`Stayed home: ${failureText(failures[0])}`);
  } finally {
    stop();
  }
}

function failureText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Whether this page load has asked where it opens. */
let asked = false;

/**
 * {@link land}, once per page load: the shell calls it when the page first
 * holds its graph and its families' plugins, and every later call is a no-op.
 */
export function landOnce(): Promise<void> {
  if (asked) return Promise.resolve();
  asked = true;
  return land();
}
