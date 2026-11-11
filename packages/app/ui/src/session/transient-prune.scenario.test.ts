import { afterEach, expect, it } from "vitest";
import { createTransientNode } from "@kb/outline-ui";
import type { WireNode } from "@kb/contracts";
import { syncUiPlugins } from "@kb/ui-sdk";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { resetOutlineStore } from "@/test-support/outline-store";
import { fixtureGraph } from "@/api/fixture-graph";
import { setPostAction } from "@/api/action";
import { useGraphStore } from "@/stores/graph.store";
import {
  browserReplica,
  invokeLocal,
  resetPushLaneForTests,
  waitForBrowserPushes,
} from "./runtime";

afterEach(() => {
  setPostAction(null);
  syncUiPlugins([]);
  resetPushLaneForTests();
});
it("prunes an outgoing empty transient on the server and remains writable after confirming frames", async () => {
  resetOutlineStore();
  syncPagePlugins([outlineUiPlugin]);
  const nodes = structuredClone(fixtureGraph.nodes);
  const parent = nodes.find((n) => n.id === "n.root-a");
  if (parent === undefined) throw new Error("missing fixture parent");
  const anchor = parent.children[0];
  const server = new Map(nodes.map((n) => [n.id, n]));
  useGraphStore.getState().hydrateFromWire(nodes, 1, "api");
  useGraphStore.getState().zoomTo(parent.id);
  let rev = 1;
  const frames: { op: "tx"; rev: number; upserts: WireNode[]; deletes: string[] }[] = [];
  const sent: string[] = [];
  setPostAction(async (invocation) => {
    const input = invocation.input as { id: string; parent: string; after?: string; text?: string };
    sent.push(invocation.id);
    const deletes: string[] = [];
    const upserts: WireNode[] = [];
    if (invocation.id === "node.add") {
      const owner = server.get(input.parent);
      if (owner === undefined) throw new Error("missing server parent");
      const children = [...owner.children];
      children.splice(children.indexOf(input.after ?? "") + 1, 0, input.id);
      const row: WireNode = {
        id: input.id,
        text: input.text ?? "",
        props: {},
        children: [],
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt,
      };
      upserts.push({ ...owner, children }, row);
    } else if (invocation.id === "node.delete") {
      deletes.push(input.id);
      for (const owner of server.values())
        if (owner.children.includes(input.id))
          upserts.push({ ...owner, children: owner.children.filter((id) => id !== input.id) });
    }
    for (const row of upserts) server.set(row.id, row);
    for (const id of deletes) server.delete(id);
    frames.push({ op: "tx", rev: ++rev, upserts, deletes });
    return { status: "succeeded", id: invocation.id, output: {}, rev };
  });
  const x = await createTransientNode(parent.id, anchor ?? null);
  const z = await createTransientNode(parent.id, x);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await waitForBrowserPushes();
  for (const frame of frames) browserReplica()?.receive(frame);
  expect(sent).toEqual(["node.add", "node.add", "node.delete"]);
  expect(server.has(x ?? "")).toBe(false);
  expect(
    await invokeLocal({ id: "node.update", input: { id: z, text: "still writable" } }),
  ).toMatchObject({ status: "succeeded" });
});
