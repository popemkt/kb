/**
 * The condition model (`ir/conditions.ts`): the builder's three laws over the
 * IR — lower then lift is the identity on canonical conditions (property 4),
 * lift recognises up to renaming (5), lift loses nothing (6) — and, because a
 * row that lowers consistently wrong would round-trip perfectly, semantic
 * examples for every row: a small graph, the condition, and the nodes it must
 * answer, run through `compile` on kb's index from the EDN `printEdn` writes
 * (docs/brainstorms/2026-10-20-query-builder → How the round trip is guaranteed).
 */
import {
  DatascriptIndex,
  alphaEquivalent,
  canonicalConditions,
  derivedWith,
  isCanonicalIr,
  lift,
  lowerIr,
  parseEdn,
  printEdn,
  type Clause,
  type Condition,
  type IrQuery,
  type PredicateArg,
  type Term,
} from "@kb/query";
import type { ClockSample, KbNode, PropValue } from "@kb/model";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { canonicalIrArb } from "./canonical-arb.ts";
import { treeArb } from "./condition-arb.ts";

/* -------------------------------------------------------------------------- */
/* A small graph                                                               */
/* -------------------------------------------------------------------------- */

/** 2026-10-20T12:00:00Z, in UTC: today is the 20th. */
const NOW = Date.UTC(2026, 9, 20, 12);
const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, extra: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: extra.text ?? id,
    props: extra.props ?? {},
    children: extra.children ?? [],
    createdAt: extra.createdAt ?? AT,
    updatedAt: extra.updatedAt ?? AT,
  };
}

const ref = (v: string): PropValue => ({ t: "ref", v });
const s = (v: string): PropValue => ({ t: "str", v });
const num = (v: number): PropValue => ({ t: "num", v });

const NODES: KbNode[] = [
  node("tag.todo", { text: "todo" }),
  node("tag.bug", { text: "bug" }),
  node("s.doing", { text: "Doing" }),
  node("s.done", { text: "Done" }),
  node("a", {
    text: "Draft plan",
    children: ["a1", "a2"],
    createdAt: "2026-10-18T09:00:00.000Z",
    props: {
      "sys.f.type": [ref("tag.todo")],
      status: [ref("s.doing")],
      est: [num(3)],
      size: [num(3)],
      due: [s("2026-10-25")],
      note: [s("Ship it")],
    },
  }),
  node("b", {
    text: "retro notes",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    props: {
      "sys.f.type": [ref("tag.todo"), ref("tag.bug")],
      status: [ref("s.done"), ref("s.doing")],
      est: [num(5)],
      due: [s("2026-12-24")],
      note: [s("ship later")],
    },
  }),
  node("c", { text: "Other, see [[a]]" }),
  node("a1", { text: "step one", children: ["a11"] }),
  node("a11", { text: "Deep Step" }),
  node("a2", { text: "step two" }),
  node("d", { props: { due: [s("2026-10-15")], status: [ref("gone")] } }),
  node("e", { props: { status: [s("Doing")] } }),
  node("f", { props: { size: [s("3")] } }),
  node("g", { createdAt: "2026-10-21T00:00:00.000Z" }),
  node("h", { props: { due: [s("2026-11-03")] } }),
  node("k", { props: { owner: [ref("a1")] } }),
];

const ALL = NODES.map((n) => n.id).toSorted();
const except = (...ids: string[]) => ALL.filter((id) => !ids.includes(id));

const index = new DatascriptIndex(NODES, {
  derived: derivedWith({}),
  clock: (): ClockSample => ({ nowMs: NOW, timeZone: "UTC" }),
});

/** The ids `conditions` answer on the graph, run from the stored text their query prints as. */
function answer(conditions: readonly Condition[]): string[] {
  const edn = printEdn(lowerIr(conditions));
  return index
    .runDatalog(edn)
    .map((row) => String(row[0]))
    .toSorted();
}

/* -------------------------------------------------------------------------- */
/* Semantic examples, one or more per row                                      */
/* -------------------------------------------------------------------------- */

const todo: Condition = { kind: "has-tag", tag: "tag.todo" };

