/**
 * The outline's pastes of text (DESIGN-UI.md → Paste and drop): kb's own
 * rows, copied from this store, and a pasted list. Each becomes nodes after
 * the row, through `node.addTree` (DESIGN.md → Outline formats). Anything
 * else pasted is the text host's: text in the row.
 *
 * Only a list is claimed of text another program put. Outline paste reads
 * `#tag`, `field:: value` and `[[ref]]` in an item's text, and refuses a
 * tag, a field or a ref that is not there; a paragraph of prose has no way
 * to say a `#` is only text, so it is never read as an outline.
 */
import { mentionSpans } from "@kb/model";
import { outlineFormat, type OutlineItem } from "@kb/outline-paste";
import { browserHost, type IngestHandler } from "@kb/ui-sdk";

/** The flavour a copy of rows puts for kb itself: the rows as JSON, written as the source. */
export const KB_OUTLINE_TYPE = "application/x-kb-outline";

/**
 * Two or more list items, and nothing but list items and blank lines, after
 * an optional `%%tana%%` line: what the outline claims of a paste.
 */
export const PASTED_LIST =
  String.raw`^(?=(?:[\s\S]*?(?:^|\n)[ \t]*[-*+](?:[ \t]|\r?\n|$)){2})` +
  String.raw`(?:%%tana%%[ \t]*(?:\r?\n|$))?` +
  String.raw`(?:[ \t]*(?:[-*+](?:[ \t][^\r\n]*)?)?[ \t]*(?:\r?\n|$))+$`;

/** The outline's paste of a list: its items, read by the Markdown codec, as nodes after the row. */
export const PASTE_LIST: IngestHandler = {
  match: { gestures: ["paste"], types: ["text/plain"], pattern: PASTED_LIST },
  priority: 0,
  ingest: ({ text }) => ({ tree: text, format: "md" }),
};

/** Every id `items` names: each tag and field (written by id) and each reference in a text or a value. */
function namedIds(items: readonly OutlineItem[]): string[] {
  return items.flatMap((item) => [
    ...item.tags,
    ...mentionSpans(item.text).map((span) => span.id),
    ...item.fields.flatMap((field) => [
      field.name,
      ...field.values.flatMap((value) => mentionSpans(value.raw).map((span) => span.id)),
    ]),
    ...namedIds(item.children),
  ]);
}

/**
 * The JSON tree `json` holds, when every node, tag and field it names is
 * one `holds` answers for; null when it is no tree, or names one this
 * store lacks, as a copy from another kb does.
 */
export function heldTree(json: string, holds: (id: string) => boolean): string | null {
  const read = outlineFormat("json").read?.(json);
  if (read === undefined || !read.ok) return null;
  return namedIds(read.items).every(holds) ? json : null;
}

/**
 * The paste of kb's own rows: the JSON a copy of rows put, read back
 * losslessly as new nodes. It declines a tree this store cannot read as it
 * was written, so the next handler reads its Markdown instead.
 */
export const PASTE_KB_OUTLINE: IngestHandler = {
  match: { gestures: ["paste"], types: [KB_OUTLINE_TYPE] },
  priority: 100,
  ingest: ({ data }) => {
    const schema = browserHost().schema();
    const tree = heldTree(data[KB_OUTLINE_TYPE] ?? "", (id) => schema.has(id));
    return tree === null ? null : { tree, format: "json" };
  },
};
