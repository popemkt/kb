/**
 * What a query run read, as datom patterns, and whether a transaction's
 * datoms touch it (DESIGN.md → Query layer → A run's read set).
 *
 * A run's answer is a function of the datoms its clauses can match, so it
 * can only change when a transaction adds or retracts a datom one of them
 * can match. The read set is those clauses, each narrowed to the entities
 * and values the rest of its conjunction allows, resolved against the db the
 * run read: `[?t :node/id "todo"] [?n :f/sys.f.type ?t]` reads the `todo`
 * node's id and `sys.f.type` datoms whose value is that node, not every
 * `sys.f.type` datom. Because it is the clauses and not the rows, a read
 * that found nothing is in it too: a node that would start matching is a
 * datom that matches a clause.
 *
 * Narrowing is only ever by what a conjunction requires of a variable, so a
 * narrowed clause still matches every datom that could change the answer.
 * Anything this cannot see into — a raw query, a caller's rules, a pull
 * that walks references or reads every attribute, more clauses than
 * {@link MAX_READS} — reads everything, and every transaction touches it.
 */
import type {
  Clause,
  FindPos,
  Ir,
  IrQuery,
  PredicateArg,
  PredicateClause,
  PredicateName,
} from "../ir/ir.ts";
import { findWithRefAttrs } from "../datascript.ts";
import { kbFunctions } from "../ir/kb-functions.ts";
import { outerClauses } from "../ir/scope.ts";
import type { DatascriptDb } from "./datoms.ts";

/** A datom as a transaction adds or retracts it. */
export interface ChangedDatom {
  readonly e: number;
  readonly a: string;
  readonly v: unknown;
}

/** Whether a datom's value may be one a clause matches: false only when it certainly is not. */
type ValueTest = (value: unknown) => boolean;

/** One clause a run read: the datoms of `attr`, of these entities when named, whose value passes every test. */
interface DatomRead {
  readonly attr: string;
  readonly entities?: ReadonlySet<number>;
  readonly values?: ReadonlySet<unknown>;
  readonly tests?: readonly ValueTest[];
}

/** What a run read: its clauses, or everything when it could not say. */
export type ReadSet =
  | { readonly kind: "everything" }
  | { readonly kind: "datoms"; readonly reads: readonly DatomRead[] };

const READS_EVERYTHING: ReadSet = { kind: "everything" };

/** Past this many clauses a run reads everything: a bound on what one remembered answer holds. */
const MAX_READS = 64;

/** What a conjunction requires of one variable. */
interface Narrowing {
  /** It is one of these entities (`[?v :node/id "x"]`); empty when the node does not exist. */
  readonly eids?: ReadonlySet<number>;
  readonly tests: readonly ValueTest[];
}

type Scope = ReadonlyMap<string, Narrowing>;

/** A run asked something this cannot read into. */
class Opaque extends Error {}

/**
 * The read set of `ir` run against `db`. The eids are as of that db: a node
 * created later is a `:node/id` datom the set reads, so its creation touches
 * the set before any eid in it is stale.
 */
export function readSetOf(ir: Ir, db: DatascriptDb): ReadSet {
  if (ir.kind === "raw") return READS_EVERYTHING;
  if ((ir.in ?? []).includes("%")) return READS_EVERYTHING;
  const reads: DatomRead[] = [];
  try {
    const top = conjunction(ir.where, new Map(), (id) => db.ids.toEid.get(id), reads);
    for (const pos of ir.find) pullReads(pos, top, reads);
    reads.push(...revivalReads(ir, db.refAttrs));
  } catch (error) {
    if (error instanceof Opaque) return READS_EVERYTHING;
    throw error;
  }
  return reads.length > MAX_READS ? READS_EVERYTHING : { kind: "datoms", reads };
}

/**
 * What reviving a run's rows reads: a field value revived as a node
 * (`findWithRefAttrs`) is a node id while its eid is a live node and a bare
 * number otherwise, so it reads every node's id — a number field's value and
 * a ref look alike (GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]).
 */
