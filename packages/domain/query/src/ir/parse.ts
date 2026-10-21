import { present } from "@kb/model";
import { DatalogError } from "../datalog-error.ts";
import { CORE_DERIVED } from "../index/derived.ts";
import {
  PREDICATES,
  type Clause,
  type FindPos,
  type FindType,
  type Ir,
  type IrQuery,
  type PatternClause,
  type PredicateArg,
  type PredicateClause,
  type PredicateName,
  type PullSpec,
  type ReachClause,
  type Term,
} from "./ir.ts";
import { outerClauses } from "./scope.ts";
import { readEdn, type Edn } from "./edn.ts";

/**
 * Parse stored-form EDN into the kb IR. The subset is `:find` / `:in` / `:where`
 * over pattern clauses (`_` as a value), rule calls, `(reach …)`, calls to
 * `PREDICATES`, `or`/`or-join`/`not`/`not-join` over the same clauses,
 * `count`/`collect`/`pull`, and the child cartesian which collapses to
 * `children` (DESIGN.md → Query layer). Anything else is
 * `{ kind: "raw" }`. A malformed `reach` in a query that is otherwise in the
 * subset throws `DatalogError`.
 */
export function parseEdn(edn: string): Ir {
  const value = readEdn(edn);
  return (value === null ? null : queryFromEdn(value)) ?? { kind: "raw", edn };
}

/**
 * The names of a query's `:find` columns, in order: `?status` is `status`,
 * an aggregate or a pull is its function and its variable (`(count ?n)` is
 * `count_n`), and a name taken already gets `_2`, `_3`, …. Unlike
 * {@link parseEdn} this reads the `:find` section only, so a query outside the
 * IR subset (`or`, predicates) is still named. Null when the query is not one
 * EDN vector, or its result is not rows (a scalar `?x .` or a collection
 * `[?x ...]`), or `:keys` already names them.
 */
export function findColumns(edn: string): readonly string[] | null {
  const value = readEdn(edn);
  if (value?.k !== "vec") return null;
  const start = value.v.findIndex((item) => item.k === "kw" && item.v === ":find");
  if (start < 0 || value.v.some((item) => item.k === "kw" && item.v === ":keys")) return null;
  const end = value.v.findIndex((item, i) => i > start && item.k === "kw");
  const find = value.v.slice(start + 1, end < 0 ? undefined : end);
  const names = find.map(columnName);
  if (names.length === 0 || names.some((name) => name === null)) return null;
  const taken = new Map<string, number>();
  return names.map((name) => {
    const base = name ?? "";
    const seen = (taken.get(base) ?? 0) + 1;
    taken.set(base, seen);
    return seen === 1 ? base : `${base}_${seen}`;
  });
}

/** One `:find` element's column name, or null when it is no column (`.`, `...`, a tuple). */
function columnName(item: Edn): string | null {
  if (item.k === "sym") return item.v.startsWith("?") && item.v.length > 1 ? item.v.slice(1) : null;
  if (item.k !== "list") return null;
  const [op, ...args] = item.v;
  const variable = args.findLast((arg) => arg.k === "sym" && arg.v.startsWith("?"));
  if (op?.k !== "sym" || variable?.k !== "sym") return null;
  return `${op.v}_${variable.v.slice(1)}`;
}

type Sections = { find: Edn[]; in?: string[]; where: Edn[] };

function sectionMode(kw: string): "find" | "in" | "where" | null {
  if (kw === ":find") return "find";
  if (kw === ":in") return "in";
  if (kw === ":where") return "where";
  return null;
}

function splitSections(items: Edn[]): Sections | null {
  let mode: "find" | "in" | "where" | null = null;
  const find: Edn[] = [];
  const inSlots: string[] = [];
  const where: Edn[] = [];
  for (const item of items) {
    if (item.k === "kw") {
      const next = sectionMode(item.v);
      if (next !== null) {
        mode = next;
        continue;
      }
      if (item.v === ":with" || item.v === ":keys" || item.v === ":limit" || item.v === ":rules") {
        return null;
      }
    }
    if (mode === "find") find.push(item);
    else if (mode === "in") {
      const slot = inSlot(item);
      if (slot === null) return null;
      if (slot !== "$") inSlots.push(slot);
    } else if (mode === "where") where.push(item);
    else return null;
  }
  if (find.length === 0 || where.length === 0) return null;
  return { find, in: inSlots.length > 0 ? inSlots : undefined, where };
}

