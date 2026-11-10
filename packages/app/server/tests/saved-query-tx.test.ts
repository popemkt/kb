/**
 * Saved queries reach a client the same way every other node does: as a
 * logged transaction.
 *
 * The red case is the shape this replaces (GAP `01M1QZNBFSTCM9V7DZT1XWEY2N`):
 * the virtual set was handed to the index once at hub construction and never
 * appeared in a frame, so a client catching up with `since` ended holding a
 * graph a fresh `/api/graph` disagreed with — a saved query added, renamed or
 * removed while it was behind stayed wrong until something made it refetch.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb, kbRuntimeLayer } from "@kb/runtime";
import { JsonlStore } from "@kb/store-jsonl";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import type { KbContext, ServerMessage } from "@kb/contracts";
import { ingestExternalWrite, ingestSavedQueries } from "../src/server.ts";
import { SavedQuerySet, listSavedQueries, savedQueryNodes } from "../src/saved-queries.ts";
import { SubscriptionHub } from "../src/session.ts";
import { PROGRAM } from "../src/guard.ts";

type TxFrame = Extract<ServerMessage, { op: "tx" }>;

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kb-saved-query-tx-"));
  await mkdir(join(dir, ".kb", "queries"), { recursive: true });
  return dir;
}

async function watcher(hub: SubscriptionHub, id: string): Promise<unknown[]> {
  const frames: unknown[] = [];
  await Effect.runPromise(
    hub.addClient(
      id,
      (text) =>
        Effect.sync(() => {
          frames.push(JSON.parse(text));
        }),
      PROGRAM,
    ),
  );
  await Effect.runPromise(hub.handleMessage(id, JSON.stringify({ op: "watch-tx", enabled: true })));
  return frames;
}

function txFrames(frames: unknown[]): TxFrame[] {
  return frames.filter((f): f is TxFrame => (f as { op?: string }).op === "tx");
}

function ingest(dir: string, ctx: KbContext, queries: SavedQuerySet): Promise<void> {
  return Effect.runPromise(
    ingestSavedQueries(dir, queries).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
}

/** Another process commits `ops` to the same store, and the server ingests it. */
async function externally(
  dir: string,
  ctx: KbContext,
  ops: Parameters<JsonlStore["commitEffect"]>[0],
) {
  await Effect.runPromise(
    new JsonlStore(dir).commitEffect(ops, { at: "2026-01-01T00:00:00.000Z" }),
  );
  await Effect.runPromise(
    ingestExternalWrite(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))) as Effect.Effect<void>,
  );
}

async function adopted(dir: string, ctx: KbContext): Promise<SavedQuerySet> {
  const queries = new SavedQuerySet(ctx);
  queries.adopt(savedQueryNodes(await listSavedQueries(dir)));
  return queries;
}

