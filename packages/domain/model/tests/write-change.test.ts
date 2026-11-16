/**
 * What a write changes, as a person reads it (`write-change.ts`): its name,
 * its parts with their exact before and after, and the diff that makes
 * whitespace show.
 */
import { describe, expect, test } from "bun:test";
import { textDiff, visibleText, writeChange, type KbNode, type NodeId } from "../src/index.ts";

const AT = "2026-11-16T00:00:00.000Z";
const LATER = "2026-11-17T00:00:00.000Z";

function node(id: string, text: string, extra: Partial<KbNode> = {}): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const graph = (...nodes: KbNode[]) => {
  const byId = new Map(nodes.map((held) => [held.id, held]));
  return (id: NodeId) => byId.get(id);
};

describe("writeChange", () => {
  test("a changed text is one part, its exact before and after; the timestamps are not parts", () => {
    const before = node("a", "Trailing\n");
    const after = { ...before, text: "Trailing", updatedAt: LATER };
    expect(writeChange({ before, after }, graph(before))).toEqual({
      id: "a",
      name: "Trailing",
      kind: "change",
      parts: [{ part: "text", label: "Text", before: "Trailing\n", after: "Trailing" }],
    });
  });

  test("a field is labelled by its name, and a reference reads as its target's name", () => {
    const field = node("f.status", "Status");
    const todo = node("o.todo", "Todo");
    const done = node("o.done", "Done");
    const before = node("a", "Task", { props: { "f.status": [{ t: "ref", v: "o.todo" }] } });
    const after = {
      ...before,
      props: { "f.status": [{ t: "ref", v: "o.done" } as const, { t: "num", v: 3 } as const] },
    };
    const change = writeChange({ before, after }, graph(field, todo, done, before));
    expect(change.parts).toEqual([
      { part: "f.status", label: "Status", before: "Todo", after: "Done, 3" },
    ]);
  });

  test("a create has nothing before and is named as it will read; a delete as it read", () => {
    const created = node("new", "Fresh", { props: { "f.x": [{ t: "str", v: "1" }] } });
    expect(writeChange({ before: undefined, after: created }, graph())).toEqual({
      id: "new",
      name: "Fresh",
      kind: "create",
      parts: [
        { part: "text", label: "Text", before: null, after: "Fresh" },
        { part: "f.x", label: "f.x", before: null, after: "1" },
      ],
    });
    const gone = node("old", "Gone");
    const deleted = writeChange({ before: gone, after: undefined }, graph(gone));
    expect(deleted.kind).toBe("delete");
    expect(deleted.name).toBe("Gone");
    expect(deleted.parts).toEqual([{ part: "text", label: "Text", before: "Gone", after: null }]);
  });

  test("children are a part, by their names", () => {
    const one = node("c1", "One");
    const two = node("c2", "Two");
    const before = node("p", "Parent", { children: ["c1"] });
    const after = { ...before, children: ["c1", "c2"] };
    expect(writeChange({ before, after }, graph(one, two, before)).parts).toEqual([
      { part: "children", label: "Children", before: "One", after: "One, Two" },
    ]);
  });
});

describe("textDiff and visibleText", () => {
  test("a trailing line break is the removed span, and draws as ⏎", () => {
    const spans = textDiff("going on now\n", "going on now");
    expect(spans).toEqual([
      { kind: "same", text: "going on now" },
      { kind: "removed", text: "\n" },
    ]);
    expect(visibleText(spans[1]?.text ?? "")).toBe("⏎");
  });

  test("long shared text keeps only the context nearest the change", () => {
    const head = "x".repeat(50);
    expect(textDiff(`${head}A${head}`, `${head}B${head}`, 4)).toEqual([
      { kind: "same", text: "…xxxx" },
      { kind: "removed", text: "A" },
      { kind: "added", text: "B" },
      { kind: "same", text: "xxxx…" },
    ]);
  });

  test("a side that is null is no value: the other side is all change", () => {
    expect(textDiff(null, "new")).toEqual([{ kind: "added", text: "new" }]);
    expect(textDiff("old", null)).toEqual([{ kind: "removed", text: "old" }]);
  });

  test("a space shows only where the caller says, breaks and tabs always", () => {
    expect(visibleText("a b\tc\n")).toBe("a b⇥c⏎");
    expect(visibleText("a\r\n")).toBe("a␍⏎");
    expect(visibleText("a b", true)).toBe("a·b");
  });

  test("a change splits no character in two", () => {
    expect(textDiff("👍🏽a", "👍🏽b")).toEqual([
      { kind: "same", text: "👍🏽" },
      { kind: "removed", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });
});
