/**
 * `view.propose` — generative UI mode A (DESIGN.md → Kinds, roles and
 * options → View nodes): a caller, usually a model, names a view from
 * `kb.manifest`'s view catalog and settings for it, and kb writes the view
 * node, or says precisely why it cannot. The check is `@kb/views`'
 * `viewNodeFor`, the one check of a proposed view; this action only finds
 * the view and the host and writes what the check returns.
 */
import { Effect } from "effect";
import { z } from "zod";
import { KbCtx, ViewCatalog, type ActionDefinition, type KbStore } from "@kb/contracts";
import { domainError, type DomainError, type KbNode } from "@kb/model";
import { planViewProposal } from "@kb/views";
import { sessionGraph } from "./actions.ts";
import { persistEffect } from "./session.ts";

export const viewProposeDef = {
  id: "view.propose",
  title: "Propose view",
  description:
    "Write a view node: a view from kb.manifest's view catalog (`view`, its id or option), its settings (`params`, checked against that view's settings schema: every setting legal, none it does not declare, and each one a view node can hold), and optionally the node it is shown for (`host`), whose views then name it, first when `default`. Files it in the Views list. On any issue it writes nothing and fails with every issue at its path.",
  mode: { kind: "write" } as const,
  inputSchema: z.object({
    view: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
    host: z.string().min(1).optional(),
    /** The view node's text: its name (a docs view goes by it). */
    text: z.string().default(""),
    /** Make it the host's default view: first in its `sys.f.views`. */
    default: z.boolean().default(false),
    id: z.string().min(1).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    view: z.string(),
    host: z.string().optional(),
    params: z.unknown(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

type ViewProposeInput = z.infer<typeof viewProposeDef.inputSchema>;

export const viewProposeEffect = Effect.fn("view.propose")(function* (
  input: ViewProposeInput,
): Effect.fn.Return<
  { id: string; view: string; host?: string; params: unknown; node: KbNode },
  DomainError,
  KbCtx | KbStore | ViewCatalog
> {
  const ctx = yield* KbCtx;
  const catalog = yield* ViewCatalog;
  const key = catalog.keyOf(input.view);
  if (key === null)
    return yield* domainError("invalid_input", `unknown view: ${input.view}`, {
      view: input.view,
      views: catalog.items.map((known) => known.key.id),
    });
  const planned = yield* planViewProposal(
    (id) => ctx.index.getNode(id),
    sessionGraph(ctx),
    key,
    input,
  );
  yield* persistEffect(ctx, { upserts: [...planned.upserts], deletes: [] });
  return {
    id: planned.node.id,
    view: key.id,
    ...(planned.host === null ? {} : { host: planned.host.id }),
    params: planned.params,
    node: planned.node,
  };
});
