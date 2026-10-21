/**
 * `_`, `PREDICATES`, `or`/`or-join` and `not`/`not-join` in the IR subset:
 * semantic examples, each a small graph, a query, and the nodes it must
 * answer, run through `compile` on kb's index. Round trips cannot catch a
 * clause that compiles consistently wrong; these can.
 */
import { DatascriptIndex, derivedWith, parseEdn, type Ir } from "@kb/query";
import type { KbNode } from "@kb/model";
import { describe, expect, test } from "bun:test";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, extra: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: extra.text ?? id,
    props: extra.props ?? {},
    children: extra.children ?? [],
    createdAt: AT,
    updatedAt: AT,
  };
}

const todo = { "sys.f.type": [{ t: "ref" as const, v: "tag.todo" }] };

const index = new DatascriptIndex(
  [
    node("tag.todo", { text: "todo" }),
    node("s.doing", { text: "Doing" }),
    node("s.done", { text: "Done" }),
    node("a", {
      text: "Draft plan",
      children: ["a1", "a2"],
      props: {
        ...todo,
        status: [{ t: "ref", v: "s.doing" }],
        estimate: [{ t: "num", v: 3 }],
        due: [{ t: "str", v: "2026-11-01" }],
      },
    }),
    node("b", {
      text: "retro notes",
      props: {
        ...todo,
        status: [
          { t: "ref", v: "s.done" },
          { t: "ref", v: "s.doing" },
        ],
        estimate: [{ t: "num", v: 5 }],
        due: [{ t: "str", v: "2026-12-24" }],
      },
    }),
    node("c", { text: "Other, see [[a]]" }),
    node("a1", { text: "step one" }),
    node("a2", { text: "step two" }),
  ],
  { derived: derivedWith({}) },
);

/** The first column of `edn`'s rows, sorted, after checking it parses into the IR (not raw). */
function answer(edn: string): unknown[] {
  expect(parseEdn(edn).kind).toBe("query");
  return index
    .runDatalog(edn)
    .map((row) => row[0])
    .toSorted((x, y) => String(x).localeCompare(String(y)));
}

const byFirst = (x: unknown[], y: unknown[]) => String(x[0]).localeCompare(String(y[0]));

const q = (where: string) => `[:find ?id :where [?n :node/id ?id] ${where}]`;

describe("predicates of the closed set", () => {
  test.each([
    ["a number compared", "[?n :f/estimate ?e] [(> ?e 4)]", ["b"]],
    ["a civil date compared as a string", '[?n :f/due ?d] [(< ?d "2026-12-01")]', ["a"]],
    [
      "includes? is exact about case",
      '[?n :node/text ?t] [(clojure.string/includes? ?t "draft")]',
      [],
    ],
    ["starts-with?", '[?n :node/text ?t] [(clojure.string/starts-with? ?t "step")]', ["a1", "a2"]],
    ["ends-with?", '[?n :node/text ?t] [(clojure.string/ends-with? ?t "notes")]', ["b"]],
    ["not=", '[?n :f/sys.f.type _] [?n :node/text ?t] [(not= ?t "Draft plan")]', ["b"]],
    [
      "missing? takes $ and an attribute",
      "[?n :f/sys.f.type _] [(missing? $ ?n :node/children)]",
      ["b"],
    ],
    ["= in binding position", "[?n :f/estimate ?e] [(= ?e 3) ?three] [(= ?three true)]", ["a"]],
  ])("%s", (_label, where, ids) => {
    expect(answer(q(where))).toEqual(ids);
  });
});

describe("_ matches anything and binds nothing", () => {
  test("has children", () => {
    expect(answer(q("[?n :node/child _]"))).toEqual(["a"]);
  });

  test("a field is set", () => {
    expect(answer(q("[?n :f/status _]"))).toEqual(["a", "b"]);
  });
});

