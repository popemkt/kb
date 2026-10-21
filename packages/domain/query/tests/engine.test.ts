/**
 * `answered` runs a synchronous reader against an engine that answers in
 * its own time. Whatever the reader does with its rows — chain one query on
 * the last one's answer, swallow a refused query as a warning — its value
 * is the one it reads with an in-process runner over the same index.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import fc from "fast-check";
import type { KbNode } from "@kb/model";
import { answered, DatascriptIndex, derivedWith, engineOf, type EdnRunner } from "@kb/query";

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

const childrenOf = (id: string) =>
  `[:find ?c :where [?p :node/id ${JSON.stringify(id)}] [?p :node/child ?k] [?k :node/id ?c]]`;

/** Walk down from `root` one query per level, and note each refusal instead of throwing. */
function descend(root: string, depth: number) {
  return (run: EdnRunner) => {
    const seen: string[] = [];
    const notes: string[] = [];
    let level = [root];
    for (let i = 0; i < depth; i += 1) {
      const next: string[] = [];
      for (const id of level) {
        try {
          for (const [c] of run(childrenOf(id))) if (typeof c === "string") next.push(c);
        } catch (err) {
          notes.push(err instanceof Error ? err.name : "thrown");
        }
      }
      seen.push(...next.toSorted());
      level = next;
    }
    try {
      run("[:find ?x :where [?x :no/such]] extra");
    } catch (err) {
      notes.push(err instanceof Error ? err.name : "thrown");
    }
    return { seen, notes };
  };
}

describe("answered", () => {
  test("reads as an in-process runner over the same index would", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 5 }), { minLength: 1, maxLength: 12 }),
        fc.nat({ max: 4 }),
        (parents, depth) => {
          // n(i+1) hangs under an earlier node, so the nodes are a tree rooted at n0.
          const kids = new Map<string, string[]>();
          for (const [i, p] of parents.entries()) {
            const parent = `n${p % (i + 1)}`;
            kids.set(parent, [...(kids.get(parent) ?? []), `n${i + 1}`]);
          }
          const ids = ["n0", ...parents.map((_, i) => `n${i + 1}`)];
          const index = new DatascriptIndex(
            ids.map((id) => node(id, kids.get(id) ?? [])),
            { derived: derivedWith({}) },
          );
          const read = descend("n0", depth);
          const direct = read((edn) => index.runDatalog(edn));
          const viaEngine = Effect.runSync(answered(read, engineOf(index)));
          expect(viaEngine).toEqual(direct);
        },
      ),
    );
  });

  test("a reader that never asks is read once", () => {
    let reads = 0;
    const value = Effect.runSync(
      answered(
        () => {
          reads += 1;
          return 7;
        },
        engineOf(new DatascriptIndex([], { derived: derivedWith({}) })),
      ),
    );
    expect([value, reads]).toEqual([7, 1]);
  });
});
