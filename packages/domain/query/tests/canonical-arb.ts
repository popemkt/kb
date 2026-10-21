/**
 * A generator of canonical IR (`isCanonicalIr`), wide rather than runnable:
 * names drawn from the reader's whole symbol alphabet, every string the
 * writer must escape, every finite number, find positions of every kind. For
 * the printer's round trips; the runnable generator over a store is
 * `irArb` in ir.test.ts.
 *
 * Variables come from disjoint pools by role, so their find types are known
 * by construction: `n…` are nodes (entities, reach ends, node-valued
 * attributes, rule arguments), `s…` scalars (values of `:f/…` attributes
 * only), `i…` inputs, `o…` children orders, `p…` children parents.
 */
import fc from "fast-check";
import { PREDICATES, type Clause, type IrQuery, type PredicateArg, type Term } from "@kb/query";

type FindPos = IrQuery["find"][number];
type PullSpec = Extract<FindPos, { kind: "pull" }>["pattern"];

const SYMBOL_TAIL = "abcxyz019_-.*+!'<>=&?$%/".split("");
const KEYWORD_TAIL = "abcxyz019_-.*+/".split("");

const tail = (chars: string[], max: number) =>
  fc.string({ unit: fc.constantFrom(...chars), minLength: 0, maxLength: max });

const name = (prefix: string) => tail(SYMBOL_TAIL, 4).map((t) => `${prefix}${t}`);

const nodeVar = name("n");
const scalarVar = name("s");
const inVar = name("i");
const orderVar = name("o");
const parentVar = name("p");

/** A keyword no ref attribute is: never a node, so its variable value is a scalar. */
const scalarAttr = tail(KEYWORD_TAIL, 6).map((t) => `:f/${t}`);
/** Attributes whose variable value is a node (`REF_ATTRS`), `:node/child` aside: it would collapse. */
const nodeAttr = fc.constantFrom(":node/id", ":node/mentions", ":node/owner");
const anyAttr = fc.oneof(
  scalarAttr,
  nodeAttr,
  fc.constantFrom(":node/child", ":node/child-order", ":node/text"),
  tail(KEYWORD_TAIL, 8)
    .filter((t) => t.length > 0)
    .map((t) => `:${t}`),
);

/** Every string, including the ones the writer escapes: controls, quotes, backslashes, lone surrogates. */
const anyString = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)) }),
  fc.string({
    unit: fc.constantFrom('"', "\\", "\n", "\t", "\r", "\b", "\f", "\u0000", "\u007f", "a"),
  }),
);

const anyNumber = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
);

const literal: fc.Arbitrary<Term> = fc.oneof(
  anyString.map((value) => ({ t: "str" as const, value })),
  anyNumber.map((value) => ({ t: "num" as const, value })),
  fc.boolean().map((value) => ({ t: "bool" as const, value })),
);

const blank = fc.constant<Term>({ t: "blank" });
const nodeTerm: fc.Arbitrary<Term> = nodeVar.map((n) => ({ t: "var" as const, name: n }));
const scalarTerm: fc.Arbitrary<Term> = scalarVar.map((n) => ({ t: "var" as const, name: n }));

const pattern: fc.Arbitrary<Clause> = fc
  .oneof(
    fc.record({ entity: nodeVar, attr: nodeAttr, value: nodeTerm }),
    fc.record({ entity: nodeVar, attr: scalarAttr, value: scalarTerm }),
    fc.record({ entity: nodeVar, attr: anyAttr, value: fc.oneof(literal, blank) }),
  )
  .map((p) => ({ kind: "pattern" as const, ...p }));

const reach: fc.Arbitrary<Clause> = fc
  .record({
    from: nodeVar,
    to: nodeVar,
    edge: fc.oneof(nodeAttr, anyAttr),
    maxHops: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  })
  .map(({ maxHops, ...r }) => ({
    kind: "reach" as const,
    ...r,
    ...(maxHops === undefined ? {} : { maxHops }),
  }));

const rule: fc.Arbitrary<Clause> = fc
  .record({
    name: tail(SYMBOL_TAIL, 6).map((t) => `r${t}`),
    args: fc.array(fc.oneof(nodeTerm, literal, blank), { maxLength: 3 }),
  })
  .map((r) => ({ kind: "rule" as const, ...r }));

const termArg = (term: fc.Arbitrary<Term>): fc.Arbitrary<PredicateArg> =>
  term.filter((t): t is Exclude<Term, { t: "blank" }> => t.t !== "blank");

const predicateArg: fc.Arbitrary<PredicateArg> = fc.oneof(
  termArg(nodeTerm),
  termArg(scalarTerm),
  termArg(literal),
  fc.constant<PredicateArg>({ t: "src" }),
  anyAttr.map((value): PredicateArg => ({ t: "attr", value })),
);

const predicate: fc.Arbitrary<Clause> = fc
  .record({
    fn: fc.constantFrom(...PREDICATES),
    args: fc.array(predicateArg, { maxLength: 3 }),
    bind: fc.option(scalarVar, { nil: undefined }),
  })
  .map(({ bind, ...p }) => ({
    kind: "predicate" as const,
    ...p,
    ...(bind === undefined ? {} : { bind }),
  }));

/** `children` clauses with distinct parents, as one conjunction may hold them. */
const childrenClauses: fc.Arbitrary<Clause[]> = fc
  .uniqueArray(parentVar, { maxLength: 2 })
  .chain((parents) =>
    fc.tuple(
      ...parents.map((parent) =>
        fc.record({ child: nodeVar, order: orderVar }).map((c) => ({
          kind: "children" as const,
          parent,
          ...c,
        })),
      ),
    ),
  );

