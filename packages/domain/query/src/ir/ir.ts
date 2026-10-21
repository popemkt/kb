/**
 * kb-owned query IR — JSON-serialisable, covering the stored-query subset
 * (DESIGN.md → Query layer). Anything outside the subset is `{ kind: "raw" }`.
 *
 * Find positions are typed so a DataScript adapter can revive only `node-ref`
 * slots; aggregates that collide with live eids stay numbers.
 */

export type FindType = "node-ref" | "scalar" | "aggregate";

export type Term =
  | { t: "var"; name: string }
  | { t: "str"; value: string }
  | { t: "num"; value: number }
  | { t: "bool"; value: boolean }
  /** `_`: matches anything, binds nothing. */
  | { t: "blank" };

/** Attribute as an EDN keyword, e.g. `:node/id` or `:f/sys.f.type`. */
type Attr = string;

export type PatternClause = {
  kind: "pattern";
  entity: string;
  attr: Attr;
  value: Term;
};

/**
 * The ordered-children idiom, written `[?parent :node/child ?child]
 * [?parent :node/child-order ?order]`: one row per child, projected from
 * `:node/children`, not the cartesian join the two patterns are. `order` is
 * the variable the written form names, kept so the clause prints back as
 * written; the projection does not bind it (in the written form it ranges
 * over every position, not the child's), so a find naming it has no column
 * (`compile`). It collapses in any conjunction: the top level, an `or`
 * branch, a `not`.
 */
type ChildrenClause = {
  kind: "children";
  parent: string;
  child: string;
  order: string;
};

/**
 * Transitive closure of `edge` from `from` to `to`: 1..∞ hops, or 1..`maxHops`.
 * Surface form and semantics: DESIGN.md → Query layer.
 */
export type ReachClause = {
  kind: "reach";
  from: string;
  to: string;
  edge: Attr;
  maxHops?: number;
};

type RuleCallClause = {
  kind: "rule";
  name: string;
  args: Term[];
};

/**
 * The predicates DataScript lacks, namespaced `kb/` and written as ordinary
 * calls: `compile` binds each as a function input, and only this registry
 * resolves the names, so a stored query cannot name a host function kb did
 * not register. What each answers: `kbFunctions` (`kb-functions.ts`).
 */
export const KB_FUNCTIONS = [
  "kb/includes?",
  "kb/includes-ci?",
  "kb/today",
  "kb/date-in-days",
  "kb/instant-now",
  "kb/instant-days-ago",
] as const;

export type KbFunctionName = (typeof KB_FUNCTIONS)[number];

/**
 * The functions a `[(f arg…)]` clause may call: a closed set, so the IR is a
 * kb-owned language and not any Clojure. A call to anything else keeps the
 * query `raw`.
 */
export const PREDICATES = [
  ...KB_FUNCTIONS,
  "=",
  "not=",
  "<",
  "<=",
  ">",
  ">=",
  "clojure.string/includes?",
  "clojure.string/starts-with?",
  "clojure.string/ends-with?",
  "missing?",
] as const;

export type PredicateName = (typeof PREDICATES)[number];

/**
 * A predicate's argument: a term other than `_`, the default source `$`
 * (written `$`, as `missing?` takes it first), or an attribute keyword (as
 * `missing?` takes it last).
 */
export type PredicateArg =
  | Exclude<Term, { t: "blank" }>
  | { t: "src" }
  | { t: "attr"; value: Attr };

/** `[(f arg…)]`, a test, or `[(f arg…) ?out]`, a function whose value binds `?out`. */
export type PredicateClause = {
  kind: "predicate";
  fn: PredicateName;
  args: PredicateArg[];
  bind?: string;
};

/**
 * `(or …)` / `(or-join [?v…] …)`: any of its branches holds. Each branch is a
 * conjunction, written `(and …)` when it is more than one form and bare when
 * it is one.
 */
type OrClause = { kind: "or"; join?: string[]; branches: Clause[][] };

/** `(not …)` / `(not-join [?v…] …)`: its clauses, together, do not hold. */
type NotClause = { kind: "not"; join?: string[]; clauses: Clause[] };

export type Clause =
  | PatternClause
  | ChildrenClause
  | ReachClause
  | RuleCallClause
  | PredicateClause
  | OrClause
  | NotClause;

export type PullSpec = Array<string | { [attr: string]: PullSpec }>;

export type FindPos =
  | { kind: "var"; name: string; type: FindType }
  | { kind: "aggregate"; op: "count" | "collect"; of: string; type: "aggregate" }
  | { kind: "pull"; of: string; pattern: PullSpec; type: "node-ref" };

export type IrQuery = {
  kind: "query";
  /** The `:find` spec as written, in order; what the compiled query returns is `compile`'s `find`. */
  find: FindPos[];
  /** Extra `:in` slots after `$` (`%` and `?vars`). */
  in?: string[];
  where: Clause[];
};

export type IrRaw = {
  kind: "raw";
  edn: string;
};

export type Ir = IrQuery | IrRaw;
