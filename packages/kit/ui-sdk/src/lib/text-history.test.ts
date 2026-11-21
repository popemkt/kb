import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import {
  TEXT_HISTORY_COALESCE_MS,
  emptyTextHistory,
  type PageHistory,
  recordPageStep,
  recordTextEdit,
  redoTextEdit,
  undoTextEdit,
} from "./text-history.ts";

const s = (text: string, caret = text.length) => ({ text, caret });
/** A page whose undo stack is `undo` and redo stack `redo`. */
const pageOf = (undo: unknown[] = [], redo: unknown[] = []): PageHistory => ({ undo, redo });
const none = pageOf();
const fresh = emptyTextHistory(null);

describe("text history", () => {
  it("undoes a typing burst as one step and redoes it", () => {
    let h = recordTextEdit(fresh, s("a"), 0, null);
    h = recordTextEdit(h, s("ab"), 10, null);
    h = recordTextEdit(h, s("abc"), 20, null);
    const undone = present(undoTextEdit(h, s("abcd"), none), "undo");
    expect(undone.state).toEqual(s("a"));
    const redone = present(redoTextEdit(undone.history, s("a"), none), "redo");
    expect(redone.state).toEqual(s("abcd"));
  });

  it("separates edits further apart than the coalescing window", () => {
    let h = recordTextEdit(fresh, s("a"), 0, null);
    h = recordTextEdit(h, s("ab"), TEXT_HISTORY_COALESCE_MS + 1, null);
    const first = present(undoTextEdit(h, s("abc"), none), "undo");
    expect(first.state).toEqual(s("ab"));
    expect(present(undoTextEdit(first.history, s("ab"), none), "undo").state).toEqual(s("a"));
  });

  it("a new edit clears what could be redone, and an empty history does nothing", () => {
    const h = recordTextEdit(fresh, s("a"), 0, null);
    const undone = present(undoTextEdit(h, s("ab"), none), "undo");
    const edited = recordTextEdit(undone.history, s("a"), 5000, null);
    expect(redoTextEdit(edited, s("ax"), none)).toBeNull();
    expect(undoTextEdit(fresh, s(""), none)).toBeNull();
  });

  it("holds a page step in its place among the typing, taken back and made again whole", () => {
    const pick = { pick: true };
    let h = recordTextEdit(fresh, s(""), 0, null);
    h = recordPageStep(h, s("x #ta"), s("x ", 2), pick);
    // Typing straight after the pick is its own step, never the pick's.
    h = recordTextEdit(h, s("x ", 2), 10, pick);
    const typing = present(undoTextEdit(h, s("x y"), pageOf([pick])), "undo typing");
    expect(typing).toMatchObject({ state: s("x ", 2), page: false });
    const undone = present(undoTextEdit(typing.history, s("x ", 2), pageOf([pick])), "the pick");
    expect(undone).toMatchObject({ state: s("x #ta"), page: true });
    // The page took the pick back: its undo stack is empty now.
    const first = present(undoTextEdit(undone.history, s("x #ta"), none), "the first typing");
    expect(first).toMatchObject({ state: s(""), page: false });
    const again = present(redoTextEdit(first.history, s(""), pageOf([], [pick])), "the typing");
    expect(again).toMatchObject({ state: s("x #ta"), page: false });
    const made = present(redoTextEdit(again.history, s("x #ta"), pageOf([], [pick])), "the pick");
    expect(made).toMatchObject({ state: s("x ", 2), page: true });
  });

  it("takes back first what the page wrote since the row's last step, the text as the page leaves it", () => {
    const pick = { pick: true };
    const tag = { tag: true };
    const h = recordPageStep(fresh, s("/tag"), s("", 0), pick);
    // A write of the page's made after the pick: the row takes it back first.
    const later = present(undoTextEdit(h, s("", 0), pageOf([pick, tag])), "the later write");
    expect(later).toMatchObject({ state: null, page: true });
    const undone = present(undoTextEdit(later.history, s("", 0), pageOf([pick])), "the pick");
    expect(undone).toMatchObject({ state: s("/tag"), page: true });
    // Made again in order: the pick, then the later write.
    const redone = present(
      redoTextEdit(undone.history, s("/tag"), pageOf([], [tag, pick])),
      "pick",
    );
    expect(redone).toMatchObject({ state: s("", 0), page: true });
    const last = present(redoTextEdit(redone.history, s("", 0), pageOf([pick], [tag])), "write");
    expect(last).toMatchObject({ state: null, page: true });
  });

  it("leaves alone what the page wrote before the row was edited, and passes over a pick it took back elsewhere", () => {
    const before = { before: true };
    const pick = { pick: true };
    const h = recordPageStep(emptyTextHistory(before), s("#to"), s("", 0), pick);
    // The page's undo took the pick back already: the row's step for it is passed over.
    expect(undoTextEdit(h, s("#to"), pageOf([before], [pick]))).toBeNull();
    expect(undoTextEdit(emptyTextHistory(before), s("x"), pageOf([before]))).toBeNull();
  });
});
