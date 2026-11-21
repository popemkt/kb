import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import {
  getCaretSerializedOffset,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
  type RefLook,
} from "../lib/md-edit.ts";
import {
  emptyTextHistory,
  type PageHistory,
  recordPageStep,
  recordTextEdit,
  redoTextEdit,
  type TextHistory,
  undoTextEdit,
  type TextState,
} from "../lib/text-history.ts";

/** The row's history, as its host drives it. */
export interface TextHistoryControl {
  /** Answer an undo or redo chord. */
  readonly step: (direction: "undo" | "redo") => void;
  /**
   * The text the host has just laid into the row itself (a pick's): its
   * arrival as `content` is not typing.
   */
  readonly shown: (state: TextState) => void;
  /**
   * Record a pick (`TextTrigger`): the page's undo entry `entry`, one write
   * of the page's, which took the text from `before` to `after`.
   */
  readonly recordPick: (before: TextState, after: TextState, entry: unknown) => void;
}

/** The page's side of the row's history: its stacks, and its own undo and redo. */
export interface PageSide {
  readonly history: () => PageHistory;
  /**
   * Take back, or make again, the page's last write, the text then being
   * `state` (null: as the page leaves it); answers the row's text after it.
   */
  readonly step: (direction: "undo" | "redo", state: TextState | null) => Promise<string | null>;
}

/** A row whose host was drawn away while it was edited: its history, and its text then. */
interface Carried {
  readonly row: string;
  readonly history: TextHistory;
  readonly text: string;
}

/**
 * The row whose host was drawn away while it was edited. A write that draws
 * the row at another instance (an indent) unmounts its host as it applies,
 * and the row's editing goes on in the host drawn there (`keepEditing`),
 * which takes the history up, so ⌘Z still reaches what was done before,
 * the write included. Leaving the row (Escape, a click elsewhere) ends its
 * history instead, and the next row to be edited takes up only its own.
 */
let carried: Carried | null = null;

/** The history row `row` was drawn away with, when its text is still `text`. */
function takeUp(row: string, text: string): TextHistory | null {
  const held = carried;
  carried = null;
  return held?.row === row && held.text === text ? held.history : null;
}

/**
 * Text undo for the row being edited (`lib/text-history`).
 *
 * It records the row's text as it arrives — every write reaches the host as
 * `content`, whether it was typed or broken with Shift+Enter — so no typing
 * path has to remember to record itself. Each step marks the page's last
 * undo entry then, so an undo reaches the page's writes in their place (a
 * pick, which the host records, or a write made on the row since). `step`
 * answers an undo or redo chord; `beforeinput`'s `historyUndo` /
 * `historyRedo` (the Edit menu) route to it too. The history belongs to the
 * row `row`, not to this host: a host drawn away while the row is edited
 * hands it on (`carried`), so a redraw at another instance keeps it.
 */
export function useTextHistory({
  row,
  editorRef,
  editing,
  content,
  refs,
  onRestore,
  page,
}: {
  /** The node whose text is edited. */
  row: string;
  editorRef: RefObject<HTMLDivElement | null>;
  editing: boolean;
  content: string;
  /** How the restored text's references are inked (`RefLook`). */
  refs: RefLook;
  /** The text a step restored, for the surface to write. */
  onRestore: (state: TextState) => void;
  page: PageSide;
}): TextHistoryControl {
  const history = useRef<TextHistory | null>(null);
  const last = useRef<TextState | null>(null);
  const mark = useCallback(() => page.history().undo.at(-1) ?? null, [page]);
  /** The history editing starts from, the text being `text`: the row's, carried, or a new one. */
  const begin = useCallback(
    (text: string) => takeUp(row, text) ?? emptyTextHistory(mark()),
    [row, mark],
  );

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) {
      history.current = null;
      last.current = null;
      return;
    }
    if (history.current === null) history.current = begin(content);
    const state = { text: content, caret: getCaretSerializedOffset(el) };
    const prev = last.current;
    last.current = state;
    if (prev !== null && prev.text !== content) {
      history.current = recordTextEdit(history.current, prev, Date.now(), mark());
    }
  }, [editorRef, editing, content, mark, begin]);

  // The host drawn away while the row is edited: hand its history on. When
  // editing stops first, the history has ended already (null).
  useLayoutEffect(
    () => () => {
      const text = last.current?.text;
      if (history.current !== null && text !== undefined) {
        carried = { row, history: history.current, text };
      }
    },
    [row],
  );

  /** Lay `state` into the row, as the text it now holds. */
  const lay = useCallback(
    (el: HTMLDivElement, state: TextState) => {
      last.current = state;
      renderInlineMarkdown(el, state.text, refs);
      setCaretSerializedOffset(el, state.caret);
      revealMarkupAtSelection(el);
    },
    [refs],
  );

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const el = editorRef.current;
      if (!el || history.current === null) return;
      const current = { text: serializeEditable(el), caret: getCaretSerializedOffset(el) };
      const stacks = page.history();
      const result =
        direction === "undo"
          ? undoTextEdit(history.current, current, stacks)
          : redoTextEdit(history.current, current, stacks);
      if (!result) return;
      history.current = result.history;
      // The restored text arrives back as `content`; it is not a new edit.
      if (result.state !== null) lay(el, result.state);
      else last.current = null;
      if (!result.page) {
        onRestore(result.state);
        return;
      }
      void page.step(direction, result.state).then((text) => {
        if (result.state !== null || text === null || editorRef.current !== el) return;
        lay(el, { text, caret: Math.min(current.caret, text.length) });
      });
    },
    [editorRef, onRestore, page, lay],
  );

  const shown = useCallback((state: TextState) => {
    last.current = state;
  }, []);

  const recordPick = useCallback((before: TextState, after: TextState, entry: unknown) => {
    if (history.current !== null) {
      history.current = recordPageStep(history.current, before, after, entry);
    }
  }, []);

  useEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return undefined;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
      e.preventDefault();
      step(e.inputType === "historyUndo" ? "undo" : "redo");
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [editorRef, editing, step]);

  return useMemo(() => ({ step, shown, recordPick }), [step, shown, recordPick]);
}
