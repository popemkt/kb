/**
 * `node.merge` is one write: the other node takes the merged one's text and
 * children, and the merged one goes, in one transaction, so the commit
 * takes all of it or none (`persistEffect`). Made as several actions, a
 * refusal of a later one left the earlier ones written.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function opened() {
  const root = await mkdtemp(join(tmpdir(), "kb-node-merge-"));
  roots.push(root);
  await mkdir(join(root, ".kb"), { recursive: true });
  resetRegistryCache();
  const ctx = await openKb(root);
  const call = async (id: string, input: Record<string, unknown>) => {
    const receipt = await invoke(ctx, { id, input });
    if (receipt.status !== "succeeded") throw new Error(`${id}: ${receipt.message}`);
  };
  await call("node.add", { id: "n.target", text: "target" });
  await call("node.add", { id: "n.kept", text: "kept", parent: "n.target" });
  await call("node.add", { id: "n.source", text: " source" });
  await call("node.add", { id: "n.a", text: "a", parent: "n.source" });
  await call("node.add", { id: "n.b", text: "b", parent: "n.source" });
  const node = (id: string) => ctx.nodes.find((n) => n.id === id);
  return { ctx, call, node };
}

test("takes the text and the children after the other's, and deletes the merged node, in one transaction", async () => {
  const { ctx, node } = await opened();
  const head = ctx.log.head;
  const receipt = await invoke(ctx, {
    id: "node.merge",
    input: { id: "n.source", into: "n.target" },
  });
  expect(receipt.status).toBe("succeeded");
  expect(ctx.log.head).toBe(head + 1);
  expect(node("n.target")?.text).toBe("target source");
  expect(node("n.target")?.children).toEqual(["n.kept", "n.a", "n.b"]);
  const ranks = ["n.kept", "n.a", "n.b"].map((id) => node(id)?.order ?? "");
  expect(ranks.toSorted()).toEqual(ranks);
  expect(node("n.source")).toBeUndefined();
});

test("is refused whole when the commit refuses any part of it", async () => {
  const { ctx, node } = await opened();
  // Merging a system node away deletes it, which is its owner's alone: the
  // text and children the other would take are refused with it.
  const head = ctx.log.head;
  const receipt = await invoke(ctx, {
    id: "node.merge",
    input: { id: "sys.field", into: "n.target" },
  });
  expect(receipt).toMatchObject({ status: "failed", code: "forbidden" });
  expect(ctx.log.head).toBe(head);
  expect(node("n.target")?.text).toBe("target");
  expect(node("n.target")?.children).toEqual(["n.kept"]);
  expect(node("sys.field")).toBeDefined();
});

test("moves a system node it holds as a placement would, keeping its rank", async () => {
  const { call, node } = await opened();
  // A system node under a person's node, as only its owner's force puts it:
  // the merge moves it after the other's children, which keeps its rank.
  await call("node.update", { id: "sys.field", parent: "n.source", force: true });
  const rank = node("sys.field")?.order;
  await call("node.merge", { id: "n.source", into: "n.target" });
  expect(node("n.target")?.text).toBe("target source");
  expect(node("n.target")?.children.at(-1)).toBe("sys.field");
  expect(node("sys.field")?.order).toBe(rank);
});

test("refuses a merge into the node itself or its own descendant", async () => {
  const { ctx } = await opened();
  for (const into of ["n.source", "n.a"]) {
    const receipt = await invoke(ctx, { id: "node.merge", input: { id: "n.source", into } });
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_move" });
  }
});
