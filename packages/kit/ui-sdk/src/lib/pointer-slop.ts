/**
 * How far a press may travel and still be a click (a tap), not a drag, by
 * the kind of pointer that made it: one table for every surface that tells
 * the two apart — the canvas's card, resize and marquee drags, its 3D
 * gestures and touches, the scene kit's taps, and a graph node's drag
 * (`graph-drag`) — so a press is never both. A finger wanders further in a
 * tap than a mouse does in a click: Android's touch slop is 8dp.
 */
export const POINTER_SLOPS = { mouse: 4, pen: 4, touch: 8 } as const;

/** What pressed: a mouse (or anything unnamed), a pen or a finger. */
export type PointerKind = keyof typeof POINTER_SLOPS;

/** The kind of pointer a `PointerEvent.pointerType` names; an unknown one reads as a mouse. */
export const pointerKind = (pointerType: string): PointerKind =>
  pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";

/** Whether a press by a `kind` pointer that has travelled (dx, dy) CSS px is a drag. */
export const pastSlop = (dx: number, dy: number, kind: PointerKind): boolean =>
  Math.hypot(dx, dy) > POINTER_SLOPS[kind];

/**
 * How long a finger is held still before it is a long press, which opens
 * what a right click there would: Android's long-press timeout. One time for
 * every surface that hears one — the canvas's touches, a row's bullet.
 */
export const LONG_PRESS_MS = 500;
