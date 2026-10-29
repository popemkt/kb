import type { KbNode, NodeId } from "@kb/model";
import { renderText, type TemplateContext } from "@kb/contracts";

/**
 * What every docs template reads of the graph, said once: which nodes are
 * tags, which nodes a tag types, a field's value as text, and a node's
 * fields as a list.
 */

/** The nodes a node is typed by (`sys.f.type`): its tags, or `sys.tag` for a tag. */
function typeRefIds(node: KbNode): NodeId[] {
  return (node.props["sys.f.type"] ?? []).filter((pv) => pv.t === "ref").map((pv) => pv.v);
}

/** Ids of tag nodes whose text is `name` (a tag is a node typed `sys.tag`). */
export function tagIdsNamed(ctx: TemplateContext, name: string): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const [id, node] of ctx.nodes) {
    if (node.text === name && typeRefIds(node).includes("sys.tag")) ids.add(id);
  }
  return ids;
}

/** Every node typed by one of `tagIds`. */
export function nodesTagged(ctx: TemplateContext, tagIds: Set<NodeId>): KbNode[] {
  const out: KbNode[] = [];
  for (const [, node] of ctx.nodes) {
    if (typeRefIds(node).some((ref) => tagIds.has(ref))) out.push(node);
  }
  return out;
}

/** The rows' first column as distinct node ids, in the rows' order. */
export function rowIds(rows: unknown[][]): string[] {
  return [...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string"))];
}

/** A value as text: a ref as its target's text, mentions resolved. */
function valueText(ctx: TemplateContext, value: KbNode["props"][string][number]): string {
  if (value.t === "ref") return ctx.nodes.get(value.v)?.text ?? value.v;
  return renderText(String(value.v), ctx);
}

/** First value of the field named `field` on `node`, as text. */
export function propText(ctx: TemplateContext, node: KbNode, field: string): string | undefined {
  const fieldId = ctx.fieldIdByName(field);
  const value = fieldId === undefined ? undefined : node.props[fieldId]?.[0];
  return value === undefined ? undefined : valueText(ctx, value);
}

/** Markdown table cells are single-line and `|` terminates one. */
export function cell(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  return value.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ");
}

/**
 * `node`'s values of `fields` (field node ids, in order) as a list, one
 * `- **field** — value` line each, its first value as `propText` reads it;
 * a field it holds no value of is left out.
 */
export function fieldLines(
  ctx: TemplateContext,
  node: KbNode,
  fields: readonly NodeId[],
): string[] {
  const lines: string[] = [];
  for (const fieldId of fields) {
    const first = node.props[fieldId]?.[0];
    const shown = first === undefined ? "" : valueText(ctx, first);
    if (shown === "") continue;
    const name = ctx.nodes.get(fieldId)?.text ?? fieldId;
    lines.push(`- **${name}** — ${shown.replaceAll(/\s*\n\s*/g, " ")}`);
  }
  return lines;
}
