/**
 * One contract, every port: a `RemoteIndex` answers what a `DatascriptIndex`
 * driven by the same mutations answers, whether its engine runs in this
 * thread or in a worker, and a run that overruns its budget answers
 * `over-budget`, never rows. Over a worker the run is also stopped, and the
 * engine started again over the node set the host holds.
 */
import { afterEach, describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, StoreTx } from "@kb/model";
import {
  DatascriptIndex,
  derivedWith,
  type EnginePort,
  type FromEngine,
  inThreadPort,
  type QueryAnswer,
  RemoteIndex,
  type Timers,
} from "@kb/query";

const timers: Timers = {
  set: (run, ms) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

const PORTS: Record<string, () => EnginePort> = {
  "in thread": () => inThreadPort(derivedWith({}), () => performance.now(), queueMicrotask),
  worker: () => {
    const worker = new Worker(new URL("./fixtures/engine-worker.ts", import.meta.url).href);
    return {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no origin
      send: (message) => worker.postMessage(message),
      listen: (hear, failed) => {
        worker.addEventListener("message", (event: MessageEvent<FromEngine>) => hear(event.data));
        worker.addEventListener("error", failed);
      },
      terminate: () => worker.terminate(),
    };
  },
};

const open: RemoteIndex[] = [];
afterEach(() => {
  for (const index of open.splice(0)) index.close();
});

function node(id: string, children: string[] = []): KbNode {
  return {
    id,
    text: id,
    props: {},
    children,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const IDS = "[:find ?id :where [?n :node/id ?id]]";
const CHILDREN = "[:find ?p ?c :where [?n :node/child ?k] [?n :node/id ?p] [?k :node/id ?c]]";

function sorted(answer: QueryAnswer): string[] {
  if (answer.kind !== "rows") return [answer.kind];
  return answer.rows.map((row) => row.join(" ")).toSorted();
}

const txArb: fc.Arbitrary<StoreTx> = fc
  .record({
    upserts: fc.uniqueArray(
      fc.record({
        id: fc.constantFrom("a", "b", "c", "d"),
        children: fc.uniqueArray(fc.constantFrom("a", "b", "c", "d"), { maxLength: 2 }),
      }),
      { selector: (n) => n.id, maxLength: 3 },
    ),
    deletes: fc.uniqueArray(fc.constantFrom("a", "b", "c", "d"), { maxLength: 2 }),
  })
  .map(({ upserts, deletes }) => ({
    upserts: upserts.map((n) =>
      node(
        n.id,
        n.children.filter((c) => c !== n.id),
      ),
    ),
    deletes: deletes.filter((id) => !upserts.some((n) => n.id === id)),
  }));

for (const [name, spawn] of Object.entries(PORTS)) {
  describe(`RemoteIndex over a port ${name}`, () => {
    test("answers as an in-process index driven by the same transactions", async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(txArb, { maxLength: 5 }), async (txs) => {
          const remote = new RemoteIndex([], derivedWith({}), spawn, timers);
          open.push(remote);
          const local = new DatascriptIndex([], { derived: derivedWith({}) });
          for (const tx of txs) {
            remote.applyTx(tx);
            local.applyTx(tx);
          }
          const answer = await remote.transport.run({ edn: CHILDREN, budgetMs: 10_000 });
          expect(sorted(answer)).toEqual(
            local
              .runDatalog(CHILDREN)
              .map((row) => row.join(" "))
              .toSorted(),
          );
          expect(answer.generation).toBe(remote.generation);
        }),
        { numRuns: name === "worker" ? 10 : 50 },
      );
    });

    test("a refused query is an error answer naming what the engine threw", async () => {
      const remote = new RemoteIndex([node("a")], derivedWith({}), spawn, timers);
      open.push(remote);
      const answer = await remote.transport.run({
        edn: "[:find ?x :where [?y :node/id ?z]]",
        budgetMs: 10_000,
      });
      expect(answer.kind === "error" ? answer.name : answer.kind).toBe("DatalogError");
    });

    test("a run that overruns its budget answers over-budget, and the engine answers after", async () => {
      // A chain long enough that walking it all takes longer than no time at all.
      const chain = Array.from({ length: 40 }, (_, i) =>
        node(`n${i}`, i < 39 ? [`n${i + 1}`] : []),
      );
      const remote = new RemoteIndex(chain, derivedWith({}), spawn, timers);
      open.push(remote);
      const slow = await remote.transport.run({
        edn: "[:find ?a ?b :where [?x :node/id ?a] (reach ?x :node/child ?y) [?y :node/id ?b]]",
        budgetMs: 0,
      });
      expect(slow.kind).toBe("over-budget");
      const after = await remote.transport.run({ edn: IDS, budgetMs: 10_000 });
      expect(sorted(after)).toHaveLength(40);
    });
  });
}

test("over a worker an overrun is stopped, and the engine is started again", async () => {
  const chain = Array.from({ length: 220 }, (_, i) => node(`n${i}`, i < 219 ? [`n${i + 1}`] : []));
  const remote = new RemoteIndex(
    chain,
    derivedWith({}),
    PORTS.worker ??
      (() => {
        throw new Error("no worker port");
      }),
    timers,
  );
  open.push(remote);
  const asked = performance.now();
  const slow = await remote.transport.run({
    edn: "[:find ?a ?b :where [?x :node/id ?a] (reach ?x :node/child ?y) [?y :node/id ?b]]",
    budgetMs: 50,
  });
  expect(slow.kind).toBe("over-budget");
  // Stopped at its budget, not when the walk would have ended.
  expect(performance.now() - asked).toBeLessThan(2_000);
  expect(remote.restarts).toBe(1);
});
