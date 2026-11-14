import {
  childInstanceKey,
  type FrameSubject,
  MAIN_OUTLINE_HOST,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "@kb/ui-sdk";
import { addFrameRow } from "./editing-writes";
import { FrameRowText } from "./frame-row-text";
import { outlineNodes, todayNow, useOutlineStore } from "./outline.store";

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
 * Where the outline shows a frame and when: the pane's outline `host`, the
 * day its calendar is open at (none chosen: today) and the day it is now.
 */
interface FrameAt {
  readonly host?: string;
  readonly day?: string | null;
  readonly today?: string;
}

/**
 * A frame as the outline hands it to the frame view that lays it out, with
 * `pages` of its rows revealed: the outline edits each row's text and fields,
 * draws a row's children when the view asks (`RowChildren`), adds the rows
 * it asks for (`addRow`, `addFrameRow`), says where each row is drawn
 * (`rowKey`, in the pane's outline `host`), and keeps how
 * many pages are revealed, which row a detail view shows and which day a
 * calendar is open at (`day`, today until one is chosen), so the rows a view
 * draws are the rows the outline's keyboard walk reaches.
 */
export function outlineFrameSubject(
  frame: OutlineFrame,
  pages: number,
  detail: string | null = null,
  at: FrameAt = {},
): FrameSubject {
  const { frameId, instanceKey, isQuerySource } = frame;
  const { host = MAIN_OUTLINE_HOST, day = null, today = todayNow() } = at;
  // Read when asked, so a frame that moved names its rows where it is now.
  const rowKey = (nodeId: string) =>
    isQuerySource
      ? queryResultInstanceKey(frameId, nodeId)
      : childInstanceKey(instanceKey ?? outlineInstanceKey(frameId, outlineNodes(), host), nodeId);
  return {
    ...frame,
    rowKey,
    pages,
    revealMorePages: () => useOutlineStore.getState().revealMorePages(frame.frameId),
    detail,
    showDetail: (nodeId) => useOutlineStore.getState().showDetail(frame.frameId, nodeId),
    day: day ?? today,
    today,
    showDay: (next) => useOutlineStore.getState().showDay(frame.frameId, next),
    RowText: FrameRowText,
    addRow: (where) => void addFrameRow({ frameId, isQuerySource, rowKey }, where),
  };
}
