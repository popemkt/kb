/**
 * Who made a call (DESIGN.md → Action registry): the author every
 * invocation names and every transaction it commits records (`KbTx.actor`),
 * so the vocabulary is core's. Core grants no actor anything by its name;
 * what a policy would decide about one is the governance family's
 * (`@kb/governance`).
 */

/**
 * Who made a call, as the surface it arrived on says (`onWire`). `human` is
 * a person's own gesture in the UI, `agent` is a model acting for one (the
 * sidebar agent, MCP, WebMCP) or a local program, `cli` is the command line,
 * which a person and an agent both use, and `script` is code running in the
 * sandbox (a code view), whoever wrote it: its calls are held to its run's
 * grant (DESIGN.md → Sandbox).
 */
export const ACTORS = ["human", "agent", "cli", "script"] as const;
export type Actor = (typeof ACTORS)[number];
