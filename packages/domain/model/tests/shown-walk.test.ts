import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, shownWalk, type NodeLike, type ShownRow } from "@kb/model";

const node = (id: string, children: string[] = [], target?: string): NodeLike => ({
  id,
  text: id,
  props: target === undefined ? {} : { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: target }] },
  children,
});

const graph = new Map(
  [
    node("a", ["b", "ref"]),
    node("b", ["c"]),
    node("c"),
    node("ref", [], "t"),
    node("t", ["t1"]),
    node("t1"),
    node("gone", [], "missing"),
  ].map((n) => [n.id, n]),
);

const shape = (rows: readonly ShownRow<NodeLike>[]): unknown =>
  rows.map(({ row, shown, children }) => [row.id, shown.id, shape(children)]);

describe("shownWalk", () => {
  test("a row reads as the node it shows, and a reference is a leaf", () => {
    expect(shape(shownWalk(["a"], (id) => graph.get(id)))).toEqual([
      [
        "a",
        "a",
        [
          ["b", "b", [["c", "c", []]]],
          ["ref", "t", []],
        ],
      ],
    ]);
  });

  test("a reference whose target is gone shows itself; an unknown id is left out", () => {
    expect(shape(shownWalk(["gone", "nowhere"], (id) => graph.get(id)))).toEqual([
      ["gone", "gone", []],
    ]);
  });

  test("a row is met once", () => {
    expect(shape(shownWalk(["b", "c"], (id) => graph.get(id)))).toEqual([
      ["b", "b", [["c", "c", []]]],
    ]);
  });
});
