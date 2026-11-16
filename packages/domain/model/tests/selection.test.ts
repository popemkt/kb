import { describe, expect, test } from "bun:test";
import { selectionRoots } from "@kb/model";

const parents: Record<string, string | null> = { a: null, b: "a", c: "b", d: null, e: "d" };
const parentOf = (id: string) => parents[id];

describe("selectionRoots", () => {
  test("a selected row under another selected row goes with it", () => {
    expect(selectionRoots(["a", "c", "d", "e"], parentOf)).toEqual(["a", "d"]);
  });

  test("keeps the order given, each id once", () => {
    expect(selectionRoots(["e", "c", "e"], parentOf)).toEqual(["e", "c"]);
  });

  test("a cycle in the parents does not loop", () => {
    expect(selectionRoots(["x"], (id) => (id === "x" ? "y" : "x"))).toEqual(["x"]);
  });
});
