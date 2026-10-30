import type { KbNode, NodeId } from "@kb/model";
import { renderText, type TemplateContext } from "@kb/contracts";
import { fieldLines, rowIds, typeRefIds } from "./nodes.ts";

/**
 * The `document` template: a node and its children read as a document, the
 * outline as prose. Each row's node is the title. Each child, in the
 * outline's order, is a paragraph when nothing types it, or a section when a
 * tag does: its text the heading, then its tags' fields as a list, in the
 * order each tag lists them (`sys.f.fields`), then its own children. A
 * checklist, a framework or a glossary kept as nodes renders through it
 * with no template of its own.
 */

/** Headings stop deepening here; a deeper section keeps this level. */
const DEEPEST = 4;

/** The fields `node`'s tags template, in each tag's order, each once. */
function taggedFields(ctx: TemplateContext, node: KbNode): NodeId[] {
  const fields: NodeId[] = [];
  for (const tagId of typeRefIds(node)) {
    for (const value of ctx.nodes.get(tagId)?.props["sys.f.fields"] ?? []) {
      if (value.t === "ref" && !fields.includes(value.v)) fields.push(value.v);
    }
  }
  return fields;
}

function block(ctx: TemplateContext, node: KbNode, level: number, seen: Set<NodeId>): string[] {
  if (seen.has(node.id)) return [];
  seen.add(node.id);
  const text = renderText(node.text, ctx);
  const children = node.children
    .map((id) => ctx.nodes.get(id))
    .filter((child): child is KbNode => child !== undefined);
  if (typeRefIds(node).length === 0) {
    const own = text.trim() === "" ? [] : [text, ""];
    return [...own, ...children.flatMap((child) => block(ctx, child, level, seen))];
  }
  const fields = fieldLines(ctx, node, taggedFields(ctx, node));
  return [
    `${"#".repeat(level)} ${text}`,
    "",
    ...(fields.length === 0 ? [] : [...fields, ""]),
    ...children.flatMap((child) => block(ctx, child, Math.min(level + 1, DEEPEST), seen)),
  ];
}

/** Each row's node as a document: its text the title, its children the body. Rows: `[[nodeId], …]`. */
export function document(rows: unknown[][], ctx: TemplateContext): string {
  const roots = rowIds(rows)
    .map((id) => ctx.nodes.get(id))
    .filter((node): node is KbNode => node !== undefined);
  if (roots.length === 0) return "_Nothing to show._";
  const seen = new Set<NodeId>();
  return roots
    .flatMap((root) => {
      seen.add(root.id);
      const body = root.children
        .map((id) => ctx.nodes.get(id))
        .filter((child): child is KbNode => child !== undefined)
        .flatMap((child) => block(ctx, child, 2, seen));
      return [`# ${renderText(root.text, ctx)}`, "", ...body];
    })
    .join("\n")
    .trimEnd();
}
