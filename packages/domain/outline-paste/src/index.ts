/**
 * Outline paste, the text form of a whole outline (DESIGN.md → Outline
 * paste): its syntax and nothing else. Core's `node.addTree` resolves what
 * the tree means; the CLI reads an outline's field lines to plan `--create`;
 * a family checks a starter outline it ships against the same reader.
 */
export { outlineFieldNames, parseOutline } from "./outline.ts";
export type { OutlineItem } from "./outline.ts";
