/**
 * What a workflow works on, from the page that hosts it (DESIGN-UI.md →
 * The gallery): the library read from the replica, the nodes, the online
 * sources, where saves go, and what the page's services offer now (the
 * composer's model, the moodboard). It travels in context, never in a
 * workflow's params, as a graph renderer's frame does; a workflow drawn
 * outside the composer says there is nothing to work on.
 */
import { createContext, useContext } from "react";
import type { GraphNode, ImageSource, Library } from "@kb/gallery";
import type { Board } from "@kb/ui-sdk";
import type { ComposerModel } from "./model";

export interface ComposerFrame {
  readonly library: Library;
  readonly node: (id: string) => GraphNode | undefined;
  readonly sources: readonly ImageSource[];
  /** Where saved visuals and looks go: the gallery's `save into` setting, or nowhere chosen. */
  readonly saveInto: string | null;
  /** The person's model, while a family provides one. */
  readonly model: ComposerModel | null;
  /** The board a look's moodboard is drawn on, while a family provides one. */
  readonly board: Board | null;
  /** Open another workflow, starting from `from` when given. */
  readonly open: (workflow: string, from?: string) => void;
}

export const ComposerFrameContext = createContext<ComposerFrame | null>(null);

/** The composer around a workflow, or null outside one. */
export function useComposer(): ComposerFrame | null {
  return useContext(ComposerFrameContext);
}
