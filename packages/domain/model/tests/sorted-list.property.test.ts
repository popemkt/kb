/**
 * `SortedList` against the array it replaces: any sequence of inserts and
 * removes leaves it reading, by position, exactly as a sorted array would,
 * and each insert costs a logarithmic number of comparisons, counted.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { present } from "../src/present.ts";
import { SortedList } from "../src/sorted-list.ts";

interface Item {
  readonly key: number;
  readonly id: string;
}

const byKey = (a: Item, b: Item): number =>
  a.key - b.key || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const read = (list: SortedList<Item>): Item[] =>
  Array.from({ length: list.length }, (_, i) => list.at(i)).flatMap((item) => item ?? []);

describe("SortedList", () => {
  test("reads by position as a sorted array does, after any inserts and removes", () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant("insert" as const), key: fc.integer({ min: 0, max: 20 }) }),
      fc.record({ kind: fc.constant("remove" as const), pick: fc.nat() }),
    );
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 30 }),
        fc.array(op, { maxLength: 80 }),
        (initial, ops) => {
          let n = 0;
          const item = (key: number): Item => ({ key, id: `i${n++}` });
          let model = initial.map(item).toSorted(byKey);
          const list = new SortedList(byKey, model);
          for (const step of ops) {
            if (step.kind === "insert") {
              const added = item(step.key);
              list.insert(added);
              model = [...model, added].toSorted(byKey);
            } else if (model.length > 0) {
              const gone = model[step.pick % model.length];
              if (gone === undefined) continue;
              expect(list.remove(gone, (member) => member.id === gone.id)).toBe(true);
              model = model.filter((member) => member.id !== gone.id);
            }
            expect(list.length).toBe(model.length);
            expect(read(list)).toEqual(model);
          }
          const absent = item(10);
          expect(list.remove(absent, (member) => member.id === absent.id)).toBe(false);
          expect(list.lowerBound(absent)).toBe(model.filter((m) => byKey(m, absent) < 0).length);
        },
      ),
    );
  });

  test("an insert or a positional read costs O(log n) comparisons, not a move of the rest", () => {
    const counted = { n: 0 };
    const compare = (a: Item, b: Item): number => (counted.n++, byKey(a, b));
    const size = 100_000;
    const list = new SortedList(
      compare,
      Array.from({ length: size }, (_, i) => ({ key: 2 * i, id: `s${i}` })),
    );
    counted.n = 0;
    const inserts = 1000;
    for (let i = 0; i < inserts; i++)
      list.insert({ key: 2 * ((i * 7919) % size) + 1, id: `n${i}` });
    expect(list.length).toBe(size + inserts);
    // A treap's expected depth is about 2·ln n ≈ 3·log₂ n.
    expect(counted.n / inserts).toBeLessThan(4 * Math.log2(size));
    for (let i = 1; i < list.length; i++) {
      expect(byKey(present(list.at(i - 1), "prev"), present(list.at(i), "cur"))).toBeLessThan(0);
    }
  });
});
