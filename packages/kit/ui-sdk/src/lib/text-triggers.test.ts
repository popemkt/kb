/**
 * The text's triggers (DESIGN-UI.md → Triggers in the text), as data: where
 * each opens, what it offers, and what a pick inserts in place of what was
 * typed for it.
 */
import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { NodeMap, OutlineNode } from "./types";
import { openTriggerAt, refTrigger } from "./text-triggers";

const node = (id: string, text: string): OutlineNode =>
  ({ id, text, parentId: null, children: [], props: {}, tags: [] }) as unknown as OutlineNode;

const nodes: NodeMap = new Map([
  ["n.alpha", node("n.alpha", "Alpha project")],
  ["n.beta", node("n.beta", "Beta notes")],
]);

describe("[[", () => {
  it("opens after its brackets, its query what follows them", () => {
    expect(refTrigger.open("See [[Alp", 9)).toEqual({ start: 4, end: 9, query: "Alp" });
    expect(refTrigger.open("See [[Alpha]] done", 18)).toBeNull();
    expect(refTrigger.open("No trigger", 10)).toBeNull();
  });

  it("offers the nodes matching its query", () => {
    expect(refTrigger.rows("alp", nodes).map((row) => row.id)).toEqual(["n.alpha"]);
  });

  it("inserts a reference for a pick, and closes its brackets with nothing to pick", async () => {
    const open = { start: 4, end: 9, query: "Alp" };
    const [row] = refTrigger.rows("alp", nodes);
    expect(await refTrigger.pick(present(row, "a row"), open)).toEqual({
      insert: "[[n.alpha|Alpha project]]",
    });
    expect(refTrigger.none?.(open)).toEqual({ insert: "[[Alp]]" });
  });
});

describe("the trigger open at the caret", () => {
  it("is the first of the table that opens there", () => {
    expect(openTriggerAt([refTrigger], "See [[Alp", 9)?.trigger.id).toBe("ref");
    expect(openTriggerAt([refTrigger], "See Alp", 7)).toBeNull();
  });
});
