import { beforeEach, describe, expect, it } from "vitest";
import { parseInlineSource, present, SYSTEM_IDS } from "@kb/model";
import { derivedWith, queryBacklinks, schemaOf } from "@kb/ui-sdk";
import { DatascriptIndex } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import type { WireNode } from "@kb/contracts";
import { unlinkedMentionRows } from "@kb/outline-ui";

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

const row = (id: string, text: string, children: string[] = []): WireNode => ({
  id,
  text,
  props: {},
  children,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
});

describe("unlinkedMentionRows", () => {
  it("links a plain span even if earlier occurrences are inside inline markup", () => {
    const wireNodes = [
      row("n.spec", "Write spec"),
      row("n.code", "`write spec`"),
      row("n.bold", "**write spec**"),
      row("n.italic", "*write spec*"),
      row("n.link", "[write spec](https://example.com)"),
      row("n.mixed", "`write spec`, then WRITE SPEC"),
    ];
    const db = new DatascriptIndex(wireNodes, { derived: derivedWith({}) });
    const matches = unlinkedMentionRows(
      (edn) => db.runDatalog(edn),
      schemaOf({ wireNodes }),
      "n.spec",
    );
    expect(matches.map(({ node }) => node.id)).toEqual(["n.mixed"]);
    const linked = present(matches[0], "plain occurrence");
    expect(linked.linkedText).toBe("`write spec`, then [[n.spec|WRITE SPEC]]");
    expect(parseInlineSource(linked.linkedText).map(({ seg }) => seg)).toContainEqual({
      t: "ref",
      id: "n.spec",
      label: "WRITE SPEC",
    });
  });

  it("requires the title at word boundaries and excludes the target tree, existing edges and schema", () => {
    const schemaNode = row("n.schema", "Write spec");
    schemaNode.props[SYSTEM_IDS.typeField] = [{ t: "ref", v: SYSTEM_IDS.tag }];
    const wireNodes = [
      row("n.ancestor", "Write spec planning", ["n.parent"]),
      row("n.parent", "Write spec [[n.spec]]", ["n.spec"]),
      row("n.spec", "Write spec", ["n.child"]),
      row("n.child", "Write spec [[n.spec]]", ["n.grandchild"]),
      row("n.grandchild", "Write spec every day"),
      row("n.valid", "we should write spec soon"),
      row("n.plural", "we should write specs soon"),
      row("n.fused", "rewrite spec soon"),
      row("n.linked", "write spec is [[n.spec|here]]"),
      row("n.other-link", "we should [[n.other|write spec]] soon"),
      row("n.other", "An unrelated node"),
      row("sys.n.internal", "Write spec"),
      schemaNode,
      row("n.proto", "proto"),
      row("n.prototype", "prototype"),
      row("n.proto-match", "A proto."),
      row("n.short", "AI"),
      row("n.short-match", "Try AI"),
    ];
    const db = new DatascriptIndex(wireNodes, { derived: derivedWith({}) });
    const run = (edn: string) => db.runDatalog(edn);
    const schema = schemaOf({ wireNodes });
    const matches = unlinkedMentionRows(run, schema, "n.spec");
    expect(matches.map(({ node }) => node.id)).toEqual(["n.valid"]);
    expect(matches.map(({ linkedText }) => linkedText)).toEqual([
      "we should [[n.spec|write spec]] soon",
    ]);
    expect(unlinkedMentionRows(run, schema, "n.proto").map(({ node }) => node.id)).toEqual([
      "n.proto-match",
    ]);
    expect(unlinkedMentionRows(run, schema, "n.short")).toEqual([]);
  });
});
