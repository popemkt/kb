/**
 * Writing the outline tree as text (DESIGN.md → Outline formats): the
 * inverse of the readers beside it. A writer takes the tree and the options
 * every format shares; how a reference is written is Display text's
 * (`RefForm`, `markupWords`), never a writer's own.
 */
import { markupWords, plainWords, type NodeId, type NodeLike, type RefForm } from "@kb/model";
import type { OutlineItem } from "./outline.ts";

/** What every writer is told. */
export interface WriteOptions {
  /** How a reference is written: its words, a `[[words]]` link, or its token as stored. */
  readonly refs: RefForm;
  /** Two spaces a level, or a tab. */
  readonly indent: "spaces" | "tabs";
  /** The graph a reference's words are read from. */
  readonly nodeOf: (id: NodeId) => Pick<NodeLike, "text" | "props"> | undefined;
}

/** One level of indent, as the options say. */
export function indentUnit(options: Pick<WriteOptions, "indent">): string {
  return options.indent === "tabs" ? "\t" : "  ";
}

/** A tag name as the grammar reads it back: bare when it is one word, else `#[[…]]`. */
const BARE_TAG = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u;

function tagToken(name: string): string {
  return BARE_TAG.test(name) ? `#${name}` : `#[[${name}]]`;
}

/**
 * How a format built on the outline grammar writes the tree: a header line,
 * where a field goes (a `- name:: value` child item, or a property line
 * under the item's first line), and whether a line break in a text is a
 * further line of the item or must be a space.
 */
export interface GrammarStyle {
  readonly header?: string;
  readonly fields: "items" | "properties";
  readonly breaks: "lines" | "space";
}

/**
 * The tree in the outline grammar: `- ` items nested by indent, the text's
 * markup kept and each reference written in its form, the tags after the
 * text's first line, and the fields where `style` puts them.
 */
export function writeGrammar(
  items: readonly OutlineItem[],
  style: GrammarStyle,
  options: WriteOptions,
): string {
  const unit = indentUnit(options);
  const words = (text: string) => markupWords(text, options.nodeOf, options.refs);
  // A value is one line, whatever the format says of a text's breaks.
  const value = (raw: string) => words(raw).replace(/\s*\n\s*/g, " ");
  const lines: string[] = style.header === undefined ? [] : [style.header];
  const writeItem = (item: OutlineItem, indent: string): void => {
    const written = words(item.text);
    const [first = "", ...rest] =
      style.breaks === "lines" ? written.split("\n") : [written.replace(/\s*\n\s*/g, " ")];
    const head = [first, ...item.tags.map(tagToken)].filter((part) => part !== "").join(" ");
    lines.push(`${indent}-${head === "" ? "" : ` ${head}`}`);
    const column = `${indent}  `;
    if (style.fields === "properties") {
      for (const field of item.fields) {
        lines.push(`${column}${field.name}:: ${field.values.map((v) => value(v.raw)).join(", ")}`);
      }
    }
    for (const line of rest) lines.push(`${column}${line}`);
    if (style.fields === "items") {
      const at = indent + unit;
      for (const field of item.fields) {
        const [only, ...more] = field.values;
        if (only !== undefined && more.length === 0) {
          lines.push(`${at}- ${field.name}:: ${value(only.raw)}`);
          continue;
        }
        lines.push(`${at}- ${field.name}::`);
        for (const { raw } of field.values) lines.push(`${at}${unit}- ${value(raw)}`);
      }
    }
    for (const child of item.children) writeItem(child, indent + unit);
  };
  for (const item of items) writeItem(item, "");
  return lines.join("\n");
}

/**
 * The tree as plain text: each item's plain reading on its own line, its
 * references in their form, nested by indent, with no bullets, tags or
 * fields. A line break in a text is a space, since a further line would
 * read back as an item of its own.
 */
export function writePlain(items: readonly OutlineItem[], options: WriteOptions): string {
  const unit = indentUnit(options);
  const lines: string[] = [];
  const writeItem = (item: OutlineItem, indent: string): void => {
    const words = plainWords(item.text, options.nodeOf, options.refs);
    lines.push(`${indent}${words.replace(/\s*\n\s*/g, " ")}`);
    for (const child of item.children) writeItem(child, indent + unit);
  };
  for (const item of items) writeItem(item, "");
  return lines.join("\n");
}
