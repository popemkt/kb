import { Effect } from "effect";
import { z } from "zod";
import { type ActionDefinition, KbCtx } from "@kb/contracts";
import { syncDomain, type DomainError, type KbNode, type NodeId } from "@kb/model";
import { EXPORT_DEFAULTS, OUTLINE_FORMAT_IDS, exportOutline } from "@kb/outline-paste";
import { requireNode } from "./require-node.ts";

export const nodeExportDef = {
  id: "node.export",
  title: "Export nodes",
  description:
    "Write nodes, and what is under them, as text in an outline format (DESIGN.md → Outline " +
    "formats): md (Markdown, the default), plain (indented text), html (rich text, a nested " +
    "list), tana (Tana Paste), logseq or json. A collapsed node's children are written; a node " +
    "under another id given goes with it. refs says how a reference is written: label (its " +
    "words, the default), link ([[words]]) or id (its token as stored, everything by id, which " +
    "node.addTree reads back to the same nodes). Writing the text to a file is the caller's.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    ids: z.array(z.string()).min(1),
    format: z.enum(OUTLINE_FORMAT_IDS).default(EXPORT_DEFAULTS.format),
    children: z.boolean().default(EXPORT_DEFAULTS.children),
    fieldsAndTags: z.boolean().default(EXPORT_DEFAULTS.fieldsAndTags),
    refs: z.enum(["label", "link", "id"]).default(EXPORT_DEFAULTS.refs),
    indent: z.enum(["spaces", "tabs"]).default(EXPORT_DEFAULTS.indent),
  }),
  outputSchema: z.object({
    format: z.enum(OUTLINE_FORMAT_IDS),
    mediaType: z.string(),
    text: z.string(),
  }),
} satisfies ActionDefinition;

/**
 * `node.export`: the nodes `ids` names, projected and written by the
 * format's codec (`exportOutline`, the function the page's copy calls). An
 * id the store does not hold is refused.
 */
export const nodeExportEffect = Effect.fn("node.export")(function* (
  input: z.infer<typeof nodeExportDef.inputSchema>,
): Effect.fn.Return<z.infer<typeof nodeExportDef.outputSchema>, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  for (const id of input.ids) yield* syncDomain(() => requireNode(ctx, id));
  let parents: Map<NodeId, NodeId> | null = null;
  const parentOf = (id: NodeId): NodeId | undefined => {
    parents ??= new Map(
      ctx.nodes.flatMap((node: KbNode) => node.children.map((child) => [child, node.id] as const)),
    );
    return parents.get(id);
  };
  return exportOutline(input.ids, { nodeOf: (id) => ctx.index.getNode(id), parentOf }, input);
});
