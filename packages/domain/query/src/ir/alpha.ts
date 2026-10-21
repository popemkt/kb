/**
 * Alpha-equivalence of two queries: the same query up to a consistent
 * renaming of its variables, with scope respected. It is what `lift` checks a
 * proposed condition tree against (`conditions.ts`, property 6 of
 * docs/brainstorms/2026-10-20-query-builder).
 *
 * Scope follows DataScript, as `scope.ts` states it: an `or-join` branch and a
 * `not-join` body are scopes of their own, where the join vector's variables
 * are the enclosing scope's and every other variable is local, so two
 * branches may each use a name for a variable of their own; a plain `or` or
 * `not` shares the scope around it.
 */
import type { Clause, FindPos, IrQuery, PredicateArg, PullSpec, Term } from "./ir.ts";

/** A bijection between the variables of two queries over one scope. */
interface Scope {
  readonly ab: Map<string, string>;
  readonly ba: Map<string, string>;
  /** Inside a `-join`, each join variable of the left query paired with the right's. */
  readonly join?: { readonly ab: ReadonlyMap<string, string>; readonly b: ReadonlySet<string> };
}

const scope = (join?: Scope["join"]): Scope => ({
  ab: new Map(),
  ba: new Map(),
  ...(join === undefined ? {} : { join }),
});

/**
 * Whether `x` (of the left query) and `y` (of the right) are one variable
 * here: paired by the join vector if either is a join variable, else paired
 * by the scope's bijection, extending it at a first occurrence.
 */
function sameVar(x: string, y: string, s: Scope): boolean {
  if (s.join !== undefined && (s.join.ab.has(x) || s.join.b.has(y))) return s.join.ab.get(x) === y;
  const mapped = s.ab.get(x);
  if (mapped !== undefined) return mapped === y;
  if (s.ba.has(y)) return false;
  s.ab.set(x, y);
  s.ba.set(y, x);
  return true;
}

const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean =>
  a.length === b.length && b.every((y, i) => i in a && eq(a[i] ?? y, y));

function sameTerm(a: Term, b: Term, s: Scope): boolean {
  if (a.t === "var" || b.t === "var")
    return a.t === "var" && b.t === "var" && sameVar(a.name, b.name, s);
  if (a.t === "blank" || b.t === "blank") return a.t === b.t;
  return a.t === b.t && Object.is(a.value, b.value);
}

function sameArg(a: PredicateArg, b: PredicateArg, s: Scope): boolean {
  if (a.t === "src" || b.t === "src") return a.t === b.t;
  if (a.t === "attr" || b.t === "attr")
    return a.t === "attr" && b.t === "attr" && a.value === b.value;
  return sameTerm(a, b, s);
}

function samePull(a: PullSpec, b: PullSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameFind(a: FindPos, b: FindPos, s: Scope): boolean {
  if (a.type !== b.type) return false;
  if (a.kind === "var") return b.kind === "var" && sameVar(a.name, b.name, s);
  if (a.kind === "aggregate") {
    return b.kind === "aggregate" && a.op === b.op && sameVar(a.of, b.of, s);
  }
  return b.kind === "pull" && sameVar(a.of, b.of, s) && samePull(a.pattern, b.pattern);
}

/**
 * The scope a `-join` opens inside `outer`, once its two join vectors are
 * paired there; a plain form (no vector on either side) shares `outer`.
 * `undefined` when the two forms differ in kind or their vectors do not pair.
 */
function inner(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
  outer: Scope,
): (() => Scope) | undefined {
  if (a === undefined || b === undefined) return a === b ? () => outer : undefined;
  if (!sameList(a, b, (x, y) => sameVar(x, y, outer))) return undefined;
  const join = { ab: new Map(b.map((y, i) => [a[i] ?? y, y])), b: new Set(b) };
  return () => scope(join);
}

function sameClauses(a: readonly Clause[], b: readonly Clause[], s: Scope): boolean {
  return sameList(a, b, (x, y) => sameClause(x, y, s));
}

type Of<K extends Clause["kind"]> = Extract<Clause, { kind: K }>;

/** How two clauses of one kind are one clause, by kind. */
const SAME: { readonly [K in Clause["kind"]]: (a: Of<K>, b: Of<K>, s: Scope) => boolean } = {
  pattern: (a, b, s) =>
    sameVar(a.entity, b.entity, s) && a.attr === b.attr && sameTerm(a.value, b.value, s),
  children: (a, b, s) =>
    sameVar(a.parent, b.parent, s) && sameVar(a.child, b.child, s) && sameVar(a.order, b.order, s),
  reach: (a, b, s) =>
    sameVar(a.from, b.from, s) &&
    sameVar(a.to, b.to, s) &&
    a.edge === b.edge &&
    a.maxHops === b.maxHops,
  rule: (a, b, s) => a.name === b.name && sameList(a.args, b.args, (x, y) => sameTerm(x, y, s)),
  predicate: (a, b, s) =>
    a.fn === b.fn &&
    sameList(a.args, b.args, (x, y) => sameArg(x, y, s)) &&
    (a.bind === undefined || b.bind === undefined ? a.bind === b.bind : sameVar(a.bind, b.bind, s)),
  or: (a, b, s) => {
    const open = inner(a.join, b.join, s);
    return (
      open !== undefined && sameList(a.branches, b.branches, (x, y) => sameClauses(x, y, open()))
    );
  },
  not: (a, b, s) => {
    const open = inner(a.join, b.join, s);
    return open !== undefined && sameClauses(a.clauses, b.clauses, open());
  },
};

function sameClause(a: Clause, b: Clause, s: Scope): boolean {
  if (a.kind !== b.kind) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAME is keyed by kind and both clauses are of a's; TypeScript cannot correlate the three
  const same = SAME[a.kind] as (a: Clause, b: Clause, s: Scope) => boolean;
  return same(a, b, s);
}

/**
 * Whether `a` and `b` are one query up to renaming: a bijection between their
 * variables, scope by scope, that maps every occurrence (the find spec, the
 * inputs and the join vectors included), under which they have the same
 * clauses in the same order, duplicates kept, and the same constants.
 */
export function alphaEquivalent(a: IrQuery, b: IrQuery): boolean {
  const top = scope();
  return (
    sameClauses(a.where, b.where, top) &&
    sameList(a.find, b.find, (x, y) => sameFind(x, y, top)) &&
    (a.in === undefined || b.in === undefined
      ? a.in === b.in
      : sameList(a.in, b.in, (x, y) => (x === "%" || y === "%" ? x === y : sameVar(x, y, top))))
  );
}