function revivalReads(ir: IrQuery, refAttrs: ReadonlySet<string>): DatomRead[] {
  const fieldValues = new Set(
    outerClauses(ir.where).flatMap((c) =>
      c.kind === "pattern" && c.value.t === "var" && c.attr !== ":node/id" ? [c.value.name] : [],
    ),
  );
  const revived = findWithRefAttrs(ir, ir.find, refAttrs).some(
    (pos) => pos.kind === "var" && pos.type === "node-ref" && fieldValues.has(pos.name),
  );
  return revived ? [{ attr: ":node/id" }] : [];
}

/** The attributes a find's pull reads off its entities; one it cannot list (`*`, a reverse attribute, a nested pull) is opaque. */
function pullReads(pos: FindPos, scope: Scope, reads: DatomRead[]): void {
  if (pos.kind !== "pull") return;
  const entities = scope.get(pos.of)?.eids;
  for (const el of pos.pattern) {
    // A reverse attribute (`:node/_child`) reads datoms whose value, not
    // entity, is the pulled one: opaque, as `*` is.
    if (typeof el !== "string" || el === "*" || el.split("/").at(-1)?.startsWith("_") === true) {
      throw new Opaque();
    }
    reads.push(entities === undefined ? { attr: el } : { attr: el, entities });
  }
}

/** What a conjunction knows while it reads its clauses in order. */
interface Reading {
  readonly scope: Map<string, Narrowing>;
  readonly eidOf: (id: string) => number | undefined;
  readonly reads: DatomRead[];
  /** Tests of later predicates that narrow an earlier pattern (`testsAhead`). */
  readonly ahead: ReadonlyMap<Clause, readonly ValueTest[]>;
  /** Entities another clause here requires to have a datom: their id clause reads nothing new. */
  readonly held: ReadonlySet<string>;
}

/**
 * The reads of one conjunction, given what its enclosing scope requires of
 * the variables it shares with it; returns what it requires of its own.
 */
function conjunction(
  clauses: readonly Clause[],
  outer: Scope,
  eidOf: (id: string) => number | undefined,
  reads: DatomRead[],
): Scope {
  // An entity's `:node/id` datom is added and retracted with every other
  // datom it has, so where another clause here requires the entity to have
  // one, the id clause can change nothing that clause would not see change.
  const held = new Set<string>();
  for (const c of clauses) {
    if (c.kind === "pattern" && c.attr !== ":node/id") held.add(c.entity);
    if (c.kind === "children") held.add(c.parent);
  }
  const reading: Reading = {
    scope: new Map(outer),
    eidOf,
    reads,
    ahead: testsAhead(clauses),
    held,
  };
  for (const c of clauses) {
    clauseReads(c, reading);
    narrow(reading.scope, c, eidOf);
  }
  return reading.scope;
}

/** `read` narrowed to the entities `entity` is required to be, when it is required to be any. */
function ofEntities(read: DatomRead, entities: ReadonlySet<number> | undefined): DatomRead {
  return entities === undefined ? read : { ...read, entities };
}

