/**
 * A pasted list is an outline (DESIGN-UI.md → Paste and drop): text that is
 * Tana Paste (`%%tana%%`), or two or more lines that are each a list item
 * (`-`, `*` or `+`), each nesting by its indent, becomes nodes after the
 * row, through `node.addTree` (DESIGN.md → Outline paste). Anything else
 * pasted is the browser's: text in the row.
 *
 * Only a list is claimed. Outline paste reads `#tag`, `field:: value` and
 * `[[ref]]` in an item's text, and refuses a tag, a field or a ref that is
 * not there; a paragraph of prose has no way to say a `#` is only text, so
 * it is never read as an outline.
 */
import type { IngestHandler } from "@kb/ui-sdk";

/**
 * Two or more list items, and nothing but list items and blank lines, after
 * an optional `%%tana%%` line: what the outline claims of a paste.
 */
export const PASTED_LIST =
  String.raw`^(?=(?:[\s\S]*?(?:^|\n)[ \t]*[-*+](?:[ \t]|\r?\n|$)){2})` +
  String.raw`(?:%%tana%%[ \t]*(?:\r?\n|$))?` +
  String.raw`(?:[ \t]*(?:[-*+](?:[ \t][^\r\n]*)?)?[ \t]*(?:\r?\n|$))+$`;

/** A pasted list as outline paste text: every item's marker written `-`, as the format reads it. */
export function outlineOfList(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll(/^([ \t]*)[*+](?=[ \t]|$)/gmu, "$1-");
}

/** The outline's paste of a list: its items, as nodes after the row. */
export const PASTE_LIST: IngestHandler = {
  match: { gestures: ["paste"], types: ["text/plain"], pattern: PASTED_LIST },
  priority: 0,
  ingest: ({ text }) => Promise.resolve({ outline: outlineOfList(text) }),
};
