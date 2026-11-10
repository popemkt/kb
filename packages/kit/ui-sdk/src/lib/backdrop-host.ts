/**
 * What a page head and the scroll region it stands in tell their pane's
 * backdrop host (DESIGN-UI.md → Page-head backdrops → One backdrop across
 * pages): the head declares itself, and the region takes in the host's
 * drawing. The host and the slot are `components/page-backdrop.tsx`.
 */
import { createContext, useContext } from "react";
import type { PageBackdropChoice } from "../hooks";
import type { OutlineNode } from "./types";

/** Where a page head's space lies in its scroll region: CSS pixels of the region's content, unscrolled. */
export interface HeadBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** What a page head declares to its pane's backdrop host: its colour, its node, what it chose, and where its space lies. */
export interface HeadDeclaration {
  readonly color: string;
  readonly node: OutlineNode | undefined;
  readonly choice: PageBackdropChoice;
  readonly box: HeadBox;
}

/** Declare a head to the host; the call returns its withdrawal. */
type Declare = (declaration: HeadDeclaration) => () => void;

/** What a pane's host offers what it holds: a head declares itself, and a scroll region attaches. */
export interface HostPort {
  readonly declare: Declare;
  /** A scroll region's ref: the host draws in it from now on; the ref's cleanup takes the drawing out. */
  readonly attach: (region: HTMLElement) => () => void;
}

export const HostContext = createContext<HostPort | null>(null);

const unattached = () => () => undefined;

/**
 * A scroll region's ref onto its pane's backdrop host (`PageBackdropHost`):
 * the host draws in the region from when it mounts. The region is the
 * drawing's containing block, so it is positioned.
 */
export function useBackdropRegion(): (region: HTMLElement) => () => void {
  return useContext(HostContext)?.attach ?? unattached;
}