const EXAMPLES: [string, Condition[], string[]][] = [
  ["has tag", [todo], ["a", "b"]],
  ["does not have tag", [{ kind: "lacks-tag", tag: "tag.todo" }], except("a", "b")],
  ["field is set", [{ kind: "field-set", field: "status" }], ["a", "b", "d", "e"]],
  ["field is not set", [{ kind: "field-unset", field: "status" }], except("a", "b", "d", "e")],
  [
    "field is a node",
    [{ kind: "field-is", field: "status", values: [{ t: "ref", v: "s.done" }] }],
    ["b"],
  ],
  [
    "field is any of two nodes",
    [
      {
        kind: "field-is",
        field: "status",
        values: [
          { t: "ref", v: "s.done" },
          { t: "ref", v: "s.doing" },
        ],
      },
    ],
    ["a", "b"],
  ],
  ["field is a number", [{ kind: "field-is", field: "est", values: [{ t: "num", v: 3 }] }], ["a"]],
  [
    "field is a text",
    [{ kind: "field-is", field: "status", values: [{ t: "str", v: "Doing" }] }],
    ["e"],
  ],
  [
    "field is a label: a node's text, and a text",
    [{ kind: "field-is", field: "status", values: [{ t: "label", v: "Doing" }] }],
    ["a", "b", "e"],
  ],
  [
    "field is a label: a node's id",
    [{ kind: "field-is", field: "status", values: [{ t: "label", v: "s.done" }] }],
    ["b"],
  ],
  [
    "field is a label: a dangling ref's id",
    [{ kind: "field-is", field: "status", values: [{ t: "label", v: "gone" }] }],
    ["d"],
  ],
  [
    "field is a label: the number and the text it reads as",
    [{ kind: "field-is", field: "size", values: [{ t: "label", v: "3" }] }],
    ["a", "f"],
  ],
  [
    "field is not: keeps the absent, drops a multi-value that includes it",
    [{ kind: "field-is-not", field: "status", values: [{ t: "ref", v: "s.done" }] }],
    except("b"),
  ],
  [
    "field is not any of two: none of them",
    [
      {
        kind: "field-is-not",
        field: "status",
        values: [
          { t: "ref", v: "s.doing" },
          { t: "str", v: "Doing" },
        ],
      },
    ],
    except("a", "b", "e"),
  ],
  [
    "field contains, ignoring case",
    [{ kind: "field-contains", field: "note", text: "SHIP", exactCase: false }],
    ["a", "b"],
  ],
  [
    "field contains, exact case",
    [{ kind: "field-contains", field: "note", text: "Ship", exactCase: true }],
    ["a"],
  ],
  [
    "field contains is false for a number",
    [{ kind: "field-contains", field: "size", text: "3", exactCase: true }],
    ["f"],
  ],
  [
    "field compares a number",
    [{ kind: "field-compares", field: "est", op: ">", value: { t: "num", v: 4 } }],
    ["b"],
  ],
  [
    "field compares a civil date",
    [{ kind: "field-compares", field: "due", op: "<", value: { t: "str", v: "2026-11-01" } }],
    ["a", "d"],
  ],
  [
    "text contains, ignoring case",
    [{ kind: "text-contains", text: "STEP", exactCase: false }],
    ["a1", "a11", "a2"],
  ],
  [
    "text contains, exact case",
    [{ kind: "text-contains", text: "step", exactCase: true }],
    ["a1", "a2"],
  ],
  [
    "created in the last 7 days: not before, not in the future",
    [{ kind: "instant-within", attr: "created", days: 7 }],
    ["a"],
  ],
  ["edited in the last day", [{ kind: "instant-within", attr: "edited", days: 1 }], ["b"]],
  [
    "a date within the next 14 days: both ends, not overdue",
    [{ kind: "date-within", field: "due", direction: "next", days: 14 }],
    ["a", "h"],
  ],
  [
    "a date within the last 7 days",
    [{ kind: "date-within", field: "due", direction: "last", days: 7 }],
    ["d"],
  ],
  ["is under", [{ kind: "under", node: "a", via: { t: "child" } }], ["a1", "a11", "a2"]],
  [
    "is under, within one level",
    [{ kind: "under", node: "a", via: { t: "child" }, maxHops: 1 }],
    ["a1", "a2"],
  ],
  [
    "is under, via a ref field",
    [{ kind: "under", node: "k", via: { t: "field", field: "owner" } }],
    ["a1"],
  ],
  [
    "is under, via the reference relation",
    [{ kind: "under", node: "c", via: { t: "mentions" }, maxHops: 1 }],
    ["a"],
  ],
  ["is above", [{ kind: "above", node: "a11", via: { t: "child" } }], ["a", "a1"]],
  ["is a child of", [{ kind: "child-of", node: "a" }], ["a1", "a2"]],
  ["has children", [{ kind: "has-children" }], ["a", "a1"]],
  ["links to", [{ kind: "links-to", node: "a" }], ["c"]],
  ["links to, by a ref value", [{ kind: "links-to", node: "a1" }], ["k"]],
  ["is linked from", [{ kind: "linked-from", node: "c" }], ["a"]],
  [
    "any of",
    [
      {
        kind: "any-of",
        branches: [
          [{ kind: "has-tag", tag: "tag.bug" }],
          [{ kind: "text-contains", text: "other", exactCase: false }],
        ],
      },
    ],
    ["b", "c"],
  ],
  [
    "any of, a branch all of two",
    [
      {
        kind: "any-of",
        branches: [
          [todo, { kind: "field-is", field: "est", values: [{ t: "num", v: 3 }] }],
          [{ kind: "child-of", node: "a1" }],
        ],
      },
    ],
    ["a", "a11"],
  ],
  [
    "none of A, B is not (A or B)",
    [
      { kind: "under", node: "a", via: { t: "child" } },
      {
        kind: "none-of",
        branches: [
          [{ kind: "text-contains", text: "one", exactCase: true }],
          [{ kind: "text-contains", text: "two", exactCase: true }],
        ],
      },
    ],
    ["a11"],
  ],
  [
    "none of one branch of two rows is not (A and B)",
    [
      { kind: "child-of", node: "a" },
      {
        kind: "none-of",
        branches: [
          [
            { kind: "text-contains", text: "step", exactCase: true },
            { kind: "text-contains", text: "one", exactCase: true },
          ],
        ],
      },
    ],
    ["a2"],
  ],
  ["no conditions: every node", [], ALL],
];

