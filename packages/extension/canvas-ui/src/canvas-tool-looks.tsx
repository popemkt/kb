/**
 * Every canvas tool's name and mark, and the strip's one table of what
 * stands in it and in what order (DESIGN-UI.md → Canvas → The tool strip):
 * what the strip, its pickers and its More sheet are drawn from.
 */
import type { ReactNode } from "react";
import {
  ArrowUpRightIcon,
  ArrowFatDownIcon,
  ArrowFatLeftIcon,
  ArrowFatRightIcon,
  ArrowFatUpIcon,
  ChatCircleIcon,
  CheckSquareIcon,
  CloudIcon,
  CircleIcon,
  CubeIcon,
  CursorIcon,
  CylinderIcon,
  DiamondIcon,
  FrameCornersIcon,
  HandIcon,
  HexagonIcon,
  HighlighterIcon,
  PencilSimpleIcon,
  ImageIcon,
  LineSegmentIcon,
  PlusIcon,
  RowsIcon,
  SphereIcon,
  SquareIcon,
  SquareHalfIcon,
  StarIcon,
  TagIcon,
  TextTIcon,
  TriangleIcon,
  WallIcon,
} from "@phosphor-icons/react";
import type { CanvasProjectionKind } from "@kb/canvas";
import type { CanvasTool, CanvasToolFamily } from "./canvas-tool";
import { cn } from "@kb/ui-sdk";

/**
 * Every tool's name and mark: tsc asks for one per preset, so a new preset
 * cannot go unnamed. Its key is the shortcut table's (`shortcutHint`).
 */
export const TOOL_LOOKS: {
  readonly [T in CanvasTool]: { readonly label: string; readonly icon: ReactNode };
} = {
  select: { label: "Select", icon: <CursorIcon size={16} /> },
  hand: { label: "Hand: a press pans", icon: <HandIcon size={16} /> },
  comment: { label: "Comment: on an item, or at a point", icon: <ChatCircleIcon size={16} /> },
  text: { label: "Text", icon: <TextTIcon size={16} /> },
  label: { label: "Label: faces you in 3D", icon: <TagIcon size={16} /> },
  rect: { label: "Rectangle", icon: <SquareIcon size={16} /> },
  ellipse: { label: "Ellipse", icon: <CircleIcon size={16} /> },
  diamond: { label: "Diamond", icon: <DiamondIcon size={16} /> },
  draw: { label: "Draw", icon: <PencilSimpleIcon size={16} /> },
  highlight: { label: "Highlight", icon: <HighlighterIcon size={16} /> },
  triangle: { label: "Triangle", icon: <TriangleIcon size={16} /> },
  hexagon: { label: "Hexagon", icon: <HexagonIcon size={16} /> },
  star: { label: "Star", icon: <StarIcon size={16} /> },
  cloud: { label: "Cloud", icon: <CloudIcon size={16} /> },
  "arrow-left": { label: "Arrow left", icon: <ArrowFatLeftIcon size={16} /> },
  "arrow-right": { label: "Arrow right", icon: <ArrowFatRightIcon size={16} /> },
  "arrow-up": { label: "Arrow up", icon: <ArrowFatUpIcon size={16} /> },
  "arrow-down": { label: "Arrow down", icon: <ArrowFatDownIcon size={16} /> },
  "check-box": { label: "Check box", icon: <CheckSquareIcon size={16} /> },
  line: { label: "Line", icon: <LineSegmentIcon size={16} /> },
  arrow: { label: "Arrow", icon: <ArrowUpRightIcon size={16} /> },
  group: { label: "Group / Frame", icon: <FrameCornersIcon size={16} /> },
  "kb-node": { label: "Add kb node", icon: <PlusIcon size={16} /> },
  image: { label: "Image (or paste or drop one)", icon: <ImageIcon size={16} /> },
  box: { label: "Box", icon: <CubeIcon size={16} /> },
  pillar: { label: "Pillar", icon: <CylinderIcon size={16} /> },
  sphere: { label: "Sphere", icon: <SphereIcon size={16} /> },
  cone: { label: "Cone", icon: <TriangleIcon size={16} /> },
  slab: { label: "Shelf", icon: <RowsIcon size={16} /> },
  wall: { label: "Wall", icon: <WallIcon size={16} /> },
};

/**
 * The strip, in order: a tool that stands alone, or a family behind one
 * button. `more`: on a compact stage (`compactStage`) it waits behind More,
 * so the row along the bottom holds what a phone reaches for most, as
 * tldraw's and Excalidraw's do.
 */
export type StripEntry =
  | { readonly tool: CanvasTool; readonly more?: true }
  | { readonly family: CanvasToolFamily; readonly more?: true };

export const STRIP: readonly StripEntry[] = [
  { tool: "select" },
  { tool: "hand" },
  { tool: "text" },
  { tool: "label", more: true },
  { tool: "draw" },
  { tool: "highlight", more: true },
  { tool: "line", more: true },
  { tool: "arrow" },
  { tool: "group", more: true },
  { tool: "kb-node", more: true },
  { tool: "image", more: true },
  { tool: "comment", more: true },
  { family: "shape" },
  { family: "solid", more: true },
];

/** Each projection's mark on the toggle. */
export const PROJECTION_ICONS: Record<CanvasProjectionKind, ReactNode> = {
  "2d": <SquareHalfIcon size={16} />,
  "3d": <CubeIcon size={16} />,
};

/** A tool's button: a finger's 40px on a compact stage (tldraw's), a pointer's 32px otherwise. */
export const toolButtonClass = (compact: boolean) =>
  cn(
    "relative flex items-center justify-center rounded-md text-foreground/55 transition-colors",
    "hover:bg-foreground/5 hover:text-foreground/80",
    compact ? "h-10 w-10" : "h-8 w-8",
  );
