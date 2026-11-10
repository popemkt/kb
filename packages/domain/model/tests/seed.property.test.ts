/**
 * Seed idempotence (fast-check): src/foundation/seed.ts's ensureSystemSeed.
 * Applied to an already-seeded store it is a no-op, and its fill-absent pass
 * fills only genuinely missing prop keys — a present value, even one a user
 * modified away from the fresh default, is never rewritten.
 *
 * The additive lists (`ADDITIVE_FIELDS`: a tag's template and what it
 * extends) are the one exception, and a deliberate one: the seed unions what
 * it ships into a present list, so a value the store holds is kept and the
 * seed's missing ones follow it. The set is imported, not restated.
 */
import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import fc from "fast-check";
import type { KbNode, PropValue } from "../src/model.ts";
import { ensureSystemSeed } from "../src/seed.ts";
import { ADDITIVE_FIELDS } from "../src/system-write.ts";
import { bundledFold, bundledSeed } from "@kb/bundled";

const AT = "2026-08-24T00:00:00.000Z";
const CANDIDATE_IDS = bundledSeed(AT).map((n) => n.id);

describe("seed idempotence properties (fast-check)", () => {
  test("ensureSystemSeed over the pristine seed is a no-op", () => {
    const seed = bundledSeed(AT);
    const result = ensureSystemSeed(seed, bundledFold());
    expect(result.seeded).toBe(false);
    expect(result.deletes).toEqual([]);
    expect(result.nodes).toEqual(seed);
  });

  test("the fill-absent pass fills only genuinely absent keys, and never rewrites a present (even user-modified) value", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...CANDIDATE_IDS), { minLength: 1, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
        (selectedIds, keepFlags) => {
          const baseSeed = bundledSeed(AT);
          const baseById = new Map(baseSeed.map((n) => [n.id, n]));
          const selected = new Set(selectedIds);
          let flagIdx = 0;

          const existingNodes: KbNode[] = baseSeed.map((node) => {
            if (!selected.has(node.id)) return node;
            const nextProps: Record<string, PropValue[]> = {};
            for (const key of Object.keys(node.props)) {
              const keep = present(
                keepFlags[flagIdx++ % keepFlags.length],
                "expected keepFlags[flagIdx++ % keepFlags.length]",
              );
              // Keep the key with a value that DIFFERS from the fresh default
              // (a user edit), or drop it entirely (an older, unmigrated store).
              if (keep) nextProps[key] = [{ t: "str", v: `__sentinel-${flagIdx}__` }];
            }
            return { ...node, props: nextProps };
          });

          const result = ensureSystemSeed(existingNodes, bundledFold());
          const resultById = new Map(result.nodes.map((n) => [n.id, n]));

          for (const id of selectedIds) {
            const before = present(
              existingNodes.find((n) => n.id === id),
              "expected existingNodes.find((n) => n.id === id)",
            );
            const after = present(resultById.get(id), "expected resultById.get(id)");
            const fresh = present(baseById.get(id), "expected baseById.get(id)");

            for (const key of Object.keys(before.props)) {
              const kept = before.props[key] ?? [];
              // An additive list keeps what it held, then gains each seeded ref it lacks.
              const missing = ADDITIVE_FIELDS.has(key)
                ? (fresh.props[key] ?? []).filter((v) => !kept.some((k) => k.v === v.v))
                : [];
              expect(after.props[key]).toEqual([...kept, ...missing]);
            }
            for (const key of Object.keys(fresh.props)) {
              if (!(key in before.props)) {
                expect(after.props[key]).toEqual(fresh.props[key]);
              }
            }
          }

          const second = ensureSystemSeed(result.nodes, bundledFold());
          expect(second.seeded).toBe(false);
          expect(second.nodes).toEqual(result.nodes);
        },
      ),
      { numRuns: 500 },
    );
  });
});
