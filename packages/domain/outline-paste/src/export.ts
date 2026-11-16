/**
 * An export (DESIGN.md → Outline formats, `node.export`): the projection of
 * some rows, written by a format's codec. One function, which `node.export`
 * runs and the page calls while a copy event runs, so a copy and the CLI
 * write the same text.
 */
import type { RefForm } from "@kb/model";
import { outlineFormat, type OutlineFormatId } from "./formats.ts";
import { outlineOfNodes, type OutlineGraph } from "./project.ts";

export interface ExportOptions {
  readonly format: OutlineFormatId;
  readonly children: boolean;
  readonly fieldsAndTags: boolean;
  readonly refs: RefForm;
  readonly indent: "spaces" | "tabs";
}

/**
 * What every option left out reads as: Markdown, children, fields and tags,
 * references as words, two spaces. The action's schema, the page's copy and
 * the Copy as… settings read this one statement.
 */
export const EXPORT_DEFAULTS: ExportOptions = {
  format: "md",
  children: true,
  fieldsAndTags: true,
  refs: "label",
  indent: "spaces",
};

/** What an export answers: the text, and what it is. */
export interface Exported {
  readonly format: OutlineFormatId;
  readonly mediaType: string;
  readonly text: string;
}

/**
 * `rows` in `options.format`: written as the source, everything by id, when
 * references are written as ids, else as a person reads them.
 */
export function exportOutline(
  rows: readonly string[],
  nodes: OutlineGraph,
  options: ExportOptions,
): Exported {
  const format = outlineFormat(options.format);
  const items = outlineOfNodes(rows, nodes, {
    children: options.children,
    fieldsAndTags: options.fieldsAndTags,
    names: options.refs === "id" ? "ids" : "labels",
  });
  return {
    format: format.id,
    mediaType: format.mediaType,
    text: format.write(items, { refs: options.refs, indent: options.indent, nodeOf: nodes.nodeOf }),
  };
}
