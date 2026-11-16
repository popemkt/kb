/**
 * What a write changes, as a person reads it (`write-change.ts`): its name,
 * its parts with their exact values before and after, typed and by id, and
 * the diff that makes every difference show: whitespace, and two values
 * that read alike.
 */
import { describe, expect, test } from "bun:test";
import { partDiff, visibleText, writeChange, type KbNode, type NodeId } from "../src/index.ts";

const AT = "2026-11-16T00:00:00.000Z";
const LATER = "2026-11-17T00:00:00.000Z";

function node(id: string, text: string, extra: Partial<KbNode> = {}): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const graph = (...nodes: KbNode[]) => {
  const byId = new Map(nodes.map((held) => [held.id, held]));
  return (id: NodeId) => byId.get(id);
};

const str = (v: string) => ({ value: { t: "str", v } as const });
const ref = (v: string, name: string) => ({ value: { t: "ref", v } as const, name });

/** A part as `partDiff` draws it: `[-removed-]` and `{+added+}`, the rest as kept. */
function drawn(part: Parameters<typeof partDiff>[0]): string {
  return partDiff(part)
    .map((span) =>
      span.kind === "same"
        ? span.text
        : span.kind === "removed"
          ? `[-${span.text}-]`
          : `{+${span.text}+}`,
    )
    .join("");
}

/** The one part `write` changes. */
function onlyPart(change: ReturnType<typeof writeChange>): Parameters<typeof partDiff>[0] {
  expect(change.parts).toHaveLength(1);
  const [part] = change.parts;
  if (part === undefined) throw new Error("no part");
  return part;
}

describe("writeChange", () => {
  test("a changed text is one part, its exact values before and after; the timestamps are not parts", () => {
    const before = node("a", "Trailing\n");
    const after = { ...before, text: "Trailing", updatedAt: LATER };
    expect(writeChange({ before, after }, graph(before))).toEqual({
      id: "a",
      name: "Trailing",
      kind: "change",
      parts: [
        { part: "text", label: "Text", before: [str("Trailing\n")], after: [str("Trailing")] },
      ],
    });
  });

  test("a field keeps its values typed and by id, a reference with its target's name", () => {
    const field = node("f.status", "Status");
    const todo = node("o.todo", "Todo");
    const done = node("o.done", "Done");
    const before = node("a", "Task", { props: { "f.status": [{ t: "ref", v: "o.todo" }] } });
    const after = {
      ...before,
      props: { "f.status": [{ t: "ref", v: "o.done" } as const, { t: "num", v: 3 } as const] },
    };
    const part = onlyPart(writeChange({ before, after }, graph(field, todo, done, before)));
    expect(part).toEqual({
      part: "f.status",
      label: "Status",
      before: [ref("o.todo", "Todo")],
      after: [ref("o.done", "Done"), { value: { t: "num", v: 3 } }],
    });
    expect(drawn(part)).toBe("[-Todo-], {+Done+}, {+3+}");
  });

  test("a create has nothing before and is named as it will read; a delete as it read", () => {
    const created = node("new", "Fresh", { props: { "f.x": [{ t: "str", v: "1" }] } });
    expect(writeChange({ before: undefined, after: created }, graph())).toEqual({
      id: "new",
      name: "Fresh",
      kind: "create",
      parts: [
        { part: "text", label: "Text", before: [], after: [str("Fresh")] },
        { part: "f.x", label: "f.x", before: [], after: [str("1")] },
      ],
    });
    const gone = node("old", "Gone");
    const deleted = writeChange({ before: gone, after: undefined }, graph(gone));
    expect(deleted.kind).toBe("delete");
    expect(deleted.name).toBe("Gone");
    expect(deleted.parts).toEqual([
      { part: "text", label: "Text", before: [str("Gone")], after: [] },
    ]);
  });

  test("children are a part, each by id with its name", () => {
    const one = node("c1", "One");
    const two = node("c2", "Two");
    const before = node("p", "Parent", { children: ["c1"] });
    const after = { ...before, children: ["c1", "c2"] };
    const part = onlyPart(writeChange({ before, after }, graph(one, two, before)));
    expect(part).toEqual({
      part: "children",
      label: "Children",
      before: [ref("c1", "One")],
      after: [ref("c1", "One"), ref("c2", "Two")],
    });
    expect(drawn(part)).toBe("One, {+Two+}");
  });
});

