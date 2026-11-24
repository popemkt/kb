import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreTx } from "@kb/model";
import type { TxRecord } from "@kb/contracts";
import { MemoryTxTail } from "@kb/tx-log";
import { ASSET_MAX_BYTES } from "@kb/operations";
import { setPostAction, type ActionResponse } from "@/api/action";
import { tabSession } from "@/api/tab-session";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations } from "./mutations";
import { waitForBrowserPushes } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineNodes } from "@kb/outline-ui";

/** The texts of the two rows the overlapping-commit tests edit. */
function shown(): (string | undefined)[] {
  return [outlineNodes().get("n.root-a")?.text, outlineNodes().get("n.root-b")?.text];
}

describe("mutations invoke shared actions", () => {
  const post = vi.fn(async (invocation) => ({
    status: "succeeded" as const,
    id: invocation.id,
    output: {},
    rev: 2,
  }));

  beforeEach(() => {
    post.mockClear();
    setPostAction(post);
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });

  it("indent sends one node.update and changes the local tree", async () => {
    await mutations.indentNodes(["n.child-a2"]);
    expect(outlineNodes().get("n.child-a1")?.children).toContain("n.child-a2");
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.child-a2", parent: "n.child-a1", position: 0 },
      session: tabSession(),
    });
  });

  it("an asset over the one limit is refused before it is read, and never sent", async () => {
    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: ASSET_MAX_BYTES + 1 });
    const read = vi.spyOn(huge, "arrayBuffer");
    expect(await mutations.uploadAsset(huge)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await waitForBrowserPushes();
    expect(post).not.toHaveBeenCalled();
  });

  it("property edits are applied through node.update", async () => {
    await mutations.updateProp("n.root-a", "sys.f.query", { t: "str", v: "[:find ?e]" });
    expect(useGraphStore.getState().index?.getNode("n.root-a")?.props["sys.f.query"]).toEqual([
      { t: "str", v: "[:find ?e]" },
    ]);
  });

  it("a conditional text write is one undo step only once the server takes it", async () => {
    // A Link from Unlinked mentions: written on the text it was read from.
    const id = "n.root-a";
    const source = outlineNodes().get(id)?.text ?? "";
    const reply = Promise.withResolvers<ActionResponse>();
    setPostAction(async (invocation) =>
      invocation.id === "node.update" ? reply.promise : post(invocation),
    );
    const written = mutations.setNodeText(id, `${source} linked`, source);
    await vi.waitFor(() => expect(outlineNodes().get(id)?.text).toBe(`${source} linked`));
    expect(useGraphStore.getState().undoStack).toHaveLength(0);
    // Another edit reached the server first: it refuses the write, so no undo
    // step can put back the text the write never replaced there.
    reply.resolve({
      status: "failed",
      id: "node.update",
      code: "conflict",
      message: "The text changed on the server",
    });
    expect(await written).toBe(false);
    await waitForBrowserPushes();
    expect(useGraphStore.getState().undoStack).toHaveLength(0);
    expect(await mutations.undo()).toBe(false);
  });

  it("a gesture holds only the writes made through it: another edit made meanwhile is its own step", async () => {
    const a = outlineNodes().get("n.root-a")?.text;
    const release = Promise.withResolvers<void>();
    const before = useGraphStore.getState().undoStack.length;
    // A / command that waits, then writes through its gesture's writes.
    const gesture = mutations.together(async (writes) => {
      await release.promise;
      await writes.setNodeText("n.root-a", "from the command");
      return writes;
    });
    // An edit made elsewhere in the tab while it waits.
    expect(await mutations.setNodeText("n.root-b", "made meanwhile")).toBe(true);
    expect(useGraphStore.getState().undoStack).toHaveLength(before + 1);
    release.resolve();
    const leaked = await gesture;
    expect(useGraphStore.getState().undoStack).toHaveLength(before + 2);
    // Undo takes back the command alone.
    await mutations.undo();
    expect(outlineNodes().get("n.root-a")?.text).toBe(a);
    expect(outlineNodes().get("n.root-b")?.text).toBe("made meanwhile");
    // A write through the gesture's handle after it ended is a write of its own.
    expect(leaked).not.toBeNull();
    expect(await leaked?.setNodeText("n.root-a", "after the gesture")).toBe(true);
    expect(outlineNodes().get("n.root-a")?.text).toBe("after the gesture");
    expect(useGraphStore.getState().undoStack).toHaveLength(before + 2);
  });

  it("overlapping commits each undo and redo only their own changes", async () => {
    const a = outlineNodes().get("n.root-a")?.text;
    const b = outlineNodes().get("n.root-b")?.text;
    const before = useGraphStore.getState().undoStack.length;
    // Start a gesture commit and a separate edit concurrently in the same tab.
    const [gesture, separate] = await Promise.all([
      mutations.together(async (writes) => {
        await writes.setNodeText("n.root-a", "from the gesture");
      }),
      mutations.setNodeText("n.root-b", "from the separate edit"),
    ]);
    expect(gesture).not.toBeNull();
    expect(separate).toBe(true);
    expect(useGraphStore.getState().undoStack).toHaveLength(before + 2);
    expect(outlineNodes().get("n.root-a")?.text).toBe("from the gesture");
    expect(outlineNodes().get("n.root-b")?.text).toBe("from the separate edit");
    // First Undo reverts only one step, leaving the other edit intact.
    expect(await mutations.undo()).toBe(true);
    const afterFirstUndo = [
      outlineNodes().get("n.root-a")?.text,
      outlineNodes().get("n.root-b")?.text,
    ];
    expect(
      (afterFirstUndo[0] === a && afterFirstUndo[1] === "from the separate edit") ||
        (afterFirstUndo[0] === "from the gesture" && afterFirstUndo[1] === b),
    ).toBe(true);
    // Redo puts that step back so both edits are present again.
    expect(await mutations.redo()).toBe(true);
    expect(outlineNodes().get("n.root-a")?.text).toBe("from the gesture");
    expect(outlineNodes().get("n.root-b")?.text).toBe("from the separate edit");
    // Two Undos revert both cleanly.
    expect(await mutations.undo()).toBe(true);
    expect(await mutations.undo()).toBe(true);
    expect(outlineNodes().get("n.root-a")?.text).toBe(a);
    expect(outlineNodes().get("n.root-b")?.text).toBe(b);
  });

  it("a commit that lands while another is recording stays out of the other's undo", async () => {
    const a = outlineNodes().get("n.root-a")?.text;
    const b = outlineNodes().get("n.root-b")?.text;
    const before = useGraphStore.getState().undoStack.length;
    // Force the interleaving the scheduler may choose: the first commit's
    // record waits, after its apply, until the second commit has landed.
    // A commit whose apply, record and snapshots are one synchronous section
    // never reaches this wait, so its snapshot cannot hold the second edit.
    const second = Promise.withResolvers<void>();
    let calls = 0;
    const spy = vi.spyOn(MemoryTxTail.prototype, "append").mockImplementation(function (
      this: MemoryTxTail,
      ops: StoreTx,
      rec: TxRecord,
    ) {
      calls += 1;
      const appended = Effect.sync(() => this.record(ops, rec));
      if (calls === 1) return Effect.promise(() => second.promise).pipe(Effect.andThen(appended));
      return appended.pipe(Effect.tap(() => Effect.sync(second.resolve)));
    });
    try {
      const first = mutations.setNodeText("n.root-a", "first, held while recording");
      const other = mutations.setNodeText("n.root-b", "second, landed in between");
      // With nothing held, nothing waits for the second commit to open the gate.
      setTimeout(second.resolve, 50);
      expect(await Promise.all([first, other])).toEqual([true, true]);
    } finally {
      spy.mockRestore();
    }
    expect(useGraphStore.getState().undoStack).toHaveLength(before + 2);
    const A = "first, held while recording";
    const B = "second, landed in between";
    // Each Undo reverts its own edit and nothing else: one node at a time.
    expect(await mutations.undo()).toBe(true);
    const once = shown();
    expect([JSON.stringify([a, B]), JSON.stringify([A, b])]).toContain(JSON.stringify(once));
    expect(await mutations.undo()).toBe(true);
    expect(shown()).toEqual([a, b]);
    // And each Redo puts back its own edit only, the one undone last first.
    expect(await mutations.redo()).toBe(true);
    expect(shown()).toEqual(once);
    expect(await mutations.redo()).toBe(true);
    expect(shown()).toEqual([A, B]);
  });
});
