import { afterEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { tabSession } from "@/api/tab-session";
import { fixtureGraph } from "@/api/fixture-graph";
import { planSplit } from "./plan";
import { oneWrite, runOptimistic } from "./optimistic";
import { waitForBrowserPushes } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";

/** A text edit of `id`. */
const update = (id: string) => ({ id: "node.update", input: { id, text: id } });

describe("local action plans", () => {
  afterEach(() => setPostAction(null));

  it("runs multi-action plans locally in order and queues them as one batch", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const calls: unknown[] = [];
    setPostAction(async (invocation) => {
      calls.push(invocation);
      return { status: "succeeded", id: invocation.id, output: {}, rev: 2 };
    });
    const plan = planSplit(fixtureGraph.nodes, "n.root-a", 4, "n.split", {
      open: false,
    });

    expect((await runOptimistic(plan)).ok).toBe(true);
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("Ship");
    expect(useGraphStore.getState().index?.getNode("n.split")?.text).toBe(" kb ui shell");
    await waitForBrowserPushes();
    // The plan's node writes go as one write (DESIGN.md → Batches of writes).
    expect(calls).toEqual([
      {
        id: "node.batch",
        // The ids its local commit minted, so the server creates the same nodes.
        input: {
          calls: plan.actions.map(({ id, input }) => ({ action: id, input })),
          ids: ["n.root-a", "n.split"],
        },
        session: tabSession(),
      },
    ]);
  });

  it("sends each run of several node writes as one batch, and every other action in its place", () => {
    const merge = { id: "node.merge", input: { id: "x", into: "y" } };
    expect(oneWrite([update("a")])).toEqual([update("a")]);
    expect(oneWrite([merge, update("a"), update("b"), merge, update("c")])).toEqual([
      merge,
      {
        id: "node.batch",
        input: {
          calls: [
            { action: "node.update", input: update("a").input },
            { action: "node.update", input: update("b").input },
          ],
        },
      },
      merge,
      update("c"),
    ]);
  });

  it("fixture mode runs locally without pushing", async () => {
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");
    const post = vi.fn();
    setPostAction(post);
    const result = await runOptimistic({
      actions: [{ id: "node.update", input: { id: "n.root-a", text: "offline" } }],
    });
    expect(result.ok).toBe(true);
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("offline");
    expect(post).not.toHaveBeenCalled();
  });

  it("includes a new field's definition in the batch that uses it", () => {
    const definition = { id: "field.define", input: { id: "field.new", name: "New field" } };
    expect(oneWrite([definition, update("a")])).toEqual([
      {
        id: "node.batch",
        input: { calls: [definition, update("a")].map(({ id, input }) => ({ action: id, input })) },
      },
    ]);
  });
  it("includes a new tag's definition in the batch that tags with it", () => {
    const definition = { id: "tag.define", input: { id: "tag.new", name: "New tag" } };
    expect(oneWrite([definition, update("a")])).toEqual([
      {
        id: "node.batch",
        input: { calls: [definition, update("a")].map(({ id, input }) => ({ action: id, input })) },
      },
    ]);
  });
});
