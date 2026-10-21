/**
 * A `NodeIndex` is one contract with two implementations: the `NodeTable`
 * a host keeps beside a query engine that runs elsewhere, and the
 * `DatascriptIndex` that keeps its datoms over one. Driven by the same
 * transactions, every point read answers the same from both, and so does
 * the generation a reader keys its cache on.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, StoreTx } from "@kb/model";
import { DatascriptIndex, derivedWith, NodeTable, type NodeIndex } from "@kb/query";

const IDS = ["a", "b", "c", "d", "e", "f"] as const;

const nodeArb: fc.Arbitrary<KbNode> = fc.record({
  id: fc.constantFrom(...IDS),
  text: fc.oneof(
    fc.string({ maxLength: 6 }),
    fc.constantFrom(...IDS).map((id) => `see [[${id}]]`),
  ),
  children: fc.uniqueArray(fc.constantFrom(...IDS), { maxLength: 3 }),
  props: fc.dictionary(
    fc.constantFrom("f.one", "f.two"),
    fc.array(
      fc.oneof(
        fc.constantFrom(...IDS).map((v) => ({ t: "ref" as const, v })),
        fc.string({ maxLength: 4 }).map((v) => ({ t: "str" as const, v })),
      ),
      { minLength: 1, maxLength: 2 },
    ),
    { maxKeys: 2 },
  ),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
  updatedAt: fc.constant("2026-01-01T00:00:00.000Z"),
});

type Step =
  | { kind: "tx"; tx: StoreTx }
  | { kind: "rebuild"; nodes: KbNode[] }
  | { kind: "virtual"; nodes: KbNode[] };

const uniqueNodes = fc.uniqueArray(nodeArb, { selector: (n) => n.id, maxLength: 4 });

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("tx" as const),
      // Upserting and deleting one id in one transaction is outside what an index defines.
      tx: fc
        .record({
          upserts: uniqueNodes,
          deletes: fc.uniqueArray(fc.constantFrom(...IDS), { maxLength: 2 }),
        })
        .map(({ upserts, deletes }) => ({
          upserts,
          deletes: deletes.filter((id) => !upserts.some((n) => n.id === id)),
        })),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("rebuild" as const), nodes: uniqueNodes }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("virtual" as const), nodes: uniqueNodes }),
  },
);

function apply(index: NodeIndex, step: Step): void {
  if (step.kind === "tx") index.applyTx(step.tx);
  else if (step.kind === "rebuild") index.rebuild(step.nodes);
  else index.withVirtual(step.nodes);
}

/** Everything a point reader can ask, as one comparable value. */
function reads(index: NodeIndex) {
  return {
    generation: index.generation,
    stored: index.storedNodes().map((n) => n.id),
    all: [...index.allNodes()].map((n) => n.id),
    each: IDS.map((id) => index.getNode(id) ?? null),
    refs: [...index.allNodes()].map((n) => [...index.referencesOf(n)].toSorted()),
    search: index.search("[[", 3).map((n) => n.id),
  };
}

describe("NodeIndex contract", () => {
  test("NodeTable and DatascriptIndex answer every point read alike", () => {
    fc.assert(
      fc.property(uniqueNodes, fc.array(stepArb, { maxLength: 8 }), (start, steps) => {
        const derived = derivedWith({});
        const table = new NodeTable(start, derived);
        const index = new DatascriptIndex(start, { derived });
        expect(reads(table)).toEqual(reads(index));
        for (const step of steps) {
          apply(table, step);
          apply(index, step);
          expect(reads(table)).toEqual(reads(index));
        }
      }),
    );
  });

  test("a transaction that changes nothing keeps the generation", () => {
    const table = new NodeTable([], derivedWith({}));
    const before = table.generation;
    table.applyTx({ upserts: [], deletes: ["missing"] });
    expect(table.generation).toBe(before);
  });
});
