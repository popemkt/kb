/**
 * Who makes a call (DESIGN.md → Action registry): every invocation names its
 * actor, whatever governs it, so the vocabulary is core's. What a policy
 * decides about an actor is the governance family's (`@kb/governance`).
 */

/**
 * Who makes a call, as the caller declares it — like `approved`, a statement
 * and not a proof. `human` is a person's own gesture in the UI, `agent` is a
 * model acting for one (the sidebar agent, MCP, WebMCP), `cli` is the
 * command line, which a person and an agent both use, and `script` is code
 * running in the sandbox (a code view), whoever wrote it — never a person,
 * so it never answers a call that asks (DESIGN.md → Sandbox).
 */
export const ACTORS = ["human", "agent", "cli", "script"] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * The actors that act as the store's owner: a person's gesture, and the
 * command line, which runs with the owner's own shell, so whoever runs it
 * already holds what the owner holds. An agent and sandboxed code act for
 * the owner and never hold the owner's capabilities: they may not set
 * `force`, and governance decides what else they may do for the owner.
 */
export type OwnerActor = "human" | "cli";
const OWNER_ACTORS: ReadonlySet<Actor> = new Set<OwnerActor>(["human", "cli"]);

/** Whether a call by `actor` acts as the owner: it is the person, or their own command line. */
export function actsAsOwner(actor: Actor): actor is OwnerActor {
  return OWNER_ACTORS.has(actor);
}
