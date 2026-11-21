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
  recordPageStep,
  recordTextEdit,
  redoTextEdit,
  undoTextEdit,
  type TextState,
} from "../lib/text-history.ts";

/** The row's history, as its host drives it. */
export interface TextHistoryControl {
  /** Answer an undo or redo chord. */
  readonly step: (direction: "undo" | "redo") => void;
  /**
   * Record a pick (`TextTrigger`): one write of the page's, which took the
   * text from `before` to `after`; its arrival as `content` is not typing.
   * Answers how to forget it again, when the write is refused.
   */
  readonly recordPick: (before: TextState, after: TextState) => () => void;
}

/**
 * Text undo for the row being edited (`lib/text-history`).
 *
 * It records the row's text as it arrives — every write reaches the host as
 * `content`, whether it was typed or broken with Shift+Enter — so no typing
 * path has to remember to record itself. A pick is the page's write, not
 * typing: the host records it (`recordPick`), and an undo or redo that
 * reaches it is the page's (`onPage`). `step` answers an undo or redo
 * chord; `beforeinput`'s `historyUndo` / `historyRedo` (the Edit menu)
 * route to it too.
 */
export function useTextHistory({
  editorRef,
  editing,
  content,
  refs,
  onRestore,
  onPage,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  editing: boolean;
  content: string;
  /** How the restored text's references are inked (`RefLook`). */
  refs: RefLook;
  /** The text a step restored, for the surface to write. */
  onRestore: (state: TextState) => void;
  /**
   * Take back, or make again, the page's write a pick made (`PageWrites.undo`
   * / `redo`), which leaves the text `state`.
   */
  onPage: (direction: "undo" | "redo", state: TextState) => void;
}): TextHistoryControl {
  const history = useRef(emptyTextHistory);
  const last = useRef<TextState | null>(null);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) {
      history.current = emptyTextHistory;
      last.current = null;
      return;
    }
    const state = { text: content, caret: getCaretSerializedOffset(el) };
    const prev = last.current;
    last.current = state;
    if (prev !== null && prev.text !== content) {
      history.current = recordTextEdit(history.current, prev, Date.now());
    }
  }, [editorRef, editing, content]);

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const el = editorRef.current;
      if (!el) return;
      const current = { text: serializeEditable(el), caret: getCaretSerializedOffset(el) };
      const result =
        direction === "undo"
          ? undoTextEdit(history.current, current)
          : redoTextEdit(history.current, current);
      if (!result) return;
      history.current = result.history;
      // The restored text arrives back as `content`; it is not a new edit.
      last.current = result.state;
      renderInlineMarkdown(el, result.state.text, refs);
      setCaretSerializedOffset(el, result.state.caret);
      revealMarkupAtSelection(el);
      if (result.page) onPage(direction, result.state);
      else onRestore(result.state);
    },
    [editorRef, onRestore, onPage, refs],
  );

  const recordPick = useCallback((before: TextState, after: TextState) => {
    const prior = history.current;
    const recorded = recordPageStep(prior, before, after);
    history.current = recorded;
    last.current = after;
    return () => {
      if (history.current === recorded) history.current = prior;
      last.current = before;
    };
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

  return useMemo(() => ({ step, recordPick }), [step, recordPick]);
}
