import type { FrameSubject } from "@kb/ui-sdk";
import { FrameRowText } from "./frame-row-text";
import { useOutlineStore } from "./outline.store";

/**
 * Which frame the outline shows, and where: what its host knows of it before
 * a view lays it out, with what the host draws a row's children with (the
 * outline's `RowChildren`, handed in so the slot that renders them and this
 * subject are no import cycle).
 */
type OutlineFrame = Pick<
  FrameSubject,
  "frameId" | "instanceKey" | "rowIds" | "isQuerySource" | "depth" | "RowChildren"
>;

/**
 * A frame as the outline hands it to the frame view that lays it out, with
 * `pages` of its rows revealed: the outline edits each row's text and fields,
 * draws a row's children when the view asks (`RowChildren`), and keeps how
 * many pages are revealed, so the rows a view draws are the rows the
 * outline's keyboard walk reaches.
 */
export function outlineFrameSubject(frame: OutlineFrame, pages: number): FrameSubject {
  return {
    ...frame,
    pages,
    revealMorePages: () => useOutlineStore.getState().revealMorePages(frame.frameId),
    RowText: FrameRowText,
  };
}