describe("semantic examples: each row answers what it says", () => {
  test.each(EXAMPLES)("%s", (_label, conditions, ids) => {
    expect(answer(conditions)).toEqual(ids);
  });

  test.each(EXAMPLES)("%s lifts back from its stored text", (_label, conditions) => {
    const lifted = lift(parseEdn(printEdn(lowerIr(conditions))));
    expect(lifted).toEqual({ lifted: true, conditions: canonicalConditions(conditions) });
  });
});

describe("the vocabulary's EDN", () => {
  test("has tag is the tag's id, then the pattern that reaches it, one clause a line", () => {
    expect(printEdn(lowerIr([todo]))).toBe(
      [
        "[:find ?id :where",
        " [?n :node/id ?id]",
        ' [?v1 :node/id "tag.todo"]',
        " [?n :f/sys.f.type ?v1]]",
      ].join("\n"),
    );
  });

  test("none of is not-join over an or-join, each branch its own variables", () => {
    const edn = printEdn(
      lowerIr([
        {
          kind: "none-of",
          branches: [
            [{ kind: "field-is", field: "status", values: [{ t: "ref", v: "s.done" }] }],
            [{ kind: "links-to", node: "a" }],
          ],
        },
      ]),
    );
    expect(edn).toContain(
      '(not-join [?n] (or-join [?n] (and [?v1 :node/id "s.done"] [?n :f/status ?v1]) (and [?a1 :node/id "a"] [?n :node/mentions ?a1])))',
    );
  });

  test("a hand-written has tag lifts, whatever its variables are called", () => {
    const ir = parseEdn(
      '[:find ?id :where [?task :node/id ?id] [?tag :node/id "todo"] [?task :f/sys.f.type ?tag]]',
    );
    expect(lift(ir)).toEqual({ lifted: true, conditions: [{ kind: "has-tag", tag: "todo" }] });
  });

  test("a node value is matched from the node: the other way round, a text value fails the query", () => {
    // `d` holds a dangling ref and `e` a text, both strings; once DataScript joins
    // through a relation of values, a string reaches `[?v :node/id …]`'s entity slot.
    const valueFirst =
      '[:find ?id :where [?n :node/id ?id] (not-join [?n] (or-join [?n] (and [?n :f/status ?v1] [?v1 :node/id "s.doing"]) [?n :f/status "Doing"])) [?n :f/status ?v2] [?v2 :node/id "s.done"]]';
    expect(() => index.runDatalog(valueFirst)).toThrow(
      "Expected number or lookup ref for entity id",
    );
    expect(lift(parseEdn(valueFirst)).lifted).toBe(false);
    expect(
      answer([
        {
          kind: "field-is-not",
          field: "status",
          values: [
            { t: "ref", v: "s.doing" },
            { t: "str", v: "Doing" },
          ],
        },
        { kind: "field-is", field: "status", values: [{ t: "ref", v: "s.done" }] },
      ]),
    ).toEqual([]);
  });

  test.each([
    ["a raw query", "[:find ?n :where [?n :node/text ?t] [(str ?t) ?s]]"],
    ["another find spec", "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]"],
    ["an input", "[:find ?id :in $ ?x :where [?n :node/id ?id] [?n :node/text ?x]]"],
    [
      "a clause outside the vocabulary",
      "[:find ?id :where [?n :node/id ?id] [?n :node/text ?t] [(= ?t 1)]]",
    ],
    [
      "a variable two rows share",
      '[:find ?id :where [?n :node/id ?id] [?n :f/a ?v] [?v :node/id "x"] [?n :f/b ?v] [?v :node/id "y"]]',
    ],
    ["a plain or", '[:find ?id :where [?n :node/id ?id] (or [?n :f/a "x"] [?n :f/a "y"])]'],
    [
      "an or-join of one branch",
      '[:find ?id :where [?n :node/id ?id] (or-join [?n] [?n :f/a "x"])]',
    ],
  ])("%s does not lift", (_label, edn) => {
    expect(lift(parseEdn(edn)).lifted).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

const RUNS = { numRuns: 400 };

describe("property 4: lower then lift is the identity on canonical conditions", () => {
  test("canonicalConditions is idempotent", () => {
    fc.assert(
      fc.property(treeArb(3), (tree) => {
        const c = canonicalConditions(tree);
        expect(canonicalConditions(c)).toEqual(c);
      }),
      RUNS,
    );
  });

  test("lift(lowerIr(c)) is c, and so is lift of its printed text read back", () => {
    fc.assert(
      fc.property(treeArb(3), (tree) => {
        const c = canonicalConditions(tree);
        const ir = lowerIr(c);
        expect(isCanonicalIr(ir)).toBe(true);
        expect(lift(ir)).toEqual({ lifted: true, conditions: c });
        expect(lift(parseEdn(printEdn(ir)))).toEqual({ lifted: true, conditions: c });
      }),
      RUNS,
    );
  });

  test("a tree and its canonical form ask the same on the graph", () => {
    fc.assert(
      fc.property(treeArb(2, semanticRow), (tree) => {
        expect(answer(canonicalConditions(tree))).toEqual(answerTree(tree));
      }),
      { numRuns: 150 },
    );
  });
});

/** Rows over the example graph's own fields and nodes, so trees answer something. */
const semanticRow: fc.Arbitrary<Condition> = fc.constantFrom(
  ...EXAMPLES.flatMap(([, conditions]) =>
    conditions.filter((c) => c.kind !== "any-of" && c.kind !== "none-of"),
  ),
);

/**
 * What a tree asks, read without `canonicalConditions`: each group as the
 * Boolean it is, an empty group or branch dropped as canonicalisation drops
 * it, evaluated as sets of answered ids.
 */
function answerTree(tree: readonly Condition[]): string[] {
  const all = new Set(ALL);
  const and = (cs: readonly Condition[]): Set<string> | undefined => {
    let out: Set<string> | undefined;
    for (const c of cs) {
      const one = setOf(c);
      if (one === undefined) continue;
      out = out === undefined ? one : new Set([...out].filter((id) => one.has(id)));
    }
    return out;
  };
  const setOf = (c: Condition): Set<string> | undefined => {
    if (c.kind === "all-of") return and(c.conditions);
    if (c.kind === "any-of" || c.kind === "none-of") {
      const branches = c.branches.map(and).filter((b) => b !== undefined);
      if (branches.length === 0) return undefined;
      const any = new Set(branches.flatMap((b) => [...b]));
      return c.kind === "any-of" ? any : new Set([...all].filter((id) => !any.has(id)));
    }
    if ((c.kind === "field-is" || c.kind === "field-is-not") && c.values.length === 0)
      return undefined;
    return new Set(answer([c]));
  };
  return [...(and(tree) ?? all)].toSorted();
}

/** `t` renamed by `r` when it is a variable. */
function renamedTerm<T extends Term | PredicateArg>(t: T, r: (x: string) => string): T {
  return t.t === "var" ? { ...t, name: r(t.name) } : t;
}

/** The variables of each scope of `ir` renamed: the top scope's by `names`, each `-join` scope's locals from a pool its siblings share. */
function renamed(ir: IrQuery, names: readonly string[], pool: readonly string[]): IrQuery {
  const top = new Map<string, string>();
  const topName = (x: string): string => {
    let y = top.get(x);
    if (y === undefined) {
      y = names[top.size] ?? `t${top.size}`;
      top.set(x, y);
    }
    return y;
  };
  const scoped = (join: readonly string[], outer: (x: string) => string) => {
    const joined = new Map(join.map((x) => [x, outer(x)]));
    const taken = new Set(joined.values());
    const free = pool.filter((p) => !taken.has(p));
    const local = new Map<string, string>();
    return (x: string): string => {
      const j = joined.get(x);
      if (j !== undefined) return j;
      let y = local.get(x);
      if (y === undefined) {
        y = free[local.size] ?? `l${local.size}`;
        local.set(x, y);
      }
      return y;
    };
  };
  const clause = (c: Clause, r: (x: string) => string): Clause => {
    switch (c.kind) {
      case "pattern":
        return { ...c, entity: r(c.entity), value: renamedTerm(c.value, r) };
      case "children":
        return { ...c, parent: r(c.parent), child: r(c.child), order: r(c.order) };
      case "reach":
        return { ...c, from: r(c.from), to: r(c.to) };
      case "rule":
        return { ...c, args: c.args.map((a) => renamedTerm(a, r)) };
      case "predicate":
        return {
          ...c,
          args: c.args.map((a) => renamedTerm(a, r)),
          ...(c.bind === undefined ? {} : { bind: r(c.bind) }),
        };
      case "or": {
        const join = c.join;
        if (join === undefined)
          return { ...c, branches: c.branches.map((b) => b.map((x) => clause(x, r))) };
        return {
          ...c,
          join: join.map(r),
          branches: c.branches.map((b) => {
            const inner = scoped(join, r);
            return b.map((x) => clause(x, inner));
          }),
        };
      }
      case "not": {
        const join = c.join;
        const inner = join === undefined ? r : scoped(join, r);
        return {
          ...c,
          ...(join === undefined ? {} : { join: join.map(r) }),
          clauses: c.clauses.map((x) => clause(x, inner)),
        };
      }
      default: {
        const _exhaustive: never = c;
        return _exhaustive;
      }
    }
  };
  const where = ir.where.map((c) => clause(c, topName));
  const find = ir.find.map((p) => (p.kind === "var" ? { ...p, name: topName(p.name) } : p));
  return { ...ir, find, where };
}

const VAR_NAMES = [
  "n",
  "id",
  "v1",
  "v2",
  "a1",
  "t",
  "x",
  "task",
  "tag",
  "s1",
  "s2",
  "c1",
  "q",
  "r",
];

describe("property 5: lift recognises up to renaming", () => {
  test("renaming every variable, scope by scope, lifts to the same conditions and answers the same", () => {
    fc.assert(
      fc.property(
        treeArb(3),
        fc.shuffledSubarray(VAR_NAMES, { minLength: VAR_NAMES.length }),
        fc.shuffledSubarray(VAR_NAMES, { minLength: 4 }),
        (tree, names, pool) => {
          const c = canonicalConditions(tree);
          const alpha = renamed(lowerIr(c), names, pool);
          expect(alphaEquivalent(alpha, lowerIr(c))).toBe(true);
          expect(lift(alpha)).toEqual({ lifted: true, conditions: c });
          expect(lift(parseEdn(printEdn(alpha)))).toEqual({ lifted: true, conditions: c });
        },
      ),
      RUNS,
    );
  });

  test("a renamed query answers what the original does: the scopes are DataScript's", () => {
    fc.assert(
      fc.property(
        treeArb(2, semanticRow),
        fc.shuffledSubarray(VAR_NAMES, { minLength: VAR_NAMES.length }),
        fc.shuffledSubarray(VAR_NAMES, { minLength: 4 }),
        (tree, names, pool) => {
          const ir = lowerIr(tree);
          const rows = (q: IrQuery) =>
            index
              .run(q)
              .map((row) => String(row[0]))
              .toSorted();
          expect(rows(renamed(ir, names, pool))).toEqual(rows(ir));
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** `clauses` with every variable, at any depth, renamed by `rename`, and every string constant by `restring`. */
function rewrite(
  clauses: readonly Clause[],
  rename: (x: string) => string,
  restring: (s: string) => string = (x) => x,
): Clause[] {
  const term = <T extends Term | PredicateArg>(t: T): T => {
    if (t.t === "var") return { ...t, name: rename(t.name) };
    if (t.t === "str") return { ...t, value: restring(t.value) };
    return t;
  };
  return clauses.map((c): Clause => {
    switch (c.kind) {
      case "pattern":
        return { ...c, entity: rename(c.entity), value: term(c.value) };
      case "children":
        return { ...c, parent: rename(c.parent), child: rename(c.child), order: rename(c.order) };
      case "reach":
        return { ...c, from: rename(c.from), to: rename(c.to) };
      case "rule":
        return { ...c, args: c.args.map(term) };
      case "predicate":
        return {
          ...c,
          args: c.args.map(term),
          ...(c.bind === undefined ? {} : { bind: rename(c.bind) }),
        };
      case "or":
        return {
          ...c,
          ...(c.join === undefined ? {} : { join: c.join.map(rename) }),
          branches: c.branches.map((b) => rewrite(b, rename, restring)),
        };
      case "not":
        return {
          ...c,
          ...(c.join === undefined ? {} : { join: c.join.map(rename) }),
          clauses: rewrite(c.clauses, rename, restring),
        };
      default: {
        const _exhaustive: never = c;
        return _exhaustive;
      }
    }
  });
}

/** Every variable named anywhere in `clauses`, at any depth. */
function varsOf(clauses: readonly Clause[]): string[] {
  const names = new Set<string>();
  rewrite(clauses, (x) => {
    names.add(x);
    return x;
  });
  return [...names];
}

/** One edit of `ir`'s top-level `:where`: a clause dropped, duplicated or swapped, two variables merged, the string constants changed. */
const mutantArb = (ir: IrQuery): fc.Arbitrary<IrQuery> => {
  const where = ir.where;
  const names = varsOf(where);
  const at = fc.nat({ max: Math.max(0, where.length - 1) });
  const nth = (i: number): Clause[] => where.slice(i, i + 1);
  const edits: fc.Arbitrary<IrQuery>[] = [
    at.map((i) => ({ ...ir, where: where.toSpliced(i, 1) })),
    at.map((i) => ({ ...ir, where: where.toSpliced(i, 0, ...nth(i)) })),
    at.map((i) => ({ ...ir, where: where.toSpliced(i, 2, ...nth(i + 1), ...nth(i)) })),
    fc.string({ maxLength: 3 }).map((x) => ({
      ...ir,
      where: rewrite(
        where,
        (n) => n,
        () => x,
      ),
    })),
  ];
  if (names.length >= 2) {
    edits.push(
      fc.tuple(fc.constantFrom(...names), fc.constantFrom(...names)).map(([from, to]) => ({
        ...ir,
        where: rewrite(where, (n) => (n === from ? to : n)),
      })),
    );
  }
  return fc.oneof(...edits);
};

describe("property 6: lift loses nothing", () => {
  test("a query lifts exactly when lowering what it lifts to is alpha-equivalent to it: one edit of a lowered query", () => {
    fc.assert(
      fc.property(
        treeArb(2).chain((tree) => {
          const ir = lowerIr(canonicalConditions(tree));
          return fc.tuple(fc.constant(ir), mutantArb(ir));
        }),
        ([, mutant]) => {
          const lifted = lift(mutant);
          if (lifted.lifted) expect(alphaEquivalent(lowerIr(lifted.conditions), mutant)).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("and over the canonical IR at large", () => {
    fc.assert(
      fc.property(canonicalIrArb, (ir) => {
        const lifted = lift(ir);
        if (lifted.lifted) expect(alphaEquivalent(lowerIr(lifted.conditions), ir)).toBe(true);
      }),
      RUNS,
    );
  });

  test("merging two rows' variables is caught by the check, not by the reading", () => {
    // Each row reads alone; together they share ?v, which the lowering never does.
    const ir = parseEdn(
      '[:find ?id :where [?n :node/id ?id] [?n :f/a ?v] [(kb/includes-ci? ?v "x")] [?n :f/b ?v] [(kb/includes-ci? ?v "y")]]',
    );
    expect(lift(ir)).toEqual({
      lifted: false,
      reason: "written back, it would ask something else",
    });
  });
});