function inSlot(item: Edn): string | null {
  if (item.k === "sym" && item.v === "$") return "$";
  if (item.k === "sym" && item.v === "%") return "%";
  if (item.k === "sym" && item.v.startsWith("?")) return item.v.slice(1);
  return null;
}

function findPosFromEdn(item: Edn): FindPos | null {
  if (item.k === "sym" && item.v.startsWith("?")) {
    return { kind: "var", name: item.v.slice(1), type: "scalar" };
  }
  if (item.k !== "list" || item.v.length < 2) return null;
  const [op, of, pattern] = item.v;
  if (op?.k !== "sym" || of?.k !== "sym" || !of.v.startsWith("?")) return null;
  const name = of.v.slice(1);
  if (op.v === "count" || op.v === "collect") {
    return { kind: "aggregate", op: op.v, of: name, type: "aggregate" };
  }
  if (op.v === "pull" && pattern !== undefined) {
    const pull = pullFromEdn(pattern);
    if (pull === null) return null;
    return { kind: "pull", of: name, pattern: pull, type: "node-ref" };
  }
  return null;
}

function pullFromEdn(item: Edn): PullSpec | null {
  if (item.k === "vec") {
    const out: PullSpec = [];
    for (const el of item.v) {
      const one = pullElem(el);
      if (one === null) return null;
      out.push(one);
    }
    return out;
  }
  return null;
}

function pullElem(el: Edn): PullSpec[number] | null {
  if (el.k === "kw") return el.v;
  if (el.k !== "map") return null;
  const rec: { [attr: string]: PullSpec } = {};
  for (const [k, v] of el.v) {
    if (k.k !== "kw") return null;
    const nested = pullFromEdn(v);
    if (nested === null) return null;
    rec[k.v] = nested;
  }
  return rec;
}

function queryFromEdn(value: Edn): IrQuery | null {
  if (value.k !== "vec") return null;
  const sections = splitSections(value.v);
  if (sections === null) return null;
  const find = sections.find.map(findPosFromEdn);
  if (find.some((p) => p === null)) return null;
  const misuses: string[] = [];
  const where = conjunctionFromEdn(sections.where, misuses);
  if (where === null) return null;
  const [misused] = misuses;
  if (misused !== undefined) throw new DatalogError(misused);
  const typed = inferFindTypes(
    find.filter((p): p is FindPos => p !== null),
    where,
  );
  return {
    kind: "query",
    find: typed,
    ...(sections.in !== undefined && sections.in.length > 0 ? { in: sections.in } : {}),
    where,
  };
}

/**
 * A `reach` form that is kb's but malformed, recorded in the parse's
 * `misuses` and raised as a `DatalogError` only once the rest of the query is
 * known to be in the subset: a query that goes raw anyway is raw, malformed
 * reach included.
 */
const MISUSED = { kind: "misused" } as const;

type Parsed = Clause | typeof MISUSED | null;

/**
 * One conjunction's clauses (the top level, an `or` branch, a `not`), with
 * the child cartesian collapsed to `children` within it; null when one of
 * them is outside the subset.
 */
function conjunctionFromEdn(items: readonly Edn[], misuses: string[]): Clause[] | null {
  const out: Clause[] = [];
  for (const item of items) {
    const clause = clauseFromEdn(item, misuses);
    if (clause === null) return null;
    if (clause.kind !== "misused") out.push(clause);
  }
  return collapseChildOrder(out);
}

// GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]] — a clause outside the subset still makes the whole query raw, reach included.
function clauseFromEdn(item: Edn, misuses: string[]): Parsed {
  if (item.k === "vec") {
    return item.v[0]?.k === "list" ? predicateFromEdn(item.v) : patternFromEdn(item.v);
  }
  if (item.k !== "list") return null;
  const [head, ...rest] = item.v;
  if (head?.k !== "sym") return null;
  if (head.v === "or" || head.v === "or-join") return orFromEdn(head.v, rest, misuses);
  if (head.v === "not" || head.v === "not-join") return notFromEdn(head.v, rest, misuses);
  if (head.v === "and") return null;
  const reach = reachFromEdn(item.v);
  if (typeof reach === "string") {
    misuses.push(reach);
    return MISUSED;
  }
  return reach ?? ruleFromEdn(item.v);
}

