import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { GALLERY_IDS, type GraphNode } from "@kb/gallery";
import { findNodes, looksFor, plainOf, seedOf } from "./node-model";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (
  id: string,
  text: string,
  children: string[] = [],
  props: GraphNode["props"] = {},
): GraphNode => ({ id, text, props, children });
const nodes = [
  n("story", "The **lighthouse** story", ["c1", "c2", "c3", "c4", "c5", "c6"]),
  n("c1", "- A keeper alone with [[ship|the ship]]"),
  n("c2", "![storm](assets/storm.png)"),
  n("c3", "Fog at [dawn](https://example.com)"),
  n("c4", "Gulls"),
  n("c5", "Rocks"),
  n("c6", "Never reached"),
  n("ship", "Ship"),
  n("sys.tag.lighthouse", "lighthouse tag"),
  n("look", "Lighthouse look", [], {
    [SYSTEM_IDS.typeField]: [ref(GALLERY_IDS.lookTag)],
    [GALLERY_IDS.forField]: [ref("story")],
  }),
  n("other-look", "Other", [], { [SYSTEM_IDS.typeField]: [ref(GALLERY_IDS.lookTag)] }),
];
const byId = new Map(nodes.map((node) => [node.id, node]));
const get = (id: string) => byId.get(id);

describe("finding the node a look is for", () => {
  it("matches text, leaving out system nodes and the gallery's own looks", () => {
    expect(findNodes(nodes, "LIGHTHOUSE").map((x) => x.id)).toEqual(["story"]);
    expect(findNodes(nodes, "  ")).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => n(`n${i}`, `note ${i}`));
    expect(findNodes(many, "note")).toHaveLength(50);
  });
});

describe("a node's words as a brief", () => {
  it("reads references by their labels and drops media and markup", () => {
    expect(plainOf("- A keeper alone with [[ship|the ship]]", get)).toBe(
      "A keeper alone with the ship",
    );
    expect(plainOf("with [[ship]] **now**", get)).toBe("with Ship now");
    expect(plainOf("![storm](assets/storm.png)", get)).toBe("");
    expect(plainOf("Fog at [dawn](https://example.com)", get)).toBe("Fog at dawn");
  });

  it("seeds from its text and its first children's, skipping the empty", () => {
    const story = get("story");
    if (story === undefined) throw new Error("fixture");
    expect(seedOf(story, get).split("\n")).toEqual([
      "The lighthouse story",
      "A keeper alone with the ship",
      "Fog at dawn",
      "Gulls",
      "Rocks",
    ]);
  });
});

describe("the looks made for a node", () => {
  it("are those whose for refers to it", () => {
    const looks = nodes.filter((x) => x.id.includes("look"));
    expect(looksFor(looks, "story", get).map((l) => l.id)).toEqual(["look"]);
  });
});
