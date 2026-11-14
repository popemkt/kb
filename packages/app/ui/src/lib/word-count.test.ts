/**
 * Count words (DESIGN-UI.md → Outline editor, "What rows hold, read and
 * copied"): the nodes the rows show and every node under them, each once,
 * read as plain words, and said as its toast says it.
 */
import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { type OutlineNode, schemaOfGraph } from "@kb/ui-sdk";
import { countWords, sayCount } from "./word-count";

const AT = "2026-11-14T00:00:00.000Z";

function node(
  id: string,
  text: string,
  children: string[] = [],
  props: WireNode["props"] = {},
): OutlineNode {
  return {
    id,
    text,
    parentId: null,
    children,
    collapsed: false,
    props,
    createdAt: AT,
    updatedAt: AT,
    tags: [],
  };
}

const refTo = (target: string): WireNode["props"] => ({
  [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: target }],
});

const schema = schemaOfGraph(
  new Map(
    [
      node("plan", "**Garden** plan", ["beds", "ref.notes"]),
      // Collapsed or not, a child is under the row.
      { ...node("beds", "Two raised beds", ["soil"]), collapsed: true },
      node("soil", "Loam and [compost](https://example.com)"),
      node("ref.notes", "", [], refTo("notes")),
      node("notes", "See [[plan|the plan]] first", ["notes.child"]),
      node("notes.child", "never reached through the reference"),
      node("cjk", "東京で会いましょう"),
      node("emoji", "Go 👍🏽"),
    ].map((n) => [n.id, n]),
  ),
);

describe("Count words", () => {
  it("counts the row and every node under it, in plain words", () => {
    expect(countWords(["beds"], schema)).toEqual({ words: 6, characters: 31, nodes: 2 });
  });

  it("counts a reference row as the node it shows, and does not follow it below", () => {
    // plan (2 words) + beds (3) + soil (3) + notes, its reference read as its label (4).
    expect(countWords(["plan"], schema)).toEqual({ words: 12, characters: 60, nodes: 4 });
  });

  it("counts a node met twice once", () => {
    expect(countWords(["plan", "beds", "soil"], schema).nodes).toBe(4);
    // A referenced node selected itself is walked below, its own children counted.
    expect(countWords(["plan", "notes"], schema).nodes).toBe(5);
  });

  it("counts the words of a language written without spaces, and an emoji as one character", () => {
    expect(countWords(["cjk"], schema).words).toBeGreaterThan(1);
    expect(countWords(["emoji"], schema)).toEqual({ words: 1, characters: 4, nodes: 1 });
  });

  it("is said as its toast says it, one thing singular and many grouped", () => {
    expect(sayCount({ words: 1, characters: 1204, nodes: 2 })).toBe(
      "1 word · 1,204 characters · 2 nodes",
    );
  });
});
