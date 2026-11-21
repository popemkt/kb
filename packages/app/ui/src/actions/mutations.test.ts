import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSET_MAX_BYTES } from "@kb/operations";
import { setPostAction, type ActionResponse } from "@/api/action";
import { tabSession } from "@/api/tab-session";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations } from "./mutations";
import { waitForBrowserPushes } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineNodes } from "@kb/outline-ui";

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
});
