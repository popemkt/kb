import { isSysPrefixed, isViewNode, mentionSpans, refValuesOf, SYSTEM_IDS } from "@kb/model";
import { type EdnRunner, nameIn, type OutlineNode, type SchemaIndex } from "@kb/ui-sdk";
import { otherBacklinks, rowBreadcrumbs } from "./backlinks";
import type { Crumb } from "./crumbs";

interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface UnlinkedMentionRow {
  readonly node: OutlineNode;
  readonly breadcrumbs: readonly Crumb[];
  readonly match: TextSpan;
}

const graphemes = new Intl.Segmenter();

const SCHEMA_TAG_IDS: ReadonlySet<string> = new Set([
  SYSTEM_IDS.tag,
  SYSTEM_IDS.field,
  SYSTEM_IDS.command,
]);

/** Search for the displayed title as a whole word or phrase, including Unicode letters. */
function titlePattern(title: string): RegExp {
  const word = "[\\p{L}\\p{M}\\p{N}_]";
  const prefix = /^[\p{L}\p{M}\p{N}_]/u.test(title) ? `(?<!${word})` : "";
  const suffix = /[\p{L}\p{M}\p{N}_]$/u.test(title) ? `(?!${word})` : "";
  const literal = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${prefix}${literal}${suffix}`, "giu");
}

function findUnlinkedMatch(text: string, pattern: RegExp): TextSpan | null {
  const mentions = mentionSpans(text);
  for (const hit of text.matchAll(pattern)) {
    const start = hit.index;
    const end = start + hit[0].length;
    if (mentions.every((mention) => end <= mention.start || start >= mention.end)) {
      return { start, end };
    }
  }
  return null;
}

function isSchemaOrSystemNode(node: OutlineNode): boolean {
  return (
    isSysPrefixed(node.id) ||
    isViewNode(node) ||
    refValuesOf(node, SYSTEM_IDS.typeField).some((id) => SCHEMA_TAG_IDS.has(id))
  );
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
    if (excluded.has(node.id) || isSchemaOrSystemNode(node) || node.text.length < title.length) {
      continue;
    }
    const match = findUnlinkedMatch(node.text, pattern);
    if (match !== null) {
      rows.push({ node, breadcrumbs: rowBreadcrumbs(schema, node.id), match });
    }
  }
  return rows;
}