/** `[?a ?b]` of a `-join` form as variable names; null when it is anything else. */
function joinFromEdn(item: Edn | undefined): string[] | null {
  if (item?.k !== "vec") return null;
  const names = item.v.map((v) => (v.k === "sym" && v.v.startsWith("?") ? v.v.slice(1) : null));
  return names.every((n) => n !== null) ? names : null;
}

/** The join vector a `-join` head takes, and the forms after it; a plain head has neither. */
function joined(
  joinHead: boolean,
  rest: readonly Edn[],
): { join?: string[]; forms: readonly Edn[] } | null {
  if (!joinHead) return { forms: rest };
  const join = joinFromEdn(rest[0]);
  return join === null ? null : { join, forms: rest.slice(1) };
}

function orFromEdn(head: string, rest: readonly Edn[], misuses: string[]): Clause | null {
  const split = joined(head === "or-join", rest);
  if (split === null || split.forms.length === 0) return null;
  const branches: Clause[][] = [];
  for (const form of split.forms) {
    const isAnd = form.k === "list" && form.v[0]?.k === "sym" && form.v[0].v === "and";
    const items = isAnd ? form.v.slice(1) : [form];
    if (items.length === 0) return null;
    const branch = conjunctionFromEdn(items, misuses);
    if (branch === null) return null;
    branches.push(branch);
  }
  return { kind: "or", ...(split.join === undefined ? {} : { join: split.join }), branches };
}

function notFromEdn(head: string, rest: readonly Edn[], misuses: string[]): Clause | null {
  const split = joined(head === "not-join", rest);
  if (split === null || split.forms.length === 0) return null;
  const clauses = conjunctionFromEdn(split.forms, misuses);
  if (clauses === null) return null;
  return { kind: "not", ...(split.join === undefined ? {} : { join: split.join }), clauses };
}

const PREDICATE_NAMES: ReadonlySet<string> = new Set(PREDICATES);

function isPredicateName(name: string): name is PredicateName {
  return PREDICATE_NAMES.has(name);
}

/** `[(f arg…)]` or `[(f arg…) ?out]` over a function of `PREDICATES`; null for any other. */
function predicateFromEdn(parts: Edn[]): PredicateClause | null {
  const [call, out, ...rest] = parts;
  if (call?.k !== "list" || rest.length > 0) return null;
  const [fn, ...argForms] = call.v;
  if (fn?.k !== "sym" || !isPredicateName(fn.v)) return null;
  const args = argForms.map(predicateArgFromEdn);
  if (!args.every((a) => a !== null)) return null;
  if (out === undefined) return { kind: "predicate", fn: fn.v, args };
  if (out.k !== "sym" || !out.v.startsWith("?")) return null;
  return { kind: "predicate", fn: fn.v, args, bind: out.v.slice(1) };
}

function predicateArgFromEdn(item: Edn): PredicateArg | null {
  if (item.k === "sym" && item.v === "$") return { t: "src" };
  if (item.k === "kw") return { t: "attr", value: item.v };
  const term = termFromEdn(item);
  return term === null || term.t === "blank" ? null : term;
}

/**
 * `(reach ?from <edge> ?to)` / `(reach ?from <edge> ?to <max>)` — DESIGN.md →
 * Query layer. A list headed `reach` with a keyword in the edge slot is kb's
 * form, so a malformed one is the message naming what is wrong rather than
 * null; the caller records it (`MISUSED`). Without the keyword the list is an
 * ordinary rule call.
 */
function reachFromEdn(parts: Edn[]): ReachClause | string | null {
  const [name, from, edge, to, max, ...rest] = parts;
  if (name?.k !== "sym" || name.v !== "reach" || edge?.k !== "kw") return null;
  const form = "(reach ?from <edge> ?to [max])";
  if (from?.k !== "sym" || !from.v.startsWith("?")) {
    return `reach: ?from must be a variable in ${form}`;
  }
  if (to?.k !== "sym" || !to.v.startsWith("?")) {
    return `reach: ?to must be a variable in ${form}`;
  }
  if (rest.length > 0) return `reach takes at most 4 arguments: ${form}`;
  const clause: ReachClause = {
    kind: "reach",
    from: from.v.slice(1),
    to: to.v.slice(1),
    edge: edge.v,
  };
  if (max === undefined) return clause;
  if (max.k !== "num" || !Number.isInteger(max.v) || max.v < 1) {
    return `reach: max must be a positive integer in ${form}`;
  }
  return { ...clause, maxHops: max.v };
}

