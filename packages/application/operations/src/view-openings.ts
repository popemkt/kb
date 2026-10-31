/**
 * `view.openings` — the ways a node can be opened (DESIGN.md → Kinds, roles
 * and options → View nodes): what the UI's "Open with…" and pane switcher
 * offer, as an agent or the CLI reads it. The list is `@kb/views`'
 * `nodeOpenings` over this host's view catalog, the one statement of it;
 * this action only finds the node and names each opening's location.
 */
import { Effect } from "effect";
import { z } from "zod";
import { KbCtx, ViewCatalog, type ActionDefinition } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { nodeOpenings, nodePath } from "@kb/views";
import { requireNode, syncDomain } from "./actions.ts";

const OpeningSchema = z.object({
  /** What `/node/<id>/<view>` names: a view node's id, or a view type's option; absent, the default. */
  view: z.string().optional(),
  label: z.string(),
  /** The view type's id, for an opening through a view type. */
  viewType: z.string().optional(),
  /** The tag whose default view type this is. */
  tag: z.string().optional(),
  /** What the node opens in by default. */
  default: z.boolean().optional(),
  /** Where it opens: the location `ui.navigate` takes. */
  path: z.string(),
});

export const viewOpeningsDef = {
  id: "view.openings",
  title: "View openings",
  description:
    "Every way a node can be opened, in order: its default, each view node it names, then each view type a node is shown in, its tags' default view types first (`tag`). The one it opens in by default is marked `default`. Each carries the `path` to pass `ui.navigate`. A tag's default is its `sys.f.view.default`, set like any field on the tag node.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ node: z.string().min(1) }),
  outputSchema: z.object({ node: z.string(), openings: z.array(OpeningSchema) }),
} satisfies ActionDefinition;

type Opening = z.infer<typeof OpeningSchema>;

export const viewOpeningsEffect = Effect.fn("view.openings")(function* (
  input: z.infer<typeof viewOpeningsDef.inputSchema>,
): Effect.fn.Return<{ node: string; openings: Opening[] }, DomainError, KbCtx | ViewCatalog> {
  const ctx = yield* KbCtx;
  const catalog = yield* ViewCatalog;
  yield* syncDomain(() => requireNode(ctx, input.node));
  const openings = nodeOpenings(input.node, catalog, (id) => ctx.index.getNode(id)).map(
    ({ view, label, key, tag, default: isDefault }): Opening => ({
      ...(view === undefined ? {} : { view }),
      label,
      ...(key === undefined ? {} : { viewType: key.id }),
      ...(tag === undefined ? {} : { tag }),
      ...(isDefault === true ? { default: true } : {}),
      path: nodePath(input.node, view),
    }),
  );
  return { node: input.node, openings };
});
