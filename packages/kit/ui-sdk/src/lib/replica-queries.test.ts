import { describe, expect, it } from "vitest";
import type { KbNode } from "@kb/model";
import { answerOf, DatascriptIndex, derivedWith } from "@kb/query";
import {
  type QueryAnswer,
  type QueryRequest,
  type QueryTransport,
  ReplicaQueries,
} from "./replica-queries";

const clock = () => performance.now();

function node(id: string, text = id): KbNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const IDS = "[:find ?id :where [?n :node/id ?id]]";

/**
 * A transport over a real index whose answers the test releases by hand, so
 * it can see what the page holds while a query is out.
 */
function heldTransport(index: DatascriptIndex) {
  const out: Array<{ request: QueryRequest; release: () => void }> = [];
  const transport: QueryTransport = {
    run: (request) =>
      new Promise<QueryAnswer>((resolve) => {
        out.push({ request, release: () => resolve(answerOf(index, request, clock)) });
      }),
  };
  return {
    transport,
    out,
    releaseAll: async () => {
      for (const ask of out.splice(0)) ask.release();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const textOf = (id: string) =>
  `[:find ?t :where [?n :node/id ${JSON.stringify(id)}] [?n :node/text ?t]]`;

const turn = () => new Promise((r) => setTimeout(r, 0));

function idsOf(answer: QueryAnswer | null): string[] {
  if (answer?.kind !== "rows") return [];
  return answer.rows.map(([id]) => String(id)).toSorted();
}

describe("the page's query answers", () => {
  it("asks a query once however many read it before it is answered", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    const held = heldTransport(index);
    const queries = new ReplicaQueries(held.transport, () => index.generation);
    expect(queries.read(IDS)).toEqual({ answer: null, current: false });
    queries.read(IDS);
    queries.watch(IDS);
    await turn();
    expect(held.out).toHaveLength(1);
    await held.releaseAll();
    const read = queries.read(IDS);
    expect([idsOf(read.answer), read.current]).toEqual([["a"], true]);
  });

  it("keeps the last answer, not current, until the replica's next one arrives", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    const held = heldTransport(index);
    const queries = new ReplicaQueries(held.transport, () => index.generation);
    queries.watch(IDS);
    await turn();
    await held.releaseAll();
    index.applyTx({ upserts: [node("b")], deletes: [] });
    queries.moved();
    await turn();
    const stale = queries.read(IDS);
    expect([idsOf(stale.answer), stale.current]).toEqual([["a"], false]);
    expect(held.out).toHaveLength(1);
    await held.releaseAll();
    const fresh = queries.read(IDS);
    expect([idsOf(fresh.answer), fresh.current]).toEqual([["a", "b"], true]);
  });

  it("asks a query no one watches again only when it is read", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    const held = heldTransport(index);
    const queries = new ReplicaQueries(held.transport, () => index.generation);
    queries.read(IDS);
    await turn();
    await held.releaseAll();
    index.applyTx({ upserts: [node("b")], deletes: [] });
    queries.moved();
    await turn();
    expect(held.out).toHaveLength(0);
    queries.read(IDS);
    await turn();
    expect(held.out).toHaveLength(1);
  });

  it("a read is the same object until its answer or currency moves", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    const held = heldTransport(index);
    const queries = new ReplicaQueries(held.transport, () => index.generation);
    queries.read(IDS);
    await turn();
    await held.releaseAll();
    expect(queries.read(IDS)).toBe(queries.read(IDS));
  });

  it("a runner throws a refused query as the engine threw it", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    const queries = new ReplicaQueries(
      { run: async (request) => answerOf(index, request, clock) },
      () => index.generation,
    );
    const bad = "[:find ?x :where [?y :node/id ?z]]";
    await queries.ask(bad);
    expect(() => queries.runner()(bad)).toThrow(expect.objectContaining({ name: "DatalogError" }));
  });

  it("settles a reader that chains its queries, as an in-process runner reads it", async () => {
    const index = new DatascriptIndex([node("a", "b"), node("b", "c"), node("c", "done")], {
      derived: derivedWith({}),
    });
    const queries = new ReplicaQueries(
      { run: async (request) => answerOf(index, request, clock) },
      () => index.generation,
    );
    const follow = (run: (edn: string) => unknown[][]) => {
      const path = ["a"];
      for (let hop = 0; hop < 3; hop += 1) {
        const [row] = run(textOf(path.at(-1) ?? ""));
        if (row === undefined) break;
        path.push(String(row[0]));
      }
      return path;
    };
    const direct = follow((edn) => index.runDatalog(edn));
    expect(await queries.settle(follow)).toEqual(direct);
  });
});
