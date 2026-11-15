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
      expandedIds: new Set(),
    });

    expect((await runOptimistic(plan)).ok).toBe(true);
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.text).toBe("Ship");
    expect(useGraphStore.getState().index?.getNode("n.split")?.text).toBe(" kb ui shell");
    await waitForBrowserPushes();
    // The plan's node writes go as one write (DESIGN.md → Batches of writes).
    expect(calls).toEqual([
      {
        id: "node.batch",
        input: { calls: plan.actions.map(({ id, input }) => ({ action: id, input })) },
        session: tabSession(),
      },
    ]);
  });

  it("sends each run of several node writes as one batch, and every other action in its place", () => {
    const define = { id: "tag.define", input: { name: "t" } };
    expect(oneWrite([update("a")])).toEqual([update("a")]);
    expect(oneWrite([define, update("a"), update("b"), define, update("c")])).toEqual([
      define,
      {
        id: "node.batch",
        input: {
          calls: [
            { action: "node.update", input: update("a").input },
            { action: "node.update", input: update("b").input },
          ],
        },
      },
      define,
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
});