/** What clause `c` reads, given what its conjunction has required so far. */
function clauseReads(c: Clause, at: Reading): void {
  const { scope, reads } = at;
  switch (c.kind) {
    case "pattern":
      if (c.attr === ":node/id" && c.value.t !== "str" && at.held.has(c.entity)) return;
      reads.push(patternRead(c, at));
      return;
    case "children":
      reads.push(ofEntities({ attr: ":node/children" }, scope.get(c.parent)?.eids));
      return;
    case "reach":
      // A hop is any datom of the edge, and each end is tested for being a node.
      reads.push({ attr: c.edge }, { attr: ":node/id" });
      return;
    case "rule":
      throw new Opaque();
    case "predicate":
      if (c.fn === "missing?") reads.push(missingRead(c, scope));
      return;
    case "or":
      for (const branch of c.branches) conjunction(branch, shared(scope, c.join), at.eidOf, reads);
      return;
    case "not":
      conjunction(c.clauses, shared(scope, c.join), at.eidOf, reads);
      return;
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/** A pattern's datoms: its attribute, of the entities and with the values its scope allows. */
function patternRead(c: Extract<Clause, { kind: "pattern" }>, at: Reading): DatomRead {
  const read = ofEntities({ attr: c.attr }, at.scope.get(c.entity)?.eids);
  const value = c.value;
  if (value.t === "str" || value.t === "num" || value.t === "bool") {
    return { ...read, values: new Set([value.value]) };
  }
  if (value.t !== "var") return read;
  const of = at.scope.get(value.name);
  const tests = [...(of?.tests ?? []), ...(at.ahead.get(c) ?? [])];
  return {
    ...read,
    ...(of?.eids === undefined ? {} : { values: of.eids }),
    ...(tests.length === 0 ? {} : { tests }),
  };
}

/** `[(missing? $ ?e :attr)]` reads `?e`'s datoms of `:attr`. */
function missingRead(c: PredicateClause, scope: Scope): DatomRead {
  const [, entity, attr] = c.args;
  if (entity?.t !== "var" || attr?.t !== "attr") throw new Opaque();
  return ofEntities({ attr: attr.value }, scope.get(entity.name)?.eids);
}

/** What a nested `or` or `not` sees of its scope: every variable, or only its join vector's. */
function shared(scope: Scope, join: readonly string[] | undefined): Scope {
  if (join === undefined) return scope;
  const visible = new Map<string, Narrowing>();
  for (const name of join) {
    const of = scope.get(name);
    if (of !== undefined) visible.set(name, of);
  }
  return visible;
}

/**
 * What clause `c` requires of its variables, added to `scope`: an entity
 * named by id, a value a predicate tests against constants. Only the clauses
 * after `c` are narrowed by it. DataScript runs a conjunction's clauses in
 * the order they are written, so a clause before `c` meets every datom its
 * pattern matches, and one of those datoms can make the run throw (a string
 * reaching an entity slot) whatever `c` would have kept.
 */
function narrow(
  scope: Map<string, Narrowing>,
  c: Clause,
  eidOf: (id: string) => number | undefined,
): void {
  const by = (name: string, more: Partial<Narrowing>): void => {
    const was = scope.get(name) ?? { tests: [] };
    const before = was.eids;
    const eids =
      more.eids === undefined || before === undefined
        ? (more.eids ?? before)
        : new Set([...more.eids].filter((e) => before.has(e)));
    const next: Narrowing = { tests: [...was.tests, ...(more.tests ?? [])] };
    scope.set(name, eids === undefined ? next : { ...next, eids });
  };
  if (c.kind === "pattern" && c.attr === ":node/id" && c.value.t === "str") {
    const eid = eidOf(c.value.value);
    by(c.entity, { eids: new Set(eid === undefined ? [] : [eid]) });
  }
  if (c.kind === "predicate" && c.bind === undefined) {
    const test = testOf(c);
    if (test !== null) by(test.name, { tests: [test.test] });
  }
}

/**
 * The tests of predicates that narrow the pattern written just before them,
 * when that pattern binds the variable the predicate tests. Its other values
 * then reach no clause but the predicate, which drops them, so they can
 * neither change the answer nor make the run throw; the predicate itself
 * throws on none of the values its test rules out (`testOf`). A clause in
 * between would see those values first, and could throw on them.
 */
function testsAhead(clauses: readonly Clause[]): Map<Clause, ValueTest[]> {
  const ahead = new Map<Clause, ValueTest[]>();
  for (const [k, c] of clauses.entries()) {
    if (c.kind !== "predicate" || c.bind !== undefined) continue;
    const test = testOf(c);
    const before = clauses[k - 1];
    if (
      test !== null &&
      before?.kind === "pattern" &&
      before.value.t === "var" &&
      before.value.name === test.name &&
      before.entity !== test.name
    ) {
      ahead.set(before, [...(ahead.get(before) ?? []), test.test]);
    }
  }
  return ahead;
}

type Constant = string | number | boolean;

function isConstant(v: unknown): v is Constant {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function constantOf(arg: PredicateArg): Constant | null {
  return arg.t === "str" || arg.t === "num" || arg.t === "bool" ? arg.value : null;
}

/** A predicate's answer for two constants, in argument order. */
type Relation = (a: Constant, b: Constant) => boolean;

function order(a: Constant, b: Constant): number {
  const x = typeof a === "boolean" ? Number(a) : a;
  const y = typeof b === "boolean" ? Number(b) : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `relation` where the engine compares two values of one type; "may" across types, where it throws. */
const sameType =
  (relation: Relation): Relation =>
  (a, b) =>
    typeof a !== typeof b || relation(a, b);

/** `relation` over two strings; "may" for anything else, where the engine throws. */
const strings =
  (relation: (a: string, b: string) => boolean): Relation =>
  (a, b) =>
    typeof a !== "string" || typeof b !== "string" || relation(a, b);

const UNCLOCKED = kbFunctions(undefined);

/**
 * The predicates a test can be made of: each what DataScript answers for
 * two constants, or true ("may") wherever the two could differ. Values of
 * two types are never `=`.
 */
const RELATIONS: Partial<Record<PredicateName, Relation>> = {
  "=": (a, b) => typeof a === typeof b && a === b,
  "not=": (a, b) => typeof a !== typeof b || a !== b,
  "<": sameType((a, b) => order(a, b) < 0),
  "<=": sameType((a, b) => order(a, b) <= 0),
  ">": sameType((a, b) => order(a, b) > 0),
  ">=": sameType((a, b) => order(a, b) >= 0),
  "clojure.string/includes?": strings((a, b) => a.includes(b)),
  "clojure.string/starts-with?": strings((a, b) => a.startsWith(b)),
  "clojure.string/ends-with?": strings((a, b) => a.endsWith(b)),
  "kb/includes?": (a, b) => UNCLOCKED["kb/includes?"](a, b) === true,
  "kb/includes-ci?": (a, b) => UNCLOCKED["kb/includes-ci?"](a, b) === true,
};

/**
 * A predicate over one variable and one constant, as a test on that
 * variable's value (`RELATIONS`); a value that is not a constant (a children
 * vector) may match.
 */
function testOf(c: PredicateClause): { name: string; test: ValueTest } | null {
  const relation = RELATIONS[c.fn];
  if (relation === undefined || c.args.length !== 2) return null;
  const [first, second] = c.args;
  if (first === undefined || second === undefined) return null;
  if (first.t === "var" && second.t !== "var") {
    const constant = constantOf(second);
    if (constant === null) return null;
    return { name: first.name, test: (v) => !isConstant(v) || relation(v, constant) };
  }
  if (second.t === "var" && first.t !== "var") {
    const constant = constantOf(first);
    if (constant === null) return null;
    return { name: second.name, test: (v) => !isConstant(v) || relation(constant, v) };
  }
  return null;
}

/** Whether `datom` is one `read` can match. */
function matches(read: DatomRead, datom: ChangedDatom): boolean {
  if (read.entities !== undefined && !read.entities.has(datom.e)) return false;
  if (read.values !== undefined && !read.values.has(datom.v)) return false;
  return read.tests === undefined || read.tests.every((t) => t(datom.v));
}

/**
 * Whether a transaction whose datoms are `changed`, grouped by attribute,
 * can change the answer of a run that read `set`.
 */
export function touches(
  set: ReadSet,
  changed: ReadonlyMap<string, readonly ChangedDatom[]>,
): boolean {
  if (set.kind === "everything") return changed.size > 0;
  return set.reads.some((read) => (changed.get(read.attr) ?? []).some((d) => matches(read, d)));
}
