/**
 * A write plan reads the stored graph only: the index's virtual nodes (saved
 * queries materialised by `kb ui`) never reach the store, so `node.add`
 * neither files a node under one nor counts its id as taken; and a virtual
 * node is its source file's, so the commit refuses a person's write to one
 * and takes the owner's force.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const VIRTUAL = "sys.query.virtual-probe";

async function withVirtual() {
  const root = await mkdtemp(join(tmpdir(), "kb-virtual-"));
  roots.push(root);
  const ctx = await openKb(root);
  ctx.index.withVirtual([
    { id: VIRTUAL, text: "probe", props: {}, children: [], createdAt: "", updatedAt: "" },
  ]);
  expect(ctx.index.getNode(VIRTUAL)).toBeDefined();
  return ctx;
}

test("node.add refuses a virtual parent: it is not in the stored graph", async () => {
  const ctx = await withVirtual();
  const refused = await invoke(ctx, {
    id: "node.add",
    input: { text: "child", parent: VIRTUAL, force: true },
  });
  expect(refused).toMatchObject({ status: "failed", code: "not_found" });
});

test("node.add does not count a virtual id as taken", async () => {
  const ctx = await withVirtual();
  const added = await invoke(ctx, {
    id: "node.add",
    input: { text: "stored", id: VIRTUAL, force: true },
  });
  expect(added).toMatchObject({ status: "succeeded", output: { id: VIRTUAL } });
  expect(ctx.nodes.find((n) => n.id === VIRTUAL)?.text).toBe("stored");
});

test("a person's edit or delete of a virtual node is refused, and stores nothing", async () => {
  const ctx = await withVirtual();
  for (const request of [
    { id: "node.update", input: { id: VIRTUAL, text: "mine" } },
    { id: "node.delete", input: { id: VIRTUAL } },
  ]) {
    const refused = await invoke(ctx, request);
    expect(refused).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { rule: "virtual", id: VIRTUAL },
    });
  }
  expect(ctx.nodes.some((n) => n.id === VIRTUAL)).toBe(false);
  expect(ctx.index.getNode(VIRTUAL)?.text).toBe("probe");
});