describe("saved queries are a logged transaction", () => {
  test("adding one appends a tx carrying the virtual nodes", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const queries = await adopted(dir, ctx);
      const client = await watcher(hub, "client-a");
      const before = ctx.log.head;

      await writeFile(join(dir, ".kb", "queries", "todos.edn"), "[:find ?id]\n");
      await ingest(dir, ctx, queries);

      expect(ctx.log.head).toBe(before + 1);
      const frame = txFrames(client).at(-1);
      // It says it is the virtual set's, so a client keeps it out of its store.
      expect(frame?.virtual).toBe(true);
      expect(hub.snapshot.virtual?.toSorted()).toEqual([SYSTEM_IDS.queriesRoot, "sys.query.todos"]);
      expect(frame?.upserts.map((n) => n.id).toSorted()).toEqual([
        SYSTEM_IDS.queriesRoot,
        "sys.query.todos",
      ]);
      // …and the index answers over them, so a fresh snapshot agrees with the
      // frame instead of only one of them being right.
      expect(ctx.index.getNode("sys.query.todos")?.text).toBe("todos");
      // The virtual nodes never reach the store.
      expect(ctx.nodes.some((n: KbNode) => n.id === "sys.query.todos")).toBe(false);

      // A second ingest over an unchanged directory spends no rev.
      await ingest(dir, ctx, queries);
      expect(ctx.log.head).toBe(before + 1);
      expect(txFrames(client)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removing one appends a tx that deletes it", async () => {
    const dir = await root();
    try {
      await writeFile(join(dir, ".kb", "queries", "todos.edn"), "[:find ?id]\n");
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const queries = await adopted(dir, ctx);
      const client = await watcher(hub, "client-a");
      expect(ctx.index.getNode("sys.query.todos")).not.toBeUndefined();

      await unlink(join(dir, ".kb", "queries", "todos.edn"));
      await ingest(dir, ctx, queries);

      const frame = txFrames(client).at(-1);
      expect(frame?.deletes.toSorted()).toEqual([SYSTEM_IDS.queriesRoot, "sys.query.todos"]);
      expect(ctx.index.getNode("sys.query.todos")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a client that fell behind is caught up with the virtual change", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const queries = await adopted(dir, ctx);
      const behind = ctx.log.head;

      await writeFile(join(dir, ".kb", "queries", "todos.edn"), "[:find ?id]\n");
      await ingest(dir, ctx, queries);

      // The whole point: `since` covers it, so the catch-up path and the
      // snapshot path end at the same graph.
      const client = await watcher(hub, "late");
      await Effect.runPromise(
        hub.handleMessage("late", JSON.stringify({ op: "since", rev: behind })),
      );
      const caught = txFrames(client);
      expect(caught).toHaveLength(1);
      expect(caught[0]?.upserts.map((n) => n.id)).toContain("sys.query.todos");
      expect(caught[0]?.virtual).toBe(true);
      expect(hub.snapshot.nodes.some((n) => n.id === "sys.query.todos")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a stored node keeps its id against its file's: the file's changes move nothing a client holds", async () => {
    const dir = await root();
    const file = join(dir, ".kb", "queries", "todos.edn");
    try {
      await writeFile(file, "[:find ?id]\n");
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const queries = await adopted(dir, ctx);
      const behind = ctx.log.head;
      const live = await watcher(hub, "live");

      // Another process stores a node under the file's id: the stored one wins.
      const stored: KbNode = {
        id: "sys.query.todos",
        text: "stored",
        props: {},
        children: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      await externally(dir, ctx, { upserts: [stored], deletes: [] });
      expect(ctx.index.isVirtual(stored.id)).toBe(false);

      // The file changes, then goes: neither frame touches the stored node.
      await writeFile(file, "[:find ?id ?text]\n");
      await ingest(dir, ctx, queries);
      await unlink(file);
      await ingest(dir, ctx, queries);
      const virtual = txFrames(live).filter((frame) => frame.virtual === true);
      expect(virtual.length).toBeGreaterThan(0);
      for (const frame of virtual) {
        expect(frame.upserts.map((n) => n.id)).not.toContain(stored.id);
        expect(frame.deletes).not.toContain(stored.id);
      }
      expect(ctx.index.getNode(stored.id)?.text).toBe("stored");
      expect(hub.snapshot.virtual).not.toContain(stored.id);

      // A client that catches up ends where the live one and a snapshot do.
      const late = await watcher(hub, "late");
      await Effect.runPromise(
        hub.handleMessage("late", JSON.stringify({ op: "since", rev: behind })),
      );
      expect(txFrames(late)).toEqual(txFrames(live));
      const caught = txFrames(late).reduce((held, frame) => {
        for (const id of frame.deletes) held.delete(id);
        for (const node of frame.upserts) held.set(node.id, node.text);
        return held;
      }, new Map<string, string>());
      expect(caught.get(stored.id)).toBe("stored");

      // Once the stored node goes, the file's comes back with the file's next change.
      await externally(dir, ctx, { upserts: [], deletes: [stored.id] });
      await writeFile(file, "[:find ?id]\n");
      await ingest(dir, ctx, queries);
      expect(ctx.index.isVirtual(stored.id)).toBe(true);
      const back = txFrames(live).at(-1);
      expect(back?.virtual).toBe(true);
      expect(back?.upserts.map((n) => n.id)).toContain(stored.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
