import {
  inlineSpanSource,
  type InlineSpan,
  isScaffolding,
  isViewNode,
  parseInlineSource,
} from "@kb/model";
import {
  type EdnRunner,
  formatRefToken,
  nameIn,
  type OutlineNode,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { otherBacklinks, rowBreadcrumbs } from "./backlinks";

export interface UnlinkedMentionRow {
  readonly node: OutlineNode;
  readonly linkedText: string;
}

const graphemes = new Intl.Segmenter();

/** Search for the displayed title as a whole word or phrase, including Unicode letters. */
function titlePattern(title: string): RegExp {
  const word = "[\\p{L}\\p{M}\\p{N}_]";
  const prefix = /^[\p{L}\p{M}\p{N}_]/u.test(title) ? `(?<!${word})` : "";
  const suffix = /[\p{L}\p{M}\p{N}_]$/u.test(title) ? `(?!${word})` : "";
  const literal = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${prefix}${literal}${suffix}`, "giu");
}

/** The parser's segment and its range in the original text at this offset. */
function inlineSpanAt(
  text: string,
  offset: number,
): { start: number; end: number; span: InlineSpan } | null {
  let start = 0;
  for (const span of parseInlineSource(text)) {
    const end = start + inlineSpanSource(span).length;
    if (offset < end) return { start, end, span };
    start = end;
  }
  return null;
}

function linkedTextFor(text: string, pattern: RegExp, targetId: string): string | null {
  for (const hit of text.matchAll(pattern)) {
    const start = hit.index;
    const end = start + hit[0].length;
    const source = inlineSpanAt(text, start);
    if (source?.span.seg.t !== "text" || end > source.end) continue;

    const token = formatRefToken(targetId, hit[0]);
    const linkedText = text.slice(0, start) + token + text.slice(end);
    const linked = inlineSpanAt(linkedText, start);
    if (linked?.span.seg.t === "ref" && linked.start === start && linked.span.open === token) {
      return linkedText;
    }
  }
  return null;
}

/** A node no mention is offered in: the store's scaffolding, or a view. A tag is content, as any node is. */
function isScaffoldingOrView(node: OutlineNode): boolean {
  return isScaffolding(node) || isViewNode(node);
}

/** The target and the tree around it, walking through any already-linked rows. */
function surroundingIds(schema: SchemaIndex, target: OutlineNode): Set<string> {
  const subtree = new Set<string>();
  const pending = [target.id];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (subtree.has(id)) continue;
    subtree.add(id);
    pending.push(...(schema.get(id)?.children ?? []));
  }
  for (const crumb of rowBreadcrumbs(schema, target.id)) subtree.add(crumb.id);
  return subtree;
}

/** Plain-text matches outside the target's tree and the replica's mention edges. */
export function unlinkedMentionRows(
  run: EdnRunner,
  schema: SchemaIndex,
  nodeId: string,
): UnlinkedMentionRow[] {
  const target = schema.get(nodeId);
  const title = nameIn(schema, nodeId).trim();
  if (target === undefined || [...graphemes.segment(title)].length < 3) return [];

  const pattern = titlePattern(title);
  const excluded = surroundingIds(schema, target);
  for (const row of otherBacklinks(run, nodeId)) excluded.add(row.id);

  const rows: UnlinkedMentionRow[] = [];
  for (const node of schema.values()) {
    if (excluded.has(node.id) || isScaffoldingOrView(node) || node.text.length < title.length) {
      continue;
    }
    const linkedText = linkedTextFor(node.text, pattern, nodeId);
    if (linkedText !== null) {
      rows.push({ node, linkedText });
    }
  }
  return rows;
}
