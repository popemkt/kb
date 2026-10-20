/**
 * What the deployment, not the graph, decides about this process's
 * composition (DESIGN.md → Core boundary & extensions → governance): set
 * once by the composition root that starts the process (the CLI's
 * `--governance`), before any registry is composed, and never by a write.
 */

/**
 * Whether calls are governed: `required`, the governance family is
 * composed and every call is denied while its guards are not there; `off`,
 * it is left out, and with no guard every call proceeds.
 */
export type GovernanceMode = "required" | "off";

/** The governance family's name: the one family a deployment can leave out. */
export const GOVERNANCE_FAMILY = "governance";

let governance: GovernanceMode = "required";

/** Set how this process is governed; registries composed from now on follow it. */
export function deployGovernance(mode: GovernanceMode): void {
  governance = mode;
}

/** How this process is governed. */
export function governanceMode(): GovernanceMode {
  return governance;
}

/**
 * Whether this deployment composes the family `name`: every family, less
 * governance where governance is off. One answer for everything a
 * composition is made of, its plugins and its seed alike, so a store
 * opened without governance is seeded without its nodes.
 */
export function deploys(name: string): boolean {
  return governance === "required" || name !== GOVERNANCE_FAMILY;
}
