import { expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { DatascriptIndex, derivedWith } from "@kb/query";
import { FtsTextCandidates } from "../src/text-candidates.ts";

function node(id: string, text: string, props: KbNode["props"] = {}): KbNode {
  const at = "2026-11-18T00:00:00.000Z";
  return { id, text, props, children: [], createdAt: at, updatedAt: at };
}

test("indexed search preserves literal matching, id order, and live projection changes", () => {
  const tag = node("kind", "task", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.tagTitleField]: [{ t: "str", v: "[[sys.f.node.text]] for [[f.who]]" }],
  });
  const task = node("task", "ship", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: tag.id }],
    "f.who": [{ t: "ref", v: "owner" }],
  });
  const nodes = [
    node("z", 'a QUOTED "one" OR two Ωß雪🙂'),
    node("\uD800", 'a quoted "one" or two'),
    node("b", 'a quoted "one" or two with a\0b and \uD800xyz'),
    node("owner", "Ann"),
    node("meet", "meet [[owner]] *soon*"),
    tag,
    task,
    ...Array.from({ length: 550 }, (_, i) =>
      node("dense." + String(549 - i).padStart(3, "0"), "common substring"),
    ),
  ];
  const options = { derived: derivedWith({}) };
  const candidates = new FtsTextCandidates();
  const scan = new DatascriptIndex(nodes, options);
  const indexed = new DatascriptIndex(nodes, { ...options, textCandidates: candidates });

  try {
    const both = (needle: string, expected?: string[], limit?: number): void => {
      const ids = (index: DatascriptIndex) => index.search(needle, limit).map((hit) => hit.id);
      if (expected !== undefined) expect(ids(scan)).toEqual(expected);
      expect(ids(indexed)).toEqual(ids(scan));
    };

    both('quoted "one" OR two', ["b", "z"], 2);
    const supportsTrigrams = candidates.supports("quoted");
    both('quoted "one" OR two', ["b", "z"], 2);
    expect(candidates.supports("quoted")).toBe(supportsTrigrams);
    both("common substring", ["dense.000", "dense.001"], 2);
    expect(candidates.find("common substring")).toBeUndefined();
    both("Ωß雪", ["z"]);
    both("🙂", ["z"]);
    both("\0b", ["b"]);
    both("\uD800xyz", ["b"]);
    both("xyz", ["b"]);
    both("\uFFFDxyz", []);
    both("for ann", ["task"]);
    // A reference reads as its target's name, emphasis as its words.
    both("meet ann soon", ["meet"]);

    for (const index of [scan, indexed]) {
      index.applyTx({ upserts: [node("owner", "Mina")], deletes: ["z"] });
    }
    both("for ann", []);
    both("for mina", ["task"]);
    both("meet ann", []);
    both("meet mina soon", ["meet"]);
    both('quoted "one" OR two', ["b", "\uD800"]);

    for (const index of [scan, indexed]) {
      index.withVirtual([node("virtual", "A virtual query")]);
    }
    both("virtual", ["virtual"]);
    for (const index of [scan, indexed]) {
      index.applyTx({ upserts: [node("virtual", "stored caption")], deletes: ["owner"] });
    }
    both("virtual", []);
    both("stored", ["virtual"]);
    both("for mina", []);
  } finally {
    candidates.close();
  }
});
