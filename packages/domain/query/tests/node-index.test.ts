/**
 * A `NodeIndex` is one contract with two implementations: the `NodeTable`
 * a host keeps beside a query engine that runs elsewhere, and the
 * `DatascriptIndex` that keeps its datoms over one. Driven by the same
 * transactions, every point read answers the same from both, and so does
 * the generation a reader keys its cache on. A derived attribute's point
 * read (`related`) is what its datoms state.
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

/** Who seeds whom: `c` is its own, which a node never is (`ownerCarrier`). */
const OWNERS = new Map([
  ["a", "b"],
  ["c", "c"],
  ["d", "f"],
]);
const DERIVED_ATTRS = [":node/mentions", ":node/owner"] as const;

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
    virtual: IDS.map((id) => index.isVirtual(id)),
    refs: [...index.allNodes()].map((n) => [...index.referencesOf(n)].toSorted()),
    related: IDS.map((id) => DERIVED_ATTRS.map((attr) => index.related(id, attr))),
    search: index.search("[[", 3).map((n) => n.id),
  };
}

/** What `index`'s datalog says `id` points at by `attr`, sorted. */
const targets = (index: DatascriptIndex, id: string, attr: string) =>
  index
    .runDatalog(
      `[:find ?to :in $ ?id :where [?n :node/id ?id] [?n ${attr} ?t] [?t :node/id ?to]]`,
      id,
    )
    .map(([to]) => String(to))
    .toSorted();

describe("NodeIndex contract", () => {
  test("NodeTable and DatascriptIndex answer every point read alike", () => {
    fc.assert(
      fc.property(uniqueNodes, fc.array(stepArb, { maxLength: 8 }), (start, steps) => {
        const derived = derivedWith({ owners: OWNERS });
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

  test("a derived attribute's point read is what its datoms state", () => {
    fc.assert(
      fc.property(uniqueNodes, fc.array(stepArb, { maxLength: 8 }), (start, steps) => {
        const index = new DatascriptIndex(start, { derived: derivedWith({ owners: OWNERS }) });
        for (const step of steps) apply(index, step);
        for (const id of IDS)
          for (const attr of DERIVED_ATTRS)
            expect([...index.related(id, attr)].toSorted(), `${attr} of ${id}`).toEqual(
              targets(index, id, attr),
            );
        // Who seeds a node: one owner at most, never itself.
        for (const id of IDS)
          expect(index.related(id, ":node/owner").length).toBeLessThanOrEqual(1);
        expect(index.related("c", ":node/owner")).toEqual([]);
      }),
    );
  });

  test("a virtual node is one the index serves and does not store", () => {
    fc.assert(
      fc.property(uniqueNodes, fc.array(stepArb, { maxLength: 8 }), (start, steps) => {
        const table = new NodeTable(start, derivedWith({}));
        for (const step of steps) apply(table, step);
        const stored = new Set(table.storedNodes().map((n) => n.id));
        for (const id of IDS)
          expect(table.isVirtual(id)).toBe(table.getNode(id) !== undefined && !stored.has(id));
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
