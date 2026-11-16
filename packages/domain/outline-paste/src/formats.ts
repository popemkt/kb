/**
 * The outline formats (DESIGN.md → Outline formats): each one codec over the
 * one interchange tree, stated as data. `node.addTree` reads through a
 * format's `read`, `node.export` writes through its `write`, and the page's
 * paste, copy and Copy as… use the same rows. A format with no reader has
 * no `read`.
 */
import { writeHtml } from "./html.ts";
import { readJson, writeJson } from "./json.ts";
import { LOOSE, PLAIN, parseOutline, type OutlineItem, type OutlineParse } from "./outline.ts";
import { writeGrammar, writePlain, type WriteOptions } from "./write.ts";

/** Every format's id, in the order a person is offered them. */
export const OUTLINE_FORMAT_IDS = ["md", "plain", "html", "tana", "logseq", "json"] as const;
export type OutlineFormatId = (typeof OUTLINE_FORMAT_IDS)[number];

export interface OutlineFormat {
  readonly id: OutlineFormatId;
  readonly label: string;
  readonly mediaType: string;
  readonly read?: (source: string) => OutlineParse;
  readonly write: (items: readonly OutlineItem[], options: WriteOptions) => string;
}

const readLoose = (source: string): OutlineParse => parseOutline(source, LOOSE);

export const OUTLINE_FORMATS: readonly OutlineFormat[] = [
  {
    id: "md",
    label: "Markdown",
    mediaType: "text/markdown",
    read: readLoose,
    write: (items, options) => writeGrammar(items, { fields: "items", breaks: "lines" }, options),
  },
  {
    id: "plain",
    label: "Plain text",
    mediaType: "text/plain",
    read: (source) => parseOutline(source, PLAIN),
    write: writePlain,
  },
  { id: "html", label: "Rich text", mediaType: "text/html", write: writeHtml },
  {
    id: "tana",
    label: "Tana Paste",
    mediaType: "text/plain",
    read: parseOutline,
    write: (items, options) =>
      writeGrammar(items, { header: "%%tana%%", fields: "items", breaks: "space" }, options),
  },
  {
    id: "logseq",
    label: "Logseq",
    mediaType: "text/markdown",
    read: readLoose,
    write: (items, options) =>
      writeGrammar(items, { fields: "properties", breaks: "lines" }, options),
  },
  { id: "json", label: "JSON", mediaType: "application/json", read: readJson, write: writeJson },
];

/** The format `id` names. */
export function outlineFormat(id: OutlineFormatId): OutlineFormat {
  const format = OUTLINE_FORMATS.find((candidate) => candidate.id === id);
  if (format === undefined) throw new Error(`no outline format ${id}`);
  return format;
}