describe("partDiff: every difference shows", () => {
  test("a reference moved between two nodes of one name shows both, each with its id", () => {
    const alex = node("p.alex1", "Alex");
    const other = node("p.alex2", "Alex");
    const before = node("a", "Meeting", { props: { "f.who": [{ t: "ref", v: "p.alex1" }] } });
    const after = { ...before, props: { "f.who": [{ t: "ref", v: "p.alex2" } as const] } };
    const part = onlyPart(writeChange({ before, after }, graph(alex, other, before)));
    expect(part.before).not.toEqual(part.after);
    expect(drawn(part)).toBe("[-Alex (p.alex1)-], {+Alex (p.alex2)+}");
  });

  test("children of one name, reordered, show the move", () => {
    const one = node("c1", "Same");
    const two = node("c2", "Same");
    const before = node("p", "Parent", { children: ["c1", "c2"] });
    const after = { ...before, children: ["c2", "c1"] };
    const part = onlyPart(writeChange({ before, after }, graph(one, two, before)));
    expect(drawn(part)).toBe("[-Same (c1)-], Same (c2), {+Same (c1)+}");
  });

  test("a value whose kind changes but not its words is told apart by its kind", () => {
    const part = {
      part: "f.n",
      label: "N",
      before: [{ value: { t: "num", v: 3 } as const }],
      after: [str("3")],
    };
    expect(drawn(part)).toBe("[-3 (number)-], {+3 (text)+}");
  });

  test('an empty value added or removed shows as ""', () => {
    expect(drawn({ part: "f.x", label: "X", before: [], after: [str("")] })).toBe('{+""+}');
    expect(drawn({ part: "f.x", label: "X", before: [str("")], after: [] })).toBe('[-""-]');
  });

  test("a list keeps its ends and marks only what changes, values joined by commas", () => {
    const part = {
      part: "f.tags",
      label: "Tags",
      before: [str("a"), str("b"), str("c")],
      after: [str("a"), str("x"), str("c"), str("d")],
    };
    expect(drawn(part)).toBe("a, [-b-], {+x+}, c, {+d+}");
    expect(drawn({ ...part, before: [], after: [] })).toBe("");
  });

  test("one text on each side is diffed by character, a trailing break the removed run", () => {
    const spans = partDiff({
      part: "text",
      label: "Text",
      before: [str("going on now\n")],
      after: [str("going on now")],
    });
    expect(spans).toEqual([
      { kind: "same", text: "going on now" },
      { kind: "removed", text: "\n" },
    ]);
    expect(visibleText(spans[1]?.text ?? "")).toBe("⏎");
  });

  test("long shared text keeps only the context nearest the change", () => {
    const head = "x".repeat(50);
    const part = {
      part: "text",
      label: "Text",
      before: [str(`${head}A${head}`)],
      after: [str(`${head}B${head}`)],
    };
    expect(partDiff(part, 4)).toEqual([
      { kind: "same", text: "…xxxx" },
      { kind: "removed", text: "A" },
      { kind: "added", text: "B" },
      { kind: "same", text: "xxxx…" },
    ]);
  });

  test("a change splits no character in two", () => {
    const part = { part: "text", label: "Text", before: [str("👍🏽a")], after: [str("👍🏽b")] };
    expect(partDiff(part)).toEqual([
      { kind: "same", text: "👍🏽" },
      { kind: "removed", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });
});

describe("visibleText", () => {
  test("a space shows only where the caller says, breaks and tabs always", () => {
    expect(visibleText("a b\tc\n")).toBe("a b⇥c⏎");
    expect(visibleText("a\r\n")).toBe("a␍⏎");
    expect(visibleText("a b", true)).toBe("a·b");
  });
});
