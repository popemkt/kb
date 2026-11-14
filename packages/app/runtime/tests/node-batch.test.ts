/**
 * `node.batch` is one write of several node writes (DESIGN.md → Batches of
 * writes): each call planned over what the calls before it wrote, the whole
 * committed once, and refused whole. Its promises are the action's, not a
 * backend's, so they hold over every store backend.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { STORE_BACKENDS, createStore } from "../src/store-selection.ts";

describe.each([...STORE_BACKENDS])("node.batch over a %s store", (backend) => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-node-batch-"));
    await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
    resetRegistryCache();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function opened() {
    const ctx = await openKb(root);
    const call = async (id: string, input: Record<string, unknown>) => {
      const receipt = await invoke(ctx, { id, input });
      if (receipt.status !== "succeeded") throw new Error(`${id}: ${receipt.message}`);
      return receipt.output;
    };
    await call("node.add", { id: "n.dest", text: "dest", parent: null });
    await call("node.add", { id: "n.kept", text: "kept", parent: "n.dest" });
    await call("node.add", { id: "n.a", text: "a", parent: null });
    await call("node.add", { id: "n.b", text: "b", parent: null });
    await call("node.add", { id: "n.c", text: "c", parent: "n.b" });
    const node = (id: string) => ctx.nodes.find((n) => n.id === id);
    return { ctx, call, node };
  }

  test("plans each call over what the ones before it wrote, and commits them as one transaction", async () => {
    const { ctx, node } = await opened();
    const head = ctx.log.head;
    const receipt = await invoke(ctx, {
      id: "node.batch",
      input: {
        calls: [
          // Two moves into one parent, in order: the second sees the first.
          { action: "node.update", input: { id: "n.a", parent: "n.dest", position: 1 } },
          { action: "node.update", input: { id: "n.b", parent: "n.dest", position: 2 } },
          {
            action: "node.update",
            input: {
              id: "n.a",
              setProps: [{ field: "sys.f.type", value: { t: "ref", v: "sys.tag" } }],
            },
          },
          { action: "node.add", input: { id: "n.ref", text: "", parent: null } },
          { action: "node.delete", input: { id: "n.kept" } },
        ],
      },
    });
    expect(receipt).toMatchObject({
      status: "succeeded",
      output: { ids: ["n.a", "n.b", "n.a", "n.ref", "n.kept"] },
    });
    expect(ctx.log.head).toBe(head + 1);
    expect(node("n.dest")?.children).toEqual(["n.a", "n.b"]);
    expect(node("n.b")?.children).toEqual(["n.c"]);
    expect(node("n.a")?.props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: "sys.tag" }]);
    expect(node("n.ref")).toBeDefined();
    expect(node("n.kept")).toBeUndefined();
    const ranks = ["n.a", "n.b"].map((id) => node(id)?.order ?? "");
    expect(ranks.toSorted()).toEqual(ranks);
  });

  test("is refused whole, naming the call, when any call fails", async () => {
    const { ctx, node } = await opened();
    const head = ctx.log.head;
    const receipt = await invoke(ctx, {
      id: "node.batch",
      input: {
        calls: [
          { action: "node.update", input: { id: "n.a", text: "renamed" } },
          { action: "node.delete", input: { id: "n.a" } },
          // The node the call before deleted is gone for this one.
          { action: "node.update", input: { id: "n.a", text: "again" } },
        ],
      },
    });
    expect(receipt).toMatchObject({ status: "failed", code: "not_found" });
    expect(receipt.status === "failed" ? receipt.message : "").toStartWith("call 2:");
    expect(ctx.log.head).toBe(head);
    expect(node("n.a")?.text).toBe("a");
  });

  test("deletes nothing more for a node an earlier call already deleted, as node.delete does", async () => {
    const { ctx, node } = await opened();
    const head = ctx.log.head;
    const receipt = await invoke(ctx, {
      id: "node.batch",
      input: {
        calls: [
          // The parent takes its subtree with it; the child's own delete finds it gone.
          { action: "node.delete", input: { id: "n.b" } },
          { action: "node.delete", input: { id: "n.c" } },
        ],
      },
    });
    expect(receipt).toMatchObject({ status: "succeeded", output: { ids: ["n.b", "n.c"] } });
    expect(ctx.log.head).toBe(head + 1);
    expect(node("n.b")).toBeUndefined();
    expect(node("n.c")).toBeUndefined();
  });

  test("is refused whole when the commit refuses any part of it", async () => {
    const { ctx, node } = await opened();
    const head = ctx.log.head;
    const receipt = await invoke(ctx, {
      id: "node.batch",
      input: {
        calls: [
          { action: "node.update", input: { id: "n.a", text: "renamed" } },
          // A system node is its owner's to delete.
          { action: "node.delete", input: { id: "sys.field" } },
        ],
      },
    });
    expect(receipt).toMatchObject({ status: "failed", code: "forbidden" });
    expect(ctx.log.head).toBe(head);
    expect(node("n.a")?.text).toBe("a");
    expect(node("sys.field")).toBeDefined();
  });

  test("refuses a move of a node under its own subtree", async () => {
    const { ctx } = await opened();
    const receipt = await invoke(ctx, {
      id: "node.batch",
      input: { calls: [{ action: "node.update", input: { id: "n.b", parent: "n.c" } }] },
    });
    expect(receipt).toMatchObject({ status: "failed", code: "invalid_move" });
  });
});