describe("not and or", () => {
  test("lacks tag: not-join over [?n]", () => {
    expect(
      answer(q('[?n :node/text _] (not-join [?n] [?n :f/sys.f.type ?t] [?t :node/id "tag.todo"])')),
    ).toEqual(["a1", "a2", "c", "s.doing", "s.done", "tag.todo"]);
  });

  test("is not Done keeps the absent and drops a multi-value that includes Done", () => {
    expect(
      answer(q('[?n :f/sys.f.type _] (not-join [?n] [?n :f/status ?v] [?v :node/id "s.done"])')),
    ).toEqual(["a"]);
  });

  test("or-join with branch-local variables", () => {
    const where =
      '(or-join [?n] (and [?n :f/status ?v1] [?v1 :node/id "s.done"]) (and [?a1 :node/id "c"] [?a1 :node/mentions ?n]))';
    expect(answer(q(where))).toEqual(["a", "b"]);
  });

  test("none of A, B is not (A or B), not (not A B)", () => {
    const noneOf =
      '(not-join [?n] (or-join [?n] [?n :node/text "step one"] [?n :node/text "step two"]))';
    const notBoth = '(not [?n :node/text "step one"] [?n :node/text "step two"])';
    const among = '[?a :node/id "a"] [?a :node/child ?n]';
    expect(answer(q(`${among} ${noneOf}`))).toEqual([]);
    expect(answer(q(`${among} ${notBoth}`))).toEqual(["a1", "a2"]);
  });

  test("a plain or: every branch binds the same variables", () => {
    expect(
      answer(q('(or [?n :node/text "Draft plan"] [?n :node/text "Other, see [[a]]"])')),
    ).toEqual(["a", "c"]);
  });
});

describe("reach and children inside or and not", () => {
  test("not under a: reach inside not-join emits its rules", () => {
    const where = '[?n :node/text _] (not-join [?n] [?r :node/id "a"] (reach ?r :node/child ?n))';
    expect(answer(q(where))).toEqual(["a", "b", "c", "s.doing", "s.done", "tag.todo"]);
  });

  test("reach in one or-join branch, a pattern in the other", () => {
    const where =
      '(or-join [?n] (and [?r :node/id "a"] (reach ?r :node/child ?n)) [?n :node/text "retro notes"])';
    expect(answer(q(where))).toEqual(["a1", "a2", "b"]);
  });

  test("children collapses inside a branch, and a one-clause children branch compiles to (and …)", () => {
    const edn =
      '[:find ?id :where (or-join [?c] (and [?p :node/id "a"] [?p :node/child ?c] [?p :node/child-order ?o])) [?c :node/id ?id]]';
    const ir = parseEdn(edn);
    expect(
      ir.kind === "query" && ir.where[0]?.kind === "or" && ir.where[0].branches[0]?.[1]?.kind,
    ).toBe("children");
    expect(answer(edn)).toEqual(["a1", "a2"]);
  });
});

