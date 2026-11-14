/**
 * What a frame view is shown for: the frame whose rows it lays out, where its
 * host draws it, and what the host draws each row's text with
 * (DESIGN-UI.md → Outline editor → frames). A row's fields are drawn with
 * the page's field editor (`useFieldEditor`), as every surface draws them. A frame view's params are the
 * settings it reads; this is the frame they are applied to, and none of it is
 * config, so it travels beside the params, never in them.
 *
 * The host is the view that shows a frame's rows inline wherever a frame
 * sits (at its root, in a projected frame's row, under a query's results),
 * and builds this subject for each. A frame view lays the rows out; editing
 * a row's text is the host's, so a frame view of any family lays out rows
 * its host edits.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { Condition } from "@kb/query";
import type { ViewFilter } from "@kb/views";
import type { OutlineNode, TagBadge } from "./types";

/**
 * A condition a new row holds where a view asks for it: the view's filter,
 * or a group's value as `field-is` (DESIGN-UI.md → Adding to a frame).
 */
export type RowCondition = Condition | ViewFilter;

/** A row's text, as the host edits it, inside the view's own row chrome. */
export interface FrameRowTextProps {
  readonly node: OutlineNode;
  readonly instanceKey: string;
  readonly isActive: boolean;
  /** The tags the view shows inline with the text; none when it shows them apart. */
  readonly tags: TagBadge[];
}

/** A row whose children a view asks its host to draw: which node, under which instance, how deep. */
export interface FrameRowProps {
  readonly nodeId: string;
  readonly instanceKey: string;
  readonly depth: number;
}

export interface FrameSubject {
  readonly frameId: string;
  /** The frame's render instance; absent at the host's root. */
  readonly instanceKey?: string | undefined;
  /** Query-result rows, which replace the frame's children. */
  readonly rowIds?: readonly string[] | undefined;
  readonly isQuerySource: boolean;
  /** The indent level of the frame's rows. */
  readonly depth: number;
  /** How many pages of the frame's rows are revealed (`frameRows`' `pages`). */
  readonly pages: number;
  /** Reveal one more page of the frame's rows. */
  readonly revealMorePages: () => void;
  /**
   * The row a detail view last chose to show, as the host keeps it for the
   * frame; null while none is (DESIGN-UI.md → List with detail).
   */
  readonly detail: string | null;
  /** Show the row `nodeId` in the frame's detail, as the host keeps it. */
  readonly showDetail: (nodeId: string) => void;
  readonly RowText: ComponentType<FrameRowTextProps>;
  /**
   * The children a row shows, in their own frame view, as the host draws
   * them under a row in a list (DESIGN-UI.md → Frame views): the one way a
   * view asks its host for a row's children.
   */
  readonly RowChildren: ComponentType<FrameRowProps>;
  /**
   * Add a row where the view asks for one, holding `where` (DESIGN-UI.md →
   * Adding to a frame): the host adds the frame's own part, the query it
   * matches or the frame as parent, and opens the row's text. The one way a
   * view asks its host for a new row.
   */
  readonly addRow: (where: readonly RowCondition[]) => void;
}

/** Only a frame's host provides it; a frame view outside one has no frame to show. */
export const FrameSubjectContext = createContext<FrameSubject | null>(null);

export function useFrameSubject(): FrameSubject | null {
  return useContext(FrameSubjectContext);
}
