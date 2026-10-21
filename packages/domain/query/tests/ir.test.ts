/**
 * Query IR: parse/compile round-trip on stored shapes, typed revival, reach.
 */
import {
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
  DatalogError,
  DatascriptIndex,
  derivedWith,
  compile,
  isCanonicalIr,
  parseEdn,
  printEdn,
  type Ir,
  type IrQuery,
} from "@kb/query";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode } from "@kb/model";
import { bundledSeed } from "@kb/bundled";

function indexFor(nodes: KbNode[]): DatascriptIndex {
  return new DatascriptIndex(nodes, { derived: derivedWith({}) });
}

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

function sortedRows(raw: unknown): unknown[][] {
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter((r): r is unknown[] => Array.isArray(r));
  return [...rows].toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function sameRows(a: unknown, b: unknown): void {
  expect(sortedRows(a)).toEqual(sortedRows(b));
}

/** Stored-query shapes enumerated for the migration wave. */
const STORED_QUERIES: { name: string; edn: string }[] = [
  {
    name: "sys.f.query All todos live",
    edn: '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]',
  },
  {
    name: ".kb/queries/todos.edn",
    edn: `[:find ?id ?text
 :where
 [?n :f/sys.f.type ?tag]
 [?tag :node/text "todo"]
 [?tag :f/sys.f.type ?tagType]
 [?tagType :node/id "sys.tag"]
 [?n :node/id ?id]
 [?n :node/text ?text]]`,
  },
  {
    name: "docs view todos",
    edn: '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]',
  },
  {
    name: "docs view rules",
    edn: '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "rule"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]',
  },
  {
    name: "sys.f.targetQuery onto.extends",
    edn: '[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id "sys.tag.ontology"] [?n :node/id ?id]]',
  },
  { name: "LIST_FIELDS_QUERY", edn: LIST_FIELDS_QUERY },
  { name: "LIST_TAGS_QUERY", edn: LIST_TAGS_QUERY },
  { name: "LIST_ALL_NODES_QUERY", edn: LIST_ALL_NODES_QUERY },
  { name: "backlinksQuery(sys.tag)", edn: backlinksQuery("sys.tag") },
];

const VIEW_FILTER = '{:field sys.f.type :eq "todo"}';

describe("parseEdn subset vs raw", () => {
  test("every stored datalog query parses as structured IR", () => {
    for (const q of STORED_QUERIES) {
      const ir = parseEdn(q.edn);
      expect(ir.kind).toBe("query");
    }
  });

  test("sys.f.view.filter maps are raw (not datalog)", () => {
    expect(parseEdn(VIEW_FILTER)).toEqual({ kind: "raw", edn: VIEW_FILTER });
  });

  test("malformed EDN is raw, not a throw", () => {
    expect(parseEdn("[:find ?x :where").kind).toBe("raw");
  });
});

/** The value of the one pattern in `[:find ?n :where [?n :a <literal>]]`, or the IR kind when it does not parse. */
function literalValue(literal: string): unknown {
  const ir = parseEdn(`[:find ?n :where [?n :a ${literal}]]`);
  if (ir.kind !== "query") return ir.kind;
  const [clause] = ir.where;
  return clause?.kind === "pattern" ? clause.value : clause;
}

describe("the reader reads EDN literals as EDN means them", () => {
  test.each([
    [String.raw`"a\nb"`, "a\nb"],
    [String.raw`"tab\there"`, "tab\there"],
    [String.raw`"cr\r"`, "cr\r"],
    [String.raw`"say \"hi\""`, 'say "hi"'],
    [String.raw`"back\\slash"`, "back\\slash"],
    [String.raw`"été"`, "été"],
    [String.raw`"\b\f"`, "\b\f"],
  ])("the string %s", (literal, value) => {
    expect(literalValue(literal)).toEqual({ t: "str", value });
  });

  test.each([String.raw`"\q"`, String.raw`"\u12"`, String.raw`"\uZZZZ"`])(
    "an escape EDN does not define (%s) is not read: the query is raw",
    (literal) => {
      expect(literalValue(literal)).toBe("raw");
    },
  );

  test("every number String(n) prints reads back as n", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
        (n) => {
          expect(literalValue(String(n))).toEqual({ t: "num", value: n });
        },
      ),
    );
  });

  test.each([
    ["1e-7", 1e-7],
    ["1e+21", 1e21],
    ["-2.5", -2.5],
    ["+3", 3],
  ])("the number %s", (literal, value) => {
    expect(literalValue(literal)).toEqual({ t: "num", value });
  });

  test("a sign not followed by a digit starts a symbol", () => {
    const ir = parseEdn("[:find ?a :where (- ?a ?b) [?a :node/id ?b]]");
    expect(ir.kind === "query" && ir.where[0]).toEqual({
      kind: "rule",
      name: "-",
      args: [
        { t: "var", name: "a" },
        { t: "var", name: "b" },
      ],
    });
  });

  test.each(["1e", "1.", "1e400", "1-2"])("%s is no number: the query is raw", (literal) => {
    expect(literalValue(literal)).toBe("raw");
  });

  test("an escaped string matches the text it stands for", () => {
    const index = indexFor([
      node("two-lines", { text: "one\ntwo" }),
      node("one-line", { text: "n" }),
    ]);
    const edn = String.raw`[:find ?id :where [?n :node/text "one\ntwo"] [?n :node/id ?id]]`;
    expect(index.runDatalog(edn)).toEqual([["two-lines"]]);
  });
});

