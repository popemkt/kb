/**
 * Where a followed date leads (DESIGN.md → Provider roles): the page role
 * `ui.date-target`, whose provider answers the node a date value opens,
 * made if need be, or null when a date leads nowhere. Core owns the role,
 * and its default, {@link leadsNowhere}, answers null; a family that
 * replaces it (days, with the date's day) is elected over it as any
 * replacement is.
 */
import { DATE_TARGET_ROLE } from "@kb/contracts";
import { Role, Service } from "@kb/plugin";
import { callPageRole } from "./plugins.ts";

/** The node `date` (`YYYY-MM-DD`) opens, or null when it leads nowhere. */
export type DateTarget = (date: string) => Promise<string | null>;

export const DateTargetService = Service<DateTarget>()(
  DATE_TARGET_ROLE.role,
  DATE_TARGET_ROLE.spec,
);

const DateTargetRole = Role(DateTargetService);

/** Core's answer, the role's default: a date leads nowhere. */
export const leadsNowhere: DateTarget = () => Promise.resolve(null);

/** How long the elected provider may take before the next candidate answers. */
const DATE_TARGET_BUDGET_MS = 5_000;

/**
 * The node `date` leads to now, or null. Rejects when no candidate
 * answered, which only a missing or failing default can cause.
 */
export function dateTarget(date: string): Promise<string | null> {
  return callPageRole(DateTargetRole, (target) => target(date), DATE_TARGET_BUDGET_MS);
}
