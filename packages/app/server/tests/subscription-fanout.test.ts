/**
 * What one transaction costs the subscription hub.
 *
 * The UI opens a subscription per query node on screen, so the same board view
 * in three tabs is three subscriptions holding one query. A query's answer
 * depends on the index and not on who asked, so the hub owes the index one run
 * per distinct query per transaction — not one per subscription.
 *
 * Red case: move the evaluation back inside the per-subscription loop.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb } from "@kb/runtime";
import { DatascriptIndex, type KbIndex } from "@kb/query";
import { handleHttpRequest } from "../src/http.ts";
import { SubscriptionHub } from "../src/session.ts";
import { HTTP_WIRE, PROGRAM } from "../src/guard.ts";

const SHARED = "[:find ?id :where [?n :node/id ?id]]";
const OTHER = "[:find ?t :where [?n :node/text ?t]]";

/** Count runs of the index's datalog entry point without changing its behaviour. */
function countRuns(index: KbIndex): () => number {
  let runs = 0;
  const real = index.answerDatalog.bind(index);
  index.answerDatalog = (edn, ...inputs) => {
    runs += 1;
    return real(edn, ...inputs);
  };
  return () => runs;
}

describe("subscription fan-out", () => {
  test("one transaction runs each distinct query once, not once per subscriber", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kb-fanout-"));
    await mkdir(join(dir, ".kb"), { recursive: true });
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const frames: string[] = [];
      const send = (text: string) =>
        Effect.sync(() => {
          frames.push(text);
        });

      // Three subscriptions over two queries, spread across two clients.
      for (const clientId of ["c1", "c2"]) {
        await Effect.runPromise(hub.addClient(clientId, send, PROGRAM));
        await Effect.runPromise(
          hub.handleMessage(clientId, JSON.stringify({ op: "subscribe", id: "s", query: SHARED })),
        );
      }
      await Effect.runPromise(
        hub.handleMessage("c1", JSON.stringify({ op: "subscribe", id: "o", query: OTHER })),
      );

      if (!(ctx.index instanceof DatascriptIndex)) throw new Error("Expected a DataScript index");
      const reads = countRuns(ctx.index);
      const res = await handleHttpRequest(
        new Request("http://127.0.0.1/api/action", {
          method: "POST",
          body: JSON.stringify({ id: "node.add", input: { text: "edited", id: "n.edit" } }),
        }),
        HTTP_WIRE,
        { root: dir, page: "http://127.0.0.1:4321", ctx, hub },
      );
      expect(res.status).toBe(200);

      expect(reads()).toBe(2);

      // The shared answer still reaches both subscribers.
      const rows = frames
        .map((f) => JSON.parse(f) as { op: string; id?: string })
        .filter((f) => f.op === "rows" && f.id === "s");
      expect(rows).toHaveLength(4);

      const update = (text: string) =>
        handleHttpRequest(
          new Request("http://127.0.0.1/api/action", {
            method: "POST",
            body: JSON.stringify({ id: "node.update", input: { id: "n.edit", text } }),
          }),
          HTTP_WIRE,
          { root: dir, page: "http://127.0.0.1:4321", ctx, hub },
        );
      const runs = ctx.index.runs;
      const beforeUpdate = frames.length;
      expect((await update("changed")).status).toBe(200);
      expect(ctx.index.runs - runs).toBe(1);
      expect(frames.slice(beforeUpdate).map((frame) => JSON.parse(frame).id)).toEqual(["o"]);

      await Effect.runPromise(
        hub.handleMessage("c1", JSON.stringify({ op: "unsubscribe", id: "o" })),
      );
      await Effect.runPromise(hub.removeClient("c2"));
      const beforeUnsubscribedWrite = reads();
      expect((await update("changed again")).status).toBe(200);
      expect(reads() - beforeUnsubscribedWrite).toBe(1);
      hub.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
