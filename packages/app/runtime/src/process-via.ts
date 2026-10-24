import { viaOn } from "@kb/contracts";

/**
 * The `via` this process was started for (DESIGN.md → Action registry → The
 * caller's via), as the part of a wire it makes: a process that serves one
 * caller (the CLI, `kb mcp`) spreads it into its wire, so every call it makes
 * that names none is labelled with it.
 */
// oxlint-disable-next-line node/no-process-env -- kb's one read of the via a process was started for
export const processVia: { readonly via?: string } = viaOn(process.env);
