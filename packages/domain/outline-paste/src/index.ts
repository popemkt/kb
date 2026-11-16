/**
 * The outline's text forms (DESIGN.md → Outline paste, Outline formats):
 * one interchange tree, the codecs that read and write it, the projection
 * from nodes to the tree, and nothing that resolves. Core's `node.addTree`
 * resolves what a tree means and `node.export` writes one; the CLI reads an
 * outline's field lines to plan `--create`; a family checks a starter
 * outline it ships against the same reader; the page copies and pastes
 * through the same codecs.
 */
export { outlineFieldNames, parseOutline } from "./outline.ts";
export type { OutlineItem, OutlineParse } from "./outline.ts";
export { OUTLINE_FORMAT_IDS, OUTLINE_FORMATS, outlineFormat } from "./formats.ts";
export type { OutlineFormat, OutlineFormatId } from "./formats.ts";
export type { WriteOptions } from "./write.ts";
export { inlineHtml } from "./html.ts";
export { outlineOfNodes, type OutlineGraph } from "./project.ts";
export { EXPORT_DEFAULTS, exportOutline, type ExportOptions, type Exported } from "./export.ts";
