import { CANVAS_SHAPE_PRESETS, CANVAS_SOLID_PRESETS, type CanvasPresetKind } from "./presets.ts";
/** The stroke tools, and the stroke each draws: the pen's, or a highlighter's. */
export const STROKE_TOOLS = {
  draw: { highlight: false },
  highlight: { highlight: true },
} as const satisfies Readonly<Record<string, { readonly highlight: boolean }>>;

export type CanvasStrokeTool = keyof typeof STROKE_TOOLS;

/** The tools that take hold of what is there: select, the hand (a press pans), the comment tool. */
export const HOLDING_TOOLS = ["select", "hand", "comment"] as const;

/** A tool that takes hold, a stroke tool, or a tool that places its preset. */
export type CanvasTool = (typeof HOLDING_TOOLS)[number] | CanvasStrokeTool | CanvasPresetKind;

/** The tools that share one button and one pick, each family's in its picker's order. */
export const TOOL_FAMILIES = {
  shape: CANVAS_SHAPE_PRESETS,
  solid: CANVAS_SOLID_PRESETS,
} as const satisfies Readonly<Record<string, readonly CanvasPresetKind[]>>;

export type CanvasToolFamily = keyof typeof TOOL_FAMILIES;

/** What a key or a button picks: a tool, or a family (whichever of its tools was picked last). */
export type CanvasToolPick = CanvasTool | CanvasToolFamily;
