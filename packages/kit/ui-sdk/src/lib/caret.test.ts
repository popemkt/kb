import { beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { mapOffset, offsetFromPoint } from "./caret";

beforeAll(() => {
  const dom = new Window();
  const g = globalThis as Record<string, unknown>;
  g.window = dom;
  g.document = dom.document;
  g.Node = dom.Node;
  g.HTMLElement = dom.HTMLElement;
});

describe("mapOffset", () => {
  it("maps a captured offset through a split instead of clamping it", () => {
    expect(mapOffset({ kind: "split", offset: 3, side: "right" }, 5)).toBe(2);
  });

  it("preserves a right-hand offset through a merge", () => {
    expect(mapOffset({ kind: "merge", leftLength: 3, source: "right" }, 2)).toBe(5);
  });
});

describe("offsetFromPoint", () => {
  it("calls caretRangeFromPoint bound to document", () => {
    const seen: unknown[] = [];
    const previous = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      writable: true,
      value: function caretRangeFromPoint(this: Document) {
        seen.push(this);
        return null;
      },
    });

    try {
      const el = document.createElement("div");
      offsetFromPoint(el, 0, 0);
      expect(seen).toEqual([document]);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(document, "caretRangeFromPoint");
      } else {
        Object.defineProperty(document, "caretRangeFromPoint", previous);
      }
    }
  });

  it("falls back to caretPositionFromPoint where caretRangeFromPoint is absent", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.append(el);
    const text = el.firstChild;
    const had = "caretRangeFromPoint" in document;
    const range = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
    const position = Object.getOwnPropertyDescriptor(document, "caretPositionFromPoint");
    if (had) Reflect.deleteProperty(document, "caretRangeFromPoint");
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      writable: true,
      value: () => ({ offsetNode: text, offset: 3 }),
    });
    try {
      expect("caretRangeFromPoint" in document).toBe(false);
      expect(offsetFromPoint(el, 0, 0)).toBe(3);
    } finally {
      el.remove();
      if (range !== undefined) Object.defineProperty(document, "caretRangeFromPoint", range);
      if (position === undefined) Reflect.deleteProperty(document, "caretPositionFromPoint");
      else Object.defineProperty(document, "caretPositionFromPoint", position);
    }
  });
});
