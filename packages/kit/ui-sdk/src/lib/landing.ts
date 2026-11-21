/**
 * Where a page that loads at the root opens (DESIGN.md → Provider roles;
 * DESIGN-UI.md → Days): the page role `ui.landing`, whose provider answers
 * the node to open, or null to stay home. Core owns it and stays home
 * ({@link stayHome}); a family that replaces it (days, with today) is
 * elected over it, and an extension's page half joins the election through
 * {@link provideLanding}. The shell asks once per page load ({@link landOnce}),
 * before it first draws the workspace, waiting at most its budget, so a
 * page that opens elsewhere never shows the root on the way; a family
 * switched on later, or a plugin reloaded, never moves the page.
 */
import { LANDING_ROLE } from "@kb/contracts";
import { Role, Service, type PluginContext } from "@kb/plugin";
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
 * Answer where a page that loads at the root opens, as a candidate for the
 * `ui.landing` role. A family's page half calls it in its `apply`; the one
 * elected among the candidates (its manifest's `replaces` claim and
 * priority, DESIGN.md → Provider roles) is the one the shell asks.
 */
export function provideLanding(ctx: PluginContext, landing: Landing) {
  return ctx.provide(LandingService, landing);
}

/**
 * How long the page waits for where it opens, all told: long enough for
 * days to make today's node and for the live connection to bring it, and
 * short enough that a landing which never answers (a connection that never
 * delivers) cannot hold the workspace. It is one deadline over the whole
 * election, not a budget per candidate: the role runner retries the next
 * candidate after a fault, and a fresh budget each would let two stalled
 * candidates hold the first paint twice as long.
 */
const LANDING_BUDGET_MS = 4000;

/** Whether the page stands at the root with nothing in its URL. */
function atRoot(): boolean {
  return getPath() === "/" && (typeof window === "undefined" || window.location.search === "");
}

/**
 * Ask the landing role where this page opens, and go there, if the page is
 * at the root with nothing in its URL now and has not moved by the time the
 * answer comes. It settles at the answer, at the deadline
 * ({@link LANDING_BUDGET_MS} from when it is asked), or as soon as the page
 * moves: a person who leaves while it is asked stays where they went, and a
 * shell that waits on it to draw stops waiting. The move replaces the
 * root's history entry, so Back leaves the page rather than returning to a
 * root that would land again. A provider that fails, or has not answered by
 * the deadline, fails its call: the role faults it (for this role only, so
 * its family's other roles stand), the page stays home, and the person is
 * told why, since they expected to land elsewhere.
 */
export async function land(): Promise<void> {
  if (!atRoot()) return;
  const moved = Promise.withResolvers<"moved">();
  const stop = subscribePath(() => moved.resolve("moved"));
  const late = Promise.withResolvers<never>();
  // Raced, never awaited alone: no candidate may leave it unheard.
  late.promise.catch(() => undefined);
  const deadline = setTimeout(
    () => late.reject(new Error("the landing did not answer in time")),
    LANDING_BUDGET_MS,
  );
  try {
    const failures: unknown[] = [];
    // Every candidate the election asks races the one deadline.
    const ask = (landing: Landing) =>
      Promise.race([landing(), late.promise]).catch((cause: unknown) => {
        failures.push(cause);
        throw cause;
      });
    const answer = callPageRole(LandingRole, ask, NO_CANDIDATE_BUDGET).catch(() => null);
    const id = await Promise.race([answer, moved.promise]);
    if (id === "moved" || !atRoot()) return;
    if (id !== null) replacePath(nodePath(id));
    else if (failures.length > 0) toast(`Stayed home: ${failureText(failures[0])}`);
  } finally {
    clearTimeout(deadline);
    stop();
  }
}

/** The role runner's budget per candidate: none, since the one deadline bounds them all. */
const NO_CANDIDATE_BUDGET = Number.POSITIVE_INFINITY;

function failureText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** This page load's asking where it opens, once asked. */
let asked: Promise<void> | null = null;

/**
 * {@link land}, once per page load: the shell calls it when the page first
 * holds its graph and its families' plugins, and draws the workspace once
 * it settles. Every later call shares that first asking, settling with it,
 * so a second caller (a load retried, a render run twice) never draws
 * early, and never asks again.
 */
export function landOnce(): Promise<void> {
  asked ??= land();
  return asked;
}
