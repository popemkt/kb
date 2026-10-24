import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { derivedWith, queryBacklinks } from "@kb/ui-sdk";
import { DatascriptIndex } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import type { WireNode } from "@kb/contracts";

describe("queryBacklinks", () => {
  let nodes: WireNode[];

  beforeEach(() => {
    nodes = structuredClone(fixtureGraph.nodes);
    const a = present(
      nodes.find((n) => n.id === "n.root-b"),
      "n.root-b",
    );
    a.text = `See [[n.root-a|Ship]] for context`;
  });

  it("finds nodes that mention the target via :node/mentions", () => {
    const db = new DatascriptIndex(nodes, { derived: derivedWith({}) });
    const hits = queryBacklinks((edn) => db.runDatalog(edn), "n.root-a");
    expect(hits.map((h) => h.id)).toContain("n.root-b");
  });
});
