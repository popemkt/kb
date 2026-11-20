/**
 * Undo history for one row's text while it is being edited.
 *
 * The editor rebuilds its DOM whenever typing re-forms the formatting (the
 * second `*` of `**`), and a browser's native undo stack does not survive a
 * script rewriting the nodes it recorded. So the editor answers
 * `historyUndo` / `historyRedo` itself from this record of the text and the
 * caret, which a rebuild cannot invalidate. Structural undo (split, merge,
 * indent …) is the page's and is not this; this is the text of the row
 * under the caret, for as long as the caret stays in it.
 *
 * A pick from the text's triggers is the one place the two meet: it is one
 * write of the page's, the text with what the pick made, so the page's undo
 * takes it back. The row's history holds it in its place among the typing
 * (a `page` step), so ⌘Z in the row takes back the last thing done in it.
 */

import { UNDO_DEPTH } from "./undo-depth";

export interface TextState {
  readonly text: string;
  readonly caret: number;
}

/**
 * One step of the row's history: the text an undo returns to (`text`), or
 * a write the page made from the row (`page`), which the page's own undo
 * and redo take back and make again, leaving the text `before` or `after`.
 */
type TextStep =
  | { readonly kind: "text"; readonly state: TextState }
  | { readonly kind: "page"; readonly before: TextState; readonly after: TextState };

export interface TextHistory {
  readonly undo: readonly TextStep[];
  readonly redo: readonly TextStep[];
  /** When the last entry was recorded, for coalescing a typing burst. */
  readonly at: number;
}

/** What an undo or a redo did: the history after it, the text it left, and whether the page's own undo makes it. */
export interface TextHistoryMove {
  readonly history: TextHistory;
  readonly state: TextState;
  readonly page: boolean;
}

/** Keystrokes closer together than this undo as one step. */
export const TEXT_HISTORY_COALESCE_MS = 800;

export const emptyTextHistory: TextHistory = { undo: [], redo: [], at: Number.NEGATIVE_INFINITY };

const textStep = (state: TextState): TextStep => ({ kind: "text", state });

/**
 * Record that the text is about to leave `before`. A burst of typing records
 * only its first state, so one undo takes the burst back.
 */
export function recordTextEdit(history: TextHistory, before: TextState, now: number): TextHistory {
  if (now - history.at < TEXT_HISTORY_COALESCE_MS && history.undo.at(-1)?.kind === "text") {
    return { undo: history.undo, redo: [], at: now };
  }
  return { undo: [...history.undo, textStep(before)].slice(-UNDO_DEPTH), redo: [], at: now };
}

/**
 * Record a write the page made from the row, which took its text from
 * `before` to `after`: one step, which no typing joins.
 */
export function recordPageStep(
  history: TextHistory,
  before: TextState,
  after: TextState,
): TextHistory {
  return {
    undo: [...history.undo, { kind: "page" as const, before, after }].slice(-UNDO_DEPTH),
    redo: [],
    at: Number.NEGATIVE_INFINITY,
  };
}

/** Step back from `current`; null when there is nothing to undo. */
export function undoTextEdit(history: TextHistory, current: TextState): TextHistoryMove | null {
  const step = history.undo.at(-1);
  if (step === undefined) return null;
  const page = step.kind === "page";
  return {
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, page ? step : textStep(current)],
      at: Number.NEGATIVE_INFINITY,
    },
    state: page ? step.before : step.state,
    page,
  };
}

/** Step forward from `current`; null when there is nothing to redo. */
export function redoTextEdit(history: TextHistory, current: TextState): TextHistoryMove | null {
  const step = history.redo.at(-1);
  if (step === undefined) return null;
  const page = step.kind === "page";
  return {
    history: {
      undo: [...history.undo, page ? step : textStep(current)],
      redo: history.redo.slice(0, -1),
      at: Number.NEGATIVE_INFINITY,
    },
    state: page ? step.after : step.state,
    page,
  };
}
