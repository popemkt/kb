/**
 * What a page head tells its pane's backdrop host (DESIGN-UI.md → Page-head
 * backdrops → One backdrop across pages): its colour, its node, what it
 * chose, and the space the host draws in. The host and the slot are
 * `components/page-backdrop.tsx`.
 */
import { createContext } from "react";
import type { PageBackdropChoice } from "../hooks";
import type { OutlineNode } from "./types";

/** What a page head declares to its pane's backdrop host. */
export interface HeadDeclaration {
  readonly color: string;
  readonly node: OutlineNode | undefined;
  readonly choice: PageBackdropChoice;
  /** The head's space: the host draws in it, so layout places the backdrop with the page. */
  readonly space: HTMLElement;
}

/** What a pane's host offers its heads: a head declares itself, and the call returns its withdrawal. */
export interface HostPort {
  readonly declare: (declaration: HeadDeclaration) => () => void;
}

export const HostContext = createContext<HostPort | null>(null);
