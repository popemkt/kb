/** Shared transform input vocabulary; gestures interpret these inputs in the page. */
export type CanvasAxis = "x" | "y" | "z";

export interface TransformConstraint {
  readonly axis: CanvasAxis;
  readonly plane: boolean;
  readonly space: "global" | "local";
}

export type TransformMode = "grab" | "rotate" | "scale" | "extrude";

export type TransformKey =
  /** X, Y or Z: hold to that axis; with Shift, to the plane across it. */
  | { readonly kind: "axis"; readonly axis: CanvasAxis; readonly plane: boolean }
  /** A digit, `.`, `-` (which negates) or Backspace: the typed value. */
  | { readonly kind: "type"; readonly key: string }
  /** G, R or S: switch to grab, rotate or scale. */
  | { readonly kind: "mode"; readonly mode: Exclude<TransformMode, "extrude"> };
