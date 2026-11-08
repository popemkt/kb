/** The full query-index port owns replacing a runtime's derived definition. */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DatascriptIndex, derivedWith, type DerivedRef, type KbIndex } from "@kb/query";
const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const implementations: {
  name: string;
  make: (nodes: readonly KbNode[], derived: readonly DerivedRef[]) => KbIndex;
}[] = [{ name: "DataScript", make: (nodes, derived) => new DatascriptIndex(nodes, { derived }) }];
const mentions =
  "[:find ?id ?target :where [?n :node/id ?id] [?n :node/mentions ?t] [?t :node/id ?target]]";
const ordered = (rows: unknown[][]) => rows.map((row) => JSON.stringify(row)).toSorted();
for (const implementation of implementations)
  describe(`${implementation.name} full index definition contract`, () => {
    test("a changed definition refreshes point reads and cached answers, preserving stored and virtual nodes", () => {
      const first = node("a", { "f.carrier": [{ t: "str", v: "b" }] });
      const stored = [first, node("b"), node("c")];
      const virtual = node("virtual", { "f.carrier": [{ t: "str", v: "b" }] });
      const index = implementation.make(stored, derivedWith({}));
      index.withVirtual([virtual]);
      expect(index.runDatalog(mentions)).toEqual([]);
      expect(index.referencesOf(first)).not.toContain("b");
      const before = index.generation;
      const derived = derivedWith({
        fields: [{ field: "f.carrier", refsOf: (value) => (value.t === "str" ? [value.v] : []) }],
        owners: new Map([["a", "c"]]),
      });
      index.setDerived(derived);
      expect(index.generation).toBeGreaterThan(before);
      expect(index.storedNodes()).toEqual(stored);
      expect([...index.allNodes()]).toEqual([...stored, virtual]);
      expect(index.referencesOf(first)).toContain("b");
      expect(index.referencesOf(virtual)).toContain("b");
      expect(ordered(index.runDatalog(mentions))).toEqual(
        ordered([
          ["a", "b"],
          ["a", "c"],
          ["virtual", "b"],
        ]),
      );
      expect(
        index.runDatalog(
          '[:find ?owner :where [?n :node/id "a"] [?n :node/owner ?o] [?o :node/id ?owner]]',
        ),
      ).toEqual([["c"]]);
      index.applyTx({ upserts: [node("a", { "f.carrier": [{ t: "str", v: "c" }] })], deletes: [] });
      expect(ordered(index.runDatalog(mentions))).toEqual(
        ordered([
          ["a", "c"],
          ["virtual", "b"],
        ]),
      );
      index.setDerived(derivedWith({}));
      expect(index.runDatalog(mentions)).toEqual([]);
      expect(index.referencesOf(virtual)).not.toContain("b");
      expect(index.getNode("virtual")).toEqual(virtual);
    });
  });
