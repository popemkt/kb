/**
 * A row moves anywhere (DESIGN-UI.md → Outline editor, "A row moves
 * anywhere"): `PageWrites.moveNodes` puts the rows under a parent at a
 * place, in order, as one write the shared actions apply, one undo taking
 * it back; with references left, each row's old place holds one.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_IDS, siblingSlots } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import { REF_SEED_WIRES } from "@/fixtures/contextual-ref";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { rankedFixture } from "@/test-support/ranked-fixture";

function seed() {
  resetOutlineStore();
  useGraphStore
    .getState()
    .hydrateFromWire(
      [...rankedFixture(), ...structuredClone(REF_SEED_WIRES)],
      fixtureGraph.rev,
      "fixtures",
    );
}

/** The ids under `parent` (null: the top level), in order, as the store holds them. */
const under = (parent: string | null): string[] =>
  siblingSlots(useGraphStore.getState().wireNodes, parent).map((node) => node.id);

/** The top-level rows the fixture draws, in order: its content, not its schema. */
const ROWS = ["n.root-a", "n.root-b", "n.root-c"];
const rows = (): string[] => under(null).filter((id) => ROWS.includes(id));

/** What the reference `id` points at. */
const targetOf = (id: string): unknown =>
  useGraphStore.getState().index?.getNode(id)?.props[SYSTEM_IDS.refTargetField]?.[0]?.v;

describe("moving rows anywhere", () => {
  beforeEach(seed);

  it("puts the rows at the end of the node picked, in order, and one undo takes them back", async () => {
    expect(await mutations.moveNodes(["n.root-b", "n.root-c"], { parent: "n.root-a" })).toEqual({
      references: [],
    });
    expect(under("n.root-a")).toEqual(["n.child-a1", "n.child-a2", "n.root-b", "n.root-c"]);
    expect(rows()).toEqual(["n.root-a"]);

    await mutations.undo();
    expect(under("n.root-a")).toEqual(["n.child-a1", "n.child-a2"]);
    expect(rows()).toEqual(ROWS);

    await mutations.redo();
    expect(under("n.root-a")).toEqual(["n.child-a1", "n.child-a2", "n.root-b", "n.root-c"]);
  });

  it("puts them first, or after a sibling, in the group they are in or another", async () => {
    await mutations.moveNodes(["n.child-a2"], { parent: "n.root-a", after: null });
    expect(under("n.root-a")).toEqual(["n.child-a2", "n.child-a1"]);

    // Down in their own group: after a sibling below them.
    await mutations.moveNodes(["n.root-a", "n.root-b"], { parent: null, after: "n.root-c" });
    expect(rows()).toEqual(["n.root-c", "n.root-a", "n.root-b"]);

    // Into another group, after a row in it, the subtree going along.
    await mutations.moveNodes(["n.child-a2"], { parent: "n.root-c", after: null });
    expect(under("n.root-c")).toEqual(["n.child-a2"]);
    expect(under("n.child-a2")).toEqual(["n.grandchild"]);
  });

  it("leaves a reference to each row where it was, in the same write", async () => {
    const made = await mutations.moveNodes(["n.root-b"], { parent: "n.root-a" }, true);
    const [reference = ""] = made?.references ?? [];
    expect(under("n.root-a")).toEqual(["n.child-a1", "n.child-a2", "n.root-b"]);
    expect(rows().length).toBe(2);
    const top = under(null).filter((id) => id === reference || ROWS.includes(id));
    expect(top).toEqual(["n.root-a", reference, "n.root-c"]);
    expect(targetOf(reference)).toBe("n.root-b");

    // One undo takes the move and the reference back.
    await mutations.undo();
    expect(useGraphStore.getState().index?.getNode(reference)).toBeUndefined();
    expect(rows()).toEqual(ROWS);
  });

  it("leaves the reference in place when the row moves down its own group", async () => {
    const made = await mutations.moveNodes(["n.root-a"], { parent: null, after: "n.root-c" }, true);
    const [reference = ""] = made?.references ?? [];
    const top = under(null).filter((id) => id === reference || ROWS.includes(id));
    expect(top).toEqual([reference, "n.root-b", "n.root-c", "n.root-a"]);
  });

  it("moves nothing under a row it moves, nor rows already where they are", async () => {
    const before = structuredClone(useGraphStore.getState().wireNodes);
    expect(await mutations.moveNodes(["n.root-a"], { parent: "n.grandchild" })).toBeNull();
    expect(await mutations.moveNodes(["n.root-a"], { parent: "n.root-a" })).toBeNull();
    expect(await mutations.moveNodes(["n.child-a2"], { parent: "n.root-a" })).toBeNull();
    expect(
      await mutations.moveNodes(["n.child-a1"], { parent: "n.root-a", after: "n.missing" }),
    ).toBeNull();
    expect(useGraphStore.getState().wireNodes).toEqual(before);
    expect(await mutations.undo()).toBe(false);
  });
});