describe("compile(parse(edn)) is query-equivalent", () => {
  const index = indexFor([
    ...bundledSeed(AT),
    node("n.todo", {
      text: "a todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
  ]);

  test("stored queries: same rows as the original EDN", () => {
    for (const q of STORED_QUERIES) {
      const compiled = compile(parseEdn(q.edn));
      sameRows(index.runDatalog(compiled.query), index.runDatalog(q.edn));
    }
  });
});

type GenClause = IrQuery["where"][number];

function boundNames(where: readonly GenClause[]): string[] {
  const bound = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern") {
      bound.add(c.entity);
      if (c.value.t === "var") bound.add(c.value.name);
    } else if (c.kind === "children") {
      bound.add(c.parent);
      bound.add(c.child);
    } else if (c.kind === "reach") {
      bound.add(c.from);
      bound.add(c.to);
    }
  }
  return [...bound];
}

function pattern(
  entity: string,
  attr: string,
  value: { t: "var"; name: string } | { t: "str"; value: string } | { t: "blank" },
): GenClause {
  return { kind: "pattern", entity, attr, value };
}

/** True one time in four: the clause kinds that narrow most, so most generated queries still answer rows. */
const rarely = fc.integer({ min: 0, max: 3 }).map((n) => n === 0);

const irArb: fc.Arbitrary<IrQuery> = fc
  .record({
    idLiteral: fc.option(fc.constantFrom("n.todo", "p", "a"), { nil: null }),
    text: fc.constantFrom("omit", "var", "a todo", "leaf"),
    typeJoin: fc.boolean(),
    mentionsJoin: fc.boolean(),
    children: fc.boolean(),
    reach: fc.boolean(),
    hasChild: rarely,
    textHas: fc.option(
      fc.record({
        fn: fc.constantFrom(
          "clojure.string/includes?" as const,
          "clojure.string/starts-with?" as const,
          "clojure.string/ends-with?" as const,
          "not=" as const,
          "<" as const,
        ),
        needle: fc.constantFrom("o", "a", "leaf", "[["),
      }),
      { nil: null, freq: 3 },
    ),
    noneOf: rarely,
    anyOf: rarely,
  })
  .chain((shape) => {
    const where: GenClause[] = [
      pattern(
        "n",
        ":node/id",
        shape.idLiteral === null ? { t: "var", name: "id" } : { t: "str", value: shape.idLiteral },
      ),
    ];
    if (shape.text === "var") where.push(pattern("n", ":node/text", { t: "var", name: "text" }));
    else if (shape.text !== "omit")
      where.push(pattern("n", ":node/text", { t: "str", value: shape.text }));
    if (shape.typeJoin) {
      where.push(pattern("n", ":f/sys.f.type", { t: "var", name: "t" }));
      where.push(pattern("t", ":node/id", { t: "var", name: "tid" }));
    }
    if (shape.mentionsJoin) {
      where.push(pattern("n", ":node/mentions", { t: "var", name: "m" }));
      where.push(pattern("m", ":node/id", { t: "var", name: "mid" }));
    }
    if (shape.children) {
      where.push(pattern("p", ":node/id", { t: "str", value: "p" }));
      where.push({ kind: "children", parent: "p", child: "c", order: "o" });
      where.push(pattern("c", ":node/id", { t: "var", name: "cid" }));
    }
    if (shape.reach) {
      where.push(pattern("root", ":node/id", { t: "str", value: "a" }));
      where.push({ kind: "reach", from: "root", to: "reached", edge: ":node/mentions" });
      where.push(pattern("reached", ":node/id", { t: "var", name: "rid" }));
    }
    if (shape.hasChild) where.push(pattern("n", ":node/child", { t: "blank" }));
    if (shape.textHas !== null) {
      where.push(pattern("n", ":node/text", { t: "var", name: "text2" }));
      where.push({
        kind: "predicate",
        fn: shape.textHas.fn,
        args: [
          { t: "var", name: "text2" },
          { t: "str", value: shape.textHas.needle },
        ],
      });
    }
    if (shape.noneOf) {
      // "none of": not (A or B), each branch with its own variables.
      where.push({
        kind: "not",
        join: ["n"],
        clauses: [
          {
            kind: "or",
            join: ["n"],
            branches: [
              [pattern("n", ":node/text", { t: "str", value: "leaf" })],
              [
                pattern("x", ":node/id", { t: "str", value: "a" }),
                { kind: "reach", from: "x", to: "n", edge: ":node/mentions" },
              ],
            ],
          },
        ],
      });
    }
    if (shape.anyOf) {
      where.push({
        kind: "or",
        join: ["n"],
        branches: [
          [pattern("n", ":f/sys.f.type", { t: "blank" })],
          [
            pattern("q", ":node/id", { t: "str", value: "p" }),
            { kind: "children", parent: "q", child: "n", order: "qo" },
          ],
          [
            {
              kind: "predicate",
              fn: "missing?",
              args: [{ t: "src" }, { t: "var", name: "n" }, { t: "attr", value: ":node/children" }],
            },
          ],
        ],
      });
    }
    const names = boundNames(where);
    return fc
      .uniqueArray(fc.constantFrom(...names), {
        minLength: 1,
        maxLength: Math.min(2, names.length),
      })
      .map((findNames) => ({
        kind: "query" as const,
        find: findNames.map((name) => ({
          kind: "var" as const,
          name,
          type: name.startsWith("text") ? ("scalar" as const) : ("node-ref" as const),
        })),
        where,
      }));
  });

