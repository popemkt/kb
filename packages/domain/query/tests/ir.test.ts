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
  value: { t: "var"; name: string } | { t: "str"; value: string },
): GenClause {
  return { kind: "pattern", entity, attr, value };
}

const irArb: fc.Arbitrary<IrQuery> = fc
  .record({
    idLiteral: fc.option(fc.constantFrom("n.todo", "p", "a"), { nil: null }),
    text: fc.constantFrom("omit", "var", "a todo", "leaf"),
    typeJoin: fc.boolean(),
    mentionsJoin: fc.boolean(),
    children: fc.boolean(),
    reach: fc.boolean(),
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
          type: name === "text" ? ("scalar" as const) : ("node-ref" as const),
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

describe("generated IR round-trips through compile(parseEdn(compile(ir)))", () => {
  const index = indexFor([
    node("sys.tag", { text: "tag" }),
    node("n.todo", {
      text: "a todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
    node("p", { children: ["c1", "c2"] }),
    node("c1", { text: "[[c2]]" }),
    node("c2"),
    node("a", { text: "[[b]]" }),
    node("b", { text: "[[c]]" }),
    node("c", { text: "leaf" }),
  ]);

  test("rows match query(edn) on the fixture", () => {
    const outcome = (edn: string, extra: unknown[]) => {
      try {
        return { rows: sortedRows(index.runDatalog(edn, ...extra)) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    fc.assert(
      fc.property(irArb, (ir) => {
        const compiled = compile(ir);
        const roundTripped = compile(parseEdn(compiled.query));
        const extra = compiled.rules !== undefined ? [compiled.rules] : [];
        expect(outcome(roundTripped.query, extra)).toEqual(outcome(compiled.query, extra));
      }),
      { numRuns: 50 },
    );
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
