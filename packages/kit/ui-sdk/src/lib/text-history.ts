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
 * The page's writes are where the two meet. A pick from the text's
 * triggers is one write of the page's, the text with what the pick made:
 * the row holds it as a `page` step in its place among the typing, tied to
 * the page's undo entry it made. Every step remembers the page's last entry
 * when it was taken (its mark), so ⌘Z in the row takes back first whatever
 * the page wrote since (a command run on the row, a pick in the palette),
 * through the page's undo, and the row then shows the text the page holds.
 * ⌘Z in the row takes back the last thing done while it is edited.
 */

import { UNDO_DEPTH } from "./undo-depth";

export interface TextState {
  readonly text: string;
  readonly caret: number;
}

/** The page's undo and redo stacks, as identities: newest last (`PageWrites.history`). */
export interface PageHistory {
  readonly undo: readonly unknown[];
  readonly redo: readonly unknown[];
}

/**
 * One step of the row's history: the text an undo returns to (`text`), or
 * the page's undo entry `entry` (`page`), which the page's own undo and redo
 * take back and make again, leaving the text `before` or `after`, or, where
 * null, as the page leaves it. A text step marks the page's last entry when
 * it was taken; a page step's mark is its entry.
 */
type TextStep =
  | { readonly kind: "text"; readonly state: TextState; readonly mark: unknown }
  | {
      readonly kind: "page";
      readonly entry: unknown;
      readonly before: TextState | null;
      readonly after: TextState | null;
    };

export interface TextHistory {
  readonly undo: readonly TextStep[];
  readonly redo: readonly TextStep[];
  /** When the last entry was recorded, for coalescing a typing burst. */
  readonly at: number;
  /** The page's last undo entry when the row began to be edited (null: none). */
  readonly base: unknown;
}

/**
 * What an undo or a redo did: the history after it, the text it left (null
 * where the page's step leaves it), and whether the page's undo or redo
 * makes it.
 */
export type TextHistoryMove =
  | { readonly history: TextHistory; readonly state: TextState; readonly page: false }
  | { readonly history: TextHistory; readonly state: TextState | null; readonly page: true };

/** Keystrokes closer together than this undo as one step. */
export const TEXT_HISTORY_COALESCE_MS = 800;

/** The history of a row that began to be edited when the page's last undo entry was `base`. */
export const emptyTextHistory = (base: unknown): TextHistory => ({
  undo: [],
  redo: [],
  at: Number.NEGATIVE_INFINITY,
  base,
});

const textStep = (state: TextState, mark: unknown): TextStep => ({ kind: "text", state, mark });

const pageStep = (entry: unknown, before: TextState | null, after: TextState | null): TextStep => ({
  kind: "page",
  entry,
  before,
  after,
});

/** The page's last entry when `step` was taken. */
const markOf = (step: TextStep): unknown => (step.kind === "page" ? step.entry : step.mark);

/** The page's last undo entry now, or null when it has none. */
const lastOf = (stack: readonly unknown[]): unknown => stack.at(-1) ?? null;

/**
 * Whether the page's undo stack `undo` holds an entry made after `mark`:
 * `mark` is in it, below its top, or it was empty then and is not now.
 */
function wroteSince(undo: readonly unknown[], mark: unknown): boolean {
  if (undo.length === 0) return false;
  if (mark === null) return true;
  const at = undo.indexOf(mark);
  return at !== -1 && at < undo.length - 1;
}

/**
 * Record that the text is about to leave `before`, the page's last entry
 * being `mark`. A burst of typing records only its first state, so one undo
 * takes the burst back; a write of the page's made during it ends the
 * burst, so the typing after it is a step of its own, undone first.
 */
export function recordTextEdit(
  history: TextHistory,
  before: TextState,
  now: number,
  mark: unknown,
): TextHistory {
  const last = history.undo.at(-1);
  if (now - history.at < TEXT_HISTORY_COALESCE_MS && last?.kind === "text" && last.mark === mark) {
    return { ...history, redo: [], at: now };
  }
  return {
    ...history,
    undo: [...history.undo, textStep(before, mark)].slice(-UNDO_DEPTH),
    redo: [],
    at: now,
  };
}

/**
 * Record the page's undo entry `entry`, a write made from the row, which
 * took its text from `before` to `after`: one step, which no typing joins.
 */
export function recordPageStep(
  history: TextHistory,
  before: TextState,
  after: TextState,
  entry: unknown,
): TextHistory {
  return {
    ...history,
    undo: [...history.undo, pageStep(entry, before, after)].slice(-UNDO_DEPTH),
    redo: [],
    at: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Step back from `current`, the page's stacks being `page`; null when there
 * is nothing to undo. What the page wrote since the row's last step goes
 * first, through the page's undo; a page step whose entry the page took back
 * elsewhere is passed over.
 */
export function undoTextEdit(
  history: TextHistory,
  current: TextState,
  page: PageHistory,
): TextHistoryMove | null {
  const step = history.undo.at(-1);
  const top = lastOf(page.undo);
  if (wroteSince(page.undo, step === undefined ? history.base : markOf(step))) {
    // The page's own write, made since: it takes it back, and the text is as it leaves it.
    const redo = [...history.redo, pageStep(top, null, null)];
    return { history: { ...history, redo, at: Number.NEGATIVE_INFINITY }, state: null, page: true };
  }
  if (step === undefined) return null;
  const undo = history.undo.slice(0, -1);
  if (step.kind === "text") {
    const redo = [...history.redo, textStep(current, top)];
    return {
      history: { ...history, undo, redo, at: Number.NEGATIVE_INFINITY },
      state: step.state,
      page: false,
    };
  }
  if (step.entry === top) {
    const redo = [...history.redo, step];
    return {
      history: { ...history, undo, redo, at: Number.NEGATIVE_INFINITY },
      state: step.before,
      page: true,
    };
  }
  return undoTextEdit({ ...history, undo }, current, page);
}

/**
 * Step forward from `current`, the page's stacks being `page`; null when
 * there is nothing to redo. A page step is made again when its entry is
 * the page's next redo; one the page made again elsewhere is passed over.
 */
export function redoTextEdit(
  history: TextHistory,
  current: TextState,
  page: PageHistory,
): TextHistoryMove | null {
  const step = history.redo.at(-1);
  if (step === undefined) return null;
  const redo = history.redo.slice(0, -1);
  if (step.kind === "text") {
    const undo = [...history.undo, textStep(current, lastOf(page.undo))];
    return {
      history: { ...history, undo, redo, at: Number.NEGATIVE_INFINITY },
      state: step.state,
      page: false,
    };
  }
  if (step.entry === lastOf(page.redo)) {
    const undo = [...history.undo, step];
    return {
      history: { ...history, undo, redo, at: Number.NEGATIVE_INFINITY },
      state: step.after,
      page: true,
    };
  }
  // Other writes the page took back sit above it: the page's redo is theirs.
  if (page.redo.includes(step.entry)) return null;
  return redoTextEdit({ ...history, redo }, current, page);
}