describe("the canonical domain is what parseEdn produces", () => {
  test("every stored query parses to a canonical IR", () => {
    for (const q of STORED_QUERIES) {
      const ir = parseEdn(q.edn);
      expect(ir.kind === "query" && isCanonicalIr(ir)).toBe(true);
    }
  });

  test("the generator produces only canonical IR", () => {
    fc.assert(fc.property(irArb, (ir) => isCanonicalIr(ir)));
  });

  const base = parseEdn(
    '[:find ?id ?t :where [?p :node/id "p"] [?p :node/child ?c] [?p :node/child-order ?o] [?c :node/id ?id] [?c :node/text ?t]]',
  );

  test("a find typed otherwise than its :where types it is outside the domain", () => {
    if (base.kind !== "query") throw new Error("expected IR");
    expect(isCanonicalIr(base)).toBe(true);
    const find = base.find.map((p) =>
      p.kind === "var" && p.name === "t" ? { ...p, type: "node-ref" as const } : p,
    );
    expect(isCanonicalIr({ ...base, find })).toBe(false);
  });

  test("children beside a pattern it would collapse is outside the domain", () => {
    if (base.kind !== "query") throw new Error("expected IR");
    const where = [...base.where, pattern("p", ":node/child", { t: "var", name: "d" })];
    expect(isCanonicalIr({ ...base, where })).toBe(false);
  });

  test("a variable or keyword the reader would not read back is outside the domain", () => {
    if (base.kind !== "query") throw new Error("expected IR");
    expect(
      isCanonicalIr({ ...base, where: [pattern("p q", ":node/id", { t: "var", name: "id" })] }),
    ).toBe(false);
    expect(isCanonicalIr({ ...base, where: [pattern("p", ":", { t: "var", name: "id" })] })).toBe(
      false,
    );
    expect(
      isCanonicalIr({
        ...base,
        where: [
          { kind: "pattern", entity: "p", attr: ":a", value: { t: "num", value: Number.NaN } },
        ],
      }),
    ).toBe(false);
  });
});

