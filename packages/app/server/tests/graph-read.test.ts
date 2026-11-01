/**
 * `GET /api/graph` is built once per state of the session: a second read of
 * an unchanged graph is the same bytes under the same entity tag, a client
 * holding that tag is answered `304`, and a write moves both.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb } from "@kb/runtime";
import { handleHttpRequest } from "../src/http.ts";
import { SubscriptionHub } from "../src/session.ts";
import { HTTP_WIRE } from "../src/guard.ts";

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kb-graph-read-"));
  await mkdir(join(dir, ".kb"), { recursive: true });
  return dir;
}

function get(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/api/graph", { headers });
}

describe("GET /api/graph", () => {
  test("is built once per state, revalidates to 304, and moves with a write", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, page: "http://127.0.0.1:4321", ctx, hub };
      const allNodes = spyOn(ctx.index, "allNodes");

      const first = await handleHttpRequest(get(), HTTP_WIRE, deps);
      const second = await handleHttpRequest(get(), HTTP_WIRE, deps);
      const tag = first.headers.get("etag");
      expect(tag).not.toBeNull();
      expect(second.headers.get("etag")).toBe(tag);
      expect(first.headers.get("cache-control")).toBe("no-cache");
      expect(await second.text()).toBe(await first.text());
      expect(allNodes).toHaveBeenCalledTimes(1);

      const held = await handleHttpRequest(get({ "if-none-match": tag ?? "" }), HTTP_WIRE, deps);
      expect(held.status).toBe(304);

      const added = await handleHttpRequest(
        new Request("http://127.0.0.1/api/action", {
          method: "POST",
          body: JSON.stringify({ id: "node.add", input: { text: "moved", id: "n.moved" } }),
        }),
        HTTP_WIRE,
        deps,
      );
      expect(((await added.json()) as { status: string }).status).toBe("succeeded");

      const after = await handleHttpRequest(get({ "if-none-match": tag ?? "" }), HTTP_WIRE, deps);
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(tag);
      const body = (await after.json()) as { rev: number; nodes: { id: string }[] };
      expect(body.rev).toBe(ctx.log.head);
      expect(body.nodes.some((n) => n.id === "n.moved")).toBe(true);
      allNodes.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