function patternFromEdn(parts: Edn[]): PatternClause | null {
  if (parts.length !== 3) return null;
  const [e, a, v] = parts;
  if (e?.k !== "sym" || !e.v.startsWith("?")) return null;
  if (a?.k !== "kw") return null;
  const value = termFromEdn(v);
  if (value === null) return null;
  return { kind: "pattern", entity: e.v.slice(1), attr: a.v, value };
}

function ruleFromEdn(parts: Edn[]): Clause | null {
  const [name, ...args] = parts;
  if (name?.k !== "sym" || name.v.startsWith("?")) return null;
  const terms: Term[] = [];
  for (const a of args) {
    const t = termFromEdn(a);
    if (t === null) return null;
    terms.push(t);
  }
  return { kind: "rule", name: name.v, args: terms };
}

function termFromEdn(item: Edn | undefined): Term | null {
  if (item === undefined) return null;
  if (item.k === "sym" && item.v === "_") return { t: "blank" };
  if (item.k === "sym" && item.v.startsWith("?")) return { t: "var", name: item.v.slice(1) };
  if (item.k === "str") return { t: "str", value: item.v };
  if (item.k === "num") return { t: "num", value: item.v };
  if (item.k === "bool") return { t: "bool", value: item.v };
  return null;
}

function collapseChildOrder(where: Clause[]): Clause[] {
  const childByParent = new Map<string, string>();
  const orderByParent = new Map<string, string>();
  for (const c of where) {
    if (c.kind !== "pattern" || c.value.t !== "var") continue;
    if (c.attr === ":node/child") childByParent.set(c.entity, c.value.name);
    if (c.attr === ":node/child-order" && !orderByParent.has(c.entity)) {
      orderByParent.set(c.entity, c.value.name);
    }
  }
  for (const parent of orderByParent.keys()) {
    if (!childByParent.has(parent)) orderByParent.delete(parent);
  }
  const out: Clause[] = [];
  const emitted = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern" && c.value.t === "var" && orderByParent.has(c.entity)) {
      if (c.attr === ":node/child-order") continue;
      if (c.attr === ":node/child") {
        if (!emitted.has(c.entity)) {
          out.push({
            kind: "children",
            parent: c.entity,
            child: present(childByParent.get(c.entity), "child var"),
            order: present(orderByParent.get(c.entity), "order var"),
          });
          emitted.add(c.entity);
        }
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

/** The attrs whose value is a node: the stated ones, and every derived ref attribute. */
const REF_ATTRS = new Set<string>([
  ":node/id",
  ":node/child",
  ":node/children",
  ...CORE_DERIVED.map(({ attr }) => attr),
]);

/** `find` typed by `where`: a variable `where` binds as a node is a `node-ref`, any other a `scalar`. */
export function inferFindTypes(find: readonly FindPos[], where: readonly Clause[]): FindPos[] {
  const nodeRefs = collectNodeRefVars(where);
  return find.map((pos) => {
    if (pos.kind !== "var") return pos;
    const type: FindType = nodeRefs.has(pos.name) ? "node-ref" : "scalar";
    return { kind: "var", name: pos.name, type };
  });
}

/**
 * The variables of `where`'s own scope (`outerClauses`) bound as nodes. A
 * predicate's `?out` is a scalar; a rule argument is a node unless bound as
 * a scalar.
 */
function collectNodeRefVars(where: readonly Clause[]): Set<string> {
  const nodeRefs = new Set<string>();
  const scalars = new Set<string>();
  const outer = outerClauses(where);
  for (const c of outer) {
    if (c.kind === "predicate" && c.bind !== undefined) scalars.add(c.bind);
    if (c.kind === "pattern") {
      nodeRefs.add(c.entity);
      if (c.value.t === "var") {
        if (REF_ATTRS.has(c.attr)) nodeRefs.add(c.value.name);
        else scalars.add(c.value.name);
      }
    } else if (c.kind === "children") {
      nodeRefs.add(c.parent);
      nodeRefs.add(c.child);
    } else if (c.kind === "reach") {
      nodeRefs.add(c.from);
      nodeRefs.add(c.to);
    }
  }
  for (const c of outer) {
    if (c.kind !== "rule") continue;
    for (const a of c.args) {
      if (a.t === "var" && !scalars.has(a.name)) nodeRefs.add(a.name);
    }
  }
  return nodeRefs;
}