const STORE_IDS = ["sys.tag", "n.todo", "p", "c1", "c2", "a", "b", "c"];

/** A small graph over `STORE_IDS`: texts that mention, children, and tag refs, all drawn. */
const storeArb: fc.Arbitrary<KbNode[]> = fc.tuple(
  ...STORE_IDS.map((id) =>
    fc
      .record({
        text: fc.constantFrom(id, "a todo", "leaf", "[[b]]", "[[c]]", "[[c2]] and [[a]]"),
        children: fc.subarray(
          STORE_IDS.filter((other) => other !== id),
          { maxLength: 3 },
        ),
        tagged: fc.boolean(),
      })
      .map(({ text, children, tagged }) =>
        node(id, {
          text,
          children,
          props: tagged ? { "sys.f.type": [{ t: "ref", v: "sys.tag" }] } : {},
        }),
      ),
  ),
);

describe("property 3: printing keeps the answer", () => {
  test("rows of parseEdn(printEdn(ir)) equal the rows of ir, over a generated store", () => {
    const outcome = (index: DatascriptIndex, ir: Ir) => {
      try {
        return { rows: sortedRows(index.run(ir)) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    let answered = 0;
    fc.assert(
      fc.property(irArb, storeArb, (ir, store) => {
        const index = indexFor(store);
        const expected = outcome(index, ir);
        if (expected.rows !== undefined && expected.rows.length > 0) answered += 1;
        expect(outcome(index, parseEdn(printEdn(ir)))).toEqual(expected);
      }),
      { numRuns: 100 },
    );
    // Equal errors, or equal empty answers, on both sides prove little: a share of the runs must answer rows.
    expect(answered).toBeGreaterThanOrEqual(8);
  });
});

describe("runIr revives only node-ref positions", () => {
  const index = indexFor([
    node("a", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("b", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("c", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
  ]);
  const edn = "[:find ?v (count ?n) :where [?n :f/fld.status ?v]]";

  test("count-revival: a count that collides with an eid stays a count, by IR or by EDN", () => {
    const raw = index.runDatalog(edn);
    const ir = parseEdn(edn);
    expect(ir.kind).toBe("query");
    const typed = index.run(ir);
    expect(sortedRows(raw)).toEqual([["doing", 3]]);
    expect(sortedRows(typed)).toEqual([["doing", 3]]);
  });

  test("a number field's value stays a number, and a ref field's value is the node it names", () => {
    const fields = indexFor([
      node("a", { props: { "f.n": [{ t: "num", v: 1 }], "f.r": [{ t: "ref", v: "b" }] } }),
      node("b", { props: { "f.n": [{ t: "num", v: 2 }] } }),
    ]);
    expect(
      sortedRows(fields.runDatalog("[:find ?id ?n :where [?e :node/id ?id] [?e :f/f.n ?n]]")),
    ).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(fields.runDatalog("[:find ?id ?r :where [?e :node/id ?id] [?e :f/f.r ?r]]")).toEqual([
      ["a", "b"],
    ]);
  });
});

describe("reach compiles to a recursive DataScript rule", () => {
  const index = indexFor([
    node("a", { text: "[[b]]" }),
    node("b", { text: "[[c]]" }),
    node("c", { text: "leaf" }),
  ]);

  test("constructed reach IR returns the closure", () => {
    const ir: IrQuery = {
      kind: "query",
      find: [{ kind: "var", name: "id", type: "node-ref" }],
      where: [
        { kind: "pattern", entity: "root", attr: ":node/id", value: { t: "str", value: "a" } },
        { kind: "reach", from: "root", to: "n", edge: ":node/mentions" },
        { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
      ],
    };
    const compiled = compile(ir);
    expect(compiled.rules).toContain("reach");
    const rows = index.run(ir);
    expect(
      sortedRows(rows)
        .map((r) => r[0])
        .toSorted((x, y) => String(x).localeCompare(String(y))),
    ).toEqual(["b", "c"]);
  });
});

function reachIr(root: string, edge: string, extra: Partial<IrQuery> = {}): IrQuery {
  return {
    kind: "query",
    find: [{ kind: "var", name: "id", type: "node-ref" }],
    ...extra,
    where: [
      { kind: "pattern", entity: "root", attr: ":node/id", value: { t: "str", value: root } },
      { kind: "reach", from: "root", to: "n", edge },
      { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
      ...(extra.where ?? []),
    ],
  };
}

function ids(rows: unknown): unknown[] {
  return sortedRows(rows)
    .map((r) => r[0])
    .toSorted((x, y) => String(x).localeCompare(String(y)));
}

describe("reach steps through nodes only", () => {
  const index = indexFor([
    node("a", {
      props: {
        parent: [
          { t: "ref", v: "b" },
          { t: "ref", v: "ghost" },
        ],
      },
    }),
    node("b", { props: { parent: [{ t: "ref", v: "c" }] } }),
    node("c", { props: { parent: [{ t: "ref", v: "gone" }] } }),
  ]);

  test("a dangling ref is neither followed nor returned", () => {
    expect(ids(index.run(reachIr("a", ":f/parent")))).toEqual(["b", "c"]);
    const bare: IrQuery = {
      kind: "query",
      find: [{ kind: "var", name: "n", type: "node-ref" }],
      where: [
        { kind: "pattern", entity: "root", attr: ":node/id", value: { t: "str", value: "a" } },
        { kind: "reach", from: "root", to: "n", edge: ":f/parent" },
      ],
    };
    expect(ids(index.run(bare))).toEqual(["b", "c"]);
  });

  test("the bounded form skips dangling refs too", () => {
    const ir = reachIr("a", ":f/parent");
    const where = ir.where.map((c) => (c.kind === "reach" ? { ...c, maxHops: 5 } : c));
    expect(ids(index.run({ ...ir, where }))).toEqual(["b", "c"]);
  });
});

describe("reach shares the % slot with the caller's rules", () => {
  const index = indexFor([
    node("a", { text: "[[b]]" }),
    node("b", { text: "[[c]]" }),
    node("c", { text: "leaf" }),
  ]);
  const leafRule = `[[(leaf ?n) [?n :node/text "leaf"]]]`;

  test("a declared % receives both rule sets", () => {
    const ir = reachIr("a", ":node/mentions", {
      in: ["%"],
      where: [{ kind: "rule", name: "leaf", args: [{ t: "var", name: "n" }] }],
    });
    expect(ids(index.run(ir, leafRule))).toEqual(["c"]);
  });

  test("% declared after another input still lines up", () => {
    const ir = reachIr("a", ":node/mentions", {
      in: ["text", "%"],
      where: [
        { kind: "pattern", entity: "n", attr: ":node/text", value: { t: "var", name: "text" } },
      ],
    });
    expect(ids(index.run(ir, "leaf", "[]"))).toEqual(["c"]);
  });
});

describe("children clause replaces the cartesian join", () => {
  const index = indexFor([
    node("p", { children: ["c1", "c2", "c3"] }),
    node("c1"),
    node("c2"),
    node("c3"),
  ]);
  const cartesian = `[:find ?cId ?ord :where [?p :node/id "p"] [?p :node/child ?c] [?p :node/child-order ?ord] [?c :node/id ?cId]]`;

  test("parse collapses child+child-order to children; compile returns N rows", () => {
    const ir = parseEdn(cartesian);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.where.some((c) => c.kind === "children")).toBe(true);
    const rows = index.run(ir);
    expect(sortedRows(rows)).toHaveLength(3);
  });

  test("child-order as the last clause still collapses", () => {
    const lastClause = `[:find ?id ?i :where [?p :node/id "p"] [?p :node/child ?c] [?c :node/id ?id] [?p :node/child-order ?i]]`;
    const ir = parseEdn(lastClause);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.where.some((c) => c.kind === "children")).toBe(true);
    // The find is kept as written; the order variable gets no column.
    expect(ir.find.some((p) => p.kind === "var" && p.name === "i")).toBe(true);
    expect(compile(ir).find?.some((p) => p.kind === "var" && p.name === "i")).toBe(false);
    expect(sortedRows(index.runDatalog(lastClause))).toHaveLength(3);
  });
});

describe("a find variable gets a column unless it is a children clause's order", () => {
  const index = indexFor([node("p", { text: "parent", children: ["c1", "c2", "c3"] }), node("c1")]);

  test("a variable bound only by :in is a column, as DataScript answers it", () => {
    const edn = '[:find ?t ?x :in $ ?x :where [?e :node/text ?t] [?e :node/id "p"]]';
    expect(index.runDatalog(edn, 7)).toEqual([["parent", 7]]);
  });

  test("a :node/child-order pattern without a :node/child one is kept, not dropped", () => {
    const edn = '[:find ?o :where [?p :node/id "p"] [?p :node/child-order ?o]]';
    expect(sortedRows(index.runDatalog(edn))).toEqual([[0]]);
  });

  test("a variable nothing binds is the engine's error, as in raw EDN", () => {
    const edn = "[:find ?id ?nowhere :where [?n :node/id ?id]]";
    expect(() => index.runDatalog(edn)).toThrow(DatalogError);
    expect(() => index.runDatalog(edn)).toThrow(/unknown vars/);
  });
});

const RULES_SUBTAG = `[[(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?parent]]
                       [(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?mid] (subtag ?mid ?parent)]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?tag]]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?sub] (subtag ?sub ?tag)]]`;

describe("rule-call args are node-ref unless bound as a scalar", () => {
  const index = indexFor([
    node("tag-root", { text: "root-tag" }),
    node("tag-child", {
      text: "child-tag",
      props: { "sys.f.onto.extends": [{ t: "ref", v: "tag-root" }] },
    }),
    node("n-tagged", {
      text: "tagged",
      props: { "sys.f.type": [{ t: "ref", v: "tag-child" }] },
    }),
    node("n-direct", {
      text: "direct",
      props: { "sys.f.type": [{ t: "ref", v: "tag-root" }] },
    }),
  ]);

  test("has-tag bound only by the rule revives through runIr", () => {
    const edn = `[:find ?n :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag)]`;
    const ir = parseEdn(edn);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.find).toEqual([{ kind: "var", name: "n", type: "node-ref" }]);
    const rows = index.run(ir, RULES_SUBTAG, "tag-root");
    expect(sortedRows(rows)).toEqual([["n-direct"], ["n-tagged"]]);
  });

  test("a rule arg bound as :node/text stays scalar", () => {
    const ir = parseEdn(`[:find ?text :in $ % :where (has-tag ?n ?tag) [?n :node/text ?text]]`);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.find).toEqual([{ kind: "var", name: "text", type: "scalar" }]);
  });
});
