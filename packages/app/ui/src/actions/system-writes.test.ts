/**
 * The page writes a system node as any surface does: the commit decides
 * (`personWriteRefusal`, DESIGN.md → Data model → write protection). A
 * person's label and additions land; what the owner ships is refused, with
 * the commit's reason as the toast; and a gesture whose last step would be
 * refused is refused before its first lands.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { present, SYSTEM_IDS } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import type { WireNode } from "@kb/contracts";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useUiStore } from "@/stores/ui.store";
import { cloneWire } from "@/lib/tx";
import { createTransientNode, outlineNodes } from "@kb/outline-ui";
import { CollectionTableView } from "@kb/collections";

const AT = "2026-08-08T05:00:00.000Z";
const toasts = () => useUiStore.getState().toasts.map((t) => t.text);

const wireNode = (id: string, text: string): WireNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
});

/** The text of the node the merge regression merges into. */
const reviewTargetText = () => present(outlineNodes().get("review.target"), "review.target").text;

/** The fixture with `nodes` in it, each replacing the fixture's node of its id. */
function hydrateWith(...nodes: WireNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  const kept = fixtureGraph.nodes.filter((node) => !ids.has(node.id));
  useGraphStore
    .getState()
    .hydrateFromWire([...structuredClone(kept), ...nodes], fixtureGraph.rev, "fixtures");
}

/** The fixture with a person's row `id` under `sys.tag`, after what it ships. */
function withChildUnderSysTag(id: string): void {
  const sysTag = cloneWire(present(outlineNodes().get("sys.tag"), "sys.tag"));
  sysTag.children = [...sysTag.children, id];
  hydrateWith(sysTag, wireNode(id, "child"));
}

describe("the page writes a system node through the commit", () => {
  beforeEach(() => {
    resetOutlineStore();
    useUiStore.setState({ toasts: [] });
    useGraphStore
      .getState()
      .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
  });

  it("takes a person's label for a system node", async () => {
    await mutations.updateNodeContent("sys.tag", "Kinds");
    expect(present(outlineNodes().get("sys.tag"), "sys.tag").text).toBe("Kinds");
    expect(toasts()).toEqual([]);
  });

  it("refuses deleting a system node, with the commit's reason", async () => {
    await mutations.deleteNode("sys.field");
    expect(outlineNodes().has("sys.field")).toBe(true);
    expect(toasts().some((text) => text.includes("sys.field is its owner's to delete"))).toBe(true);
  });

  it("takes a person's child under a system node, at the end and after a person's row", async () => {
    const shipped = present(outlineNodes().get("sys.f.query"), "sys.f.query").children;
    const made = await createTransientNode("sys.f.query", null);
    expect(made).not.toBeNull();
    expect(present(outlineNodes().get("sys.f.query"), "sys.f.query").children).toEqual([
      ...shipped,
      made,
    ]);

    withChildUnderSysTag("n.under-sys");
    const before = present(outlineNodes().get("sys.tag"), "sys.tag").children;
    await mutations.createNodeAfter("n.under-sys");
    const after = present(outlineNodes().get("sys.tag"), "sys.tag").children;
    expect(after).toEqual([...before, expect.any(String)]);
  });

  it("refuses a merge that would delete a system node whole: none of it lands", async () => {
    withChildUnderSysTag("n.before-sys");
    const before = present(outlineNodes().get("n.before-sys"), "n.before-sys").text;
    await mutations.mergeNextIntoThis("n.before-sys", "sys.field");
    expect(present(outlineNodes().get("n.before-sys"), "n.before-sys").text).toBe(before);
    expect(outlineNodes().has("sys.field")).toBe(true);
    expect(toasts().some((text) => text.includes("sys.field is its owner's to delete"))).toBe(true);
  });

  it("merges a person's node holding a system node whole, or refuses it whole", async () => {
    // A system node under a person's node, as only its owner's force puts it
    // (its seeded parent's edge removed, so the tree stays one tree), at a
    // rank of its own.
    const arrange = (targetChildren: WireNode[]) => {
      const field = {
        ...cloneWire(present(outlineNodes().get("sys.field"), "sys.field")),
        order: "m",
      };
      const parents = fixtureGraph.nodes
        .filter((node) => node.children.includes(field.id))
        .map((node) => ({
          ...cloneWire(node),
          children: node.children.filter((id) => id !== field.id),
        }));
      const source = { ...wireNode("review.source", " source"), children: [field.id] };
      const target = {
        ...wireNode("review.target", "target"),
        children: targetChildren.map((child) => child.id),
      };
      hydrateWith(...parents, field, source, target, ...targetChildren);
    };

    // Its rank fits after the other's children, so the commit takes all of it.
    arrange([]);
    await mutations.mergeNextIntoThis("review.target", "review.source");
    expect(reviewTargetText()).toBe("target source");
    expect(outlineNodes().has("review.source")).toBe(false);
    expect(present(outlineNodes().get("review.target"), "review.target").children).toEqual([
      "sys.field",
    ]);

    // Its rank would have to change to follow them, so the commit refuses all of it.
    arrange([{ ...wireNode("review.after", "after"), order: "t" }]);
    useUiStore.setState({ toasts: [] });
    await mutations.mergeNextIntoThis("review.target", "review.source");
    expect(reviewTargetText()).toBe("target");
    expect(outlineNodes().has("review.source")).toBe(true);
    expect(toasts().some((t) => t.includes("sys.field keeps the rank its owner gave it"))).toBe(
      true,
    );
  });

  it("refuses a view a system frame cannot name before minting its view node", async () => {
    hydrateWith(wireNode(SYSTEM_IDS.viewsList, "Views"));
    const count = useGraphStore.getState().wireNodes.length;
    await mutations.setFrameView("sys.tag", CollectionTableView);
    expect(useGraphStore.getState().wireNodes).toHaveLength(count);
    expect(toasts().some((text) => text.includes(`${SYSTEM_IDS.viewsField} on sys.tag`))).toBe(
      true,
    );
    // A person's frame names its new view node as it always has.
    await mutations.setFrameView("n.root-a", CollectionTableView);
    expect(useGraphStore.getState().wireNodes).toHaveLength(count + 1);
  });

  it("writes a person's node as it always has", async () => {
    await mutations.updateNodeContent("n.root-c", "edited");
    expect(present(outlineNodes().get("n.root-c"), "n.root-c").text).toBe("edited");
    const parent = present(outlineNodes().get("n.root-a"), "n.root-a");
    await mutations.createNodeAfter("n.child-a1");
    const after = present(outlineNodes().get("n.root-a"), "n.root-a").children;
    expect(after).toEqual(["n.child-a1", expect.any(String), ...parent.children.slice(1)]);
  });
});