describe("scope: what a find column is", () => {
  test("a variable bound in a plain or branch is a node where it is one there", () => {
    const edn =
      '[:find ?m :where [?n :node/id "c"] (or [?n :node/mentions ?m] [?n :node/child ?m])]';
    const ir = parseEdn(edn);
    expect(ir.kind === "query" && ir.find).toEqual([{ kind: "var", name: "m", type: "node-ref" }]);
    expect(answer(edn)).toEqual(["a"]);
  });

  test("an or-join's join variable is a node where a branch binds it as an entity", () => {
    const own = new DatascriptIndex([node("x", { text: "a" }), node("y", { text: "b" })], {
      derived: derivedWith({}),
    });
    const edn = '[:find ?m :where (or-join [?m] [?m :node/text "a"] [?m :node/text "b"])]';
    const ir = parseEdn(edn);
    expect(ir.kind === "query" && ir.find).toEqual([{ kind: "var", name: "m", type: "node-ref" }]);
    expect(own.runDatalog(edn).toSorted(byFirst)).toEqual([["x"], ["y"]]);
  });

  test("an or-join's join variable is a node where a branch binds it as a ref value", () => {
    const core =
      '[:find ?m :where [?n :node/id "c"] (or-join [?n ?m] [?n :node/mentions ?m] [?n :node/child ?m])]';
    const coreIr = parseEdn(core);
    expect(coreIr.kind === "query" && coreIr.find[0]?.type).toBe("node-ref");
    expect(answer(core)).toEqual(["a"]);
    const field = '[:find ?s :where [?n :node/id "b"] (or-join [?n ?s] [?n :f/status ?s])]';
    expect(answer(field)).toEqual(["s.doing", "s.done"]);
  });

  test("an or-join's branch-local variable stays inside it, though it shares a name outside", () => {
    // The branch's ?v is a `status` ref; the outer ?v an estimate, a number
    // that may equal a live eid, so it must not revive as a node.
    const edn =
      '[:find ?id ?v :where [?n :node/id ?id] [?n :f/estimate ?v] (or-join [?n] (and [?n :f/status ?v] [?v :node/id "s.doing"]) [?n :node/text "Draft plan"])]';
    const ir = parseEdn(edn);
    expect(ir.kind === "query" && ir.find[1]).toEqual({ kind: "var", name: "v", type: "scalar" });
    expect(index.runDatalog(edn).toSorted(byFirst)).toEqual([
      ["a", 3],
      ["b", 5],
    ]);
  });

  test("a not-join's join variable takes no type from inside it", () => {
    const edn =
      '[:find ?id ?v :where [?n :node/id ?id] [?n :f/estimate ?v] (not-join [?v] [?v :node/id ?x] [?x :f/status ?v] [?x :node/text "none"])]';
    const ir = parseEdn(edn);
    expect(ir.kind === "query" && ir.find[1]).toEqual({ kind: "var", name: "v", type: "scalar" });
    expect(index.runDatalog(edn).toSorted(byFirst)).toEqual([
      ["a", 3],
      ["b", 5],
    ]);
  });

  test("a variable bound only inside a not is not bound outside it", () => {
    const edn = "[:find ?id ?v :where [?n :node/id ?id] (not [?n :f/status ?v])]";
    const ir = parseEdn(edn);
    // Were the not's ?v a node outside it, `status` refs would revive as ids.
    expect(ir.kind === "query" && ir.find[1]).toEqual({ kind: "var", name: "v", type: "scalar" });
  });

  test("a predicate's ?out is a scalar column", () => {
    const edn = "[:find ?id ?big :where [?n :node/id ?id] [?n :f/estimate ?e] [(> ?e 4) ?big]]";
    const ir = parseEdn(edn);
    expect(ir.kind === "query" && ir.find[1]?.type).toBe("scalar");
    expect(index.runDatalog(edn).toSorted(byFirst)).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("outside the subset, the query is still raw", () => {
  test.each([
    ["a function outside PREDICATES", "[:find ?n :where [?n :node/text ?t] [(str ?t) ?s]]"],
    ["a kb/ name no registry knows", '[:find ?n :where [?n :node/text ?t] [(kb/nope ?t "x")]]'],
    ["and at the top level", "[:find ?n :where (and [?n :node/text _])]"],
    ["an empty and branch", "[:find ?n :where [?n :node/text _] (or (and) [?n :node/id _])]"],
    ["_ as an entity", "[:find ?x :where [_ :node/id ?x]]"],
    ["_ as a predicate argument", "[:find ?n :where [?n :node/text _] [(= _ 1)]]"],
    ["a binding form other than ?out", "[:find ?n :where [?n :node/text ?t] [(= ?t 1) [?x ...]]]"],
    [
      "a join vector of non-variables",
      '[:find ?n :where [?n :node/text _] (not-join ["n"] [?n :node/id _])]',
    ],
  ])("%s", (_label, edn) => {
    expect(parseEdn(edn)).toEqual({ kind: "raw", edn } satisfies Ir);
  });
});
