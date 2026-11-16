import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import { OutlineListView, OutlineSnippetView, OutlineView } from "@kb/views";
import { viewKeyOfNode } from "./view-node";
import type { WireNode } from "@kb/contracts";
import { rowName, rowText, rowTitle } from "./contextual-ref";
import { schemaOf } from "./schema";

const naming = (option: string) => ({
  props: { [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: option }] },
});

describe("viewKeyOfNode", () => {
  const keys = [OutlineListView, OutlineSnippetView, OutlineView];

  it("finds the key whose option the view node names", () => {
    expect(viewKeyOfNode(naming(OutlineView.option), keys)).toBe(OutlineView);
    expect(viewKeyOfNode(naming(OutlineSnippetView.option), keys)).toBe(OutlineSnippetView);
  });

  it("finds none for a node that is no view node, or names a view not among the keys", () => {
    expect(viewKeyOfNode({ props: {} }, keys)).toBeNull();
    expect(viewKeyOfNode(naming("sys.view.graph.force3d"), keys)).toBeNull();
    expect(viewKeyOfNode(undefined, keys)).toBeNull();
  });
});

const refTo = (v: string) => ({ t: "ref" as const, v });

describe("a view node's row", () => {
  const ISO = "2026-11-16T00:00:00.000Z";
  const node = (id: string, text: string, props: WireNode["props"] = {}): WireNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
  });

  it("draws its view and the node it is a view of, never an empty bullet (DESIGN.md → View nodes)", () => {
    const schema = schemaOf({
      wireNodes: [
        node("sys.view.outline.table", "Table"),
        node("v.lib", "", { [SYSTEM_IDS.viewField]: [refTo("sys.view.outline.table")] }),
        node("v.lost", "", { [SYSTEM_IDS.viewField]: [refTo("sys.view.outline.table")] }),
        node("library", "Library", { [SYSTEM_IDS.viewsField]: [refTo("v.lib")] }),
      ],
    });
    const row = (id: string) => schema.get(id) ?? expect.unreachable(id);
    expect(rowTitle(row("v.lib"), schema)).toBe("Table · [[library]]");
    expect(rowName(row("v.lib"), schema)).toBe("Table · Library");
    // The row's text, the one an edit opens on, stays its own: empty.
    expect(rowText(row("v.lib"), schema)).toBe("");
    // No host names it: its view alone.
    expect(rowName(row("v.lost"), schema)).toBe("Table");
  });
});