const joinArb = fc.option(fc.uniqueArray(nodeVar, { maxLength: 2 }), { nil: undefined });

/** One conjunction, nesting `or` and `not` up to `depth` deep. */
function conjunction(depth: number): fc.Arbitrary<Clause[]> {
  const nested: fc.Arbitrary<Clause>[] =
    depth === 0
      ? []
      : [
          fc
            .record({
              join: joinArb,
              branches: fc.array(conjunction(depth - 1), { minLength: 1, maxLength: 3 }),
            })
            .map(({ join, branches }) => ({
              kind: "or" as const,
              ...(join === undefined ? {} : { join }),
              branches,
            })),
          fc
            .record({ join: joinArb, clauses: conjunction(depth - 1) })
            .map(({ join, clauses }) => ({
              kind: "not" as const,
              ...(join === undefined ? {} : { join }),
              clauses,
            })),
        ];
  return fc
    .record({
      clauses: fc.array(fc.oneof(pattern, pattern, reach, rule, predicate, ...nested), {
        minLength: 1,
        maxLength: depth === 2 ? 6 : 3,
      }),
      children: childrenClauses,
    })
    .chain(({ clauses, children }) =>
      fc.shuffledSubarray([...clauses, ...children], {
        minLength: clauses.length + children.length,
      }),
    );
}

const pullSpec: fc.Arbitrary<PullSpec> = fc.letrec<{ spec: PullSpec }>((tie) => ({
  spec: fc.array(
    fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      anyAttr,
      fc.dictionary(anyAttr, tie("spec"), { maxKeys: 2 }),
    ),
    { maxLength: 3 },
  ),
})).spec;

/** The clauses of `where`'s own scope: its own, and every plain `or` branch's, recursively. */
function outer(where: readonly Clause[]): Clause[] {
  return where.flatMap((c) =>
    c.kind === "or" && c.join === undefined ? [c, ...c.branches.flatMap(outer)] : [c],
  );
}

/** The variables `where`'s own scope binds as nodes; by construction, only `n…` and `p…` ones. */
function nodeNames(where: readonly Clause[]): Set<string> {
  const names = new Set<string>();
  for (const c of outer(where)) {
    if (c.kind === "pattern") {
      names.add(c.entity);
      if (c.value.t === "var" && c.value.name.startsWith("n")) names.add(c.value.name);
    } else if (c.kind === "children") {
      names.add(c.parent);
      names.add(c.child);
    } else if (c.kind === "reach") {
      names.add(c.from);
      names.add(c.to);
    } else if (c.kind === "rule") {
      for (const a of c.args) if (a.t === "var") names.add(a.name);
    }
  }
  return names;
}

/** Every variable `where` names, at any depth. */
function allNames(where: readonly Clause[]): string[] {
  const names = new Set<string>();
  const term = (t: { t: string; name?: string }) => {
    if (t.t === "var" && t.name !== undefined) names.add(t.name);
  };
  const walk = (clauses: readonly Clause[]): void => {
    for (const c of clauses) {
      if (c.kind === "pattern") {
        names.add(c.entity);
        term(c.value);
      } else if (c.kind === "children") {
        for (const n of [c.parent, c.child, c.order]) names.add(n);
      } else if (c.kind === "reach") {
        names.add(c.from);
        names.add(c.to);
      } else if (c.kind === "rule" || c.kind === "predicate") {
        c.args.forEach(term);
        if (c.kind === "predicate" && c.bind !== undefined) names.add(c.bind);
      } else if (c.kind === "or") {
        c.branches.forEach(walk);
      } else {
        walk(c.clauses);
      }
    }
  };
  walk(where);
  return [...names];
}

export const canonicalIrArb: fc.Arbitrary<IrQuery> = fc
  .record({
    where: conjunction(2),
    inSlots: fc.option(
      fc.uniqueArray(fc.oneof(fc.constant("%"), inVar), { minLength: 1, maxLength: 3 }),
      { nil: undefined },
    ),
  })
  .chain(({ where, inSlots }) => {
    const named = [...allNames(where), ...(inSlots ?? []).filter((s) => s !== "%")];
    // A where of literal-only calls names nothing; an unbound find variable is a scalar.
    const vars = named.length > 0 ? named : ["u"];
    const nodes = nodeNames(where);
    const findPos: fc.Arbitrary<FindPos> = fc.oneof(
      fc.constantFrom(...vars).map((n) => ({
        kind: "var" as const,
        name: n,
        type: nodes.has(n) ? ("node-ref" as const) : ("scalar" as const),
      })),
      fc
        .record({
          op: fc.constantFrom("count" as const, "collect" as const),
          of: fc.constantFrom(...vars),
        })
        .map((a) => ({ kind: "aggregate" as const, ...a, type: "aggregate" as const })),
      fc.record({ of: fc.constantFrom(...vars), pattern: pullSpec }).map((p) => ({
        kind: "pull" as const,
        ...p,
        type: "node-ref" as const,
      })),
    );
    return fc.array(findPos, { minLength: 1, maxLength: 3 }).map(
      (find): IrQuery => ({
        kind: "query",
        find,
        ...(inSlots === undefined ? {} : { in: inSlots }),
        where,
      }),
    );
  });
