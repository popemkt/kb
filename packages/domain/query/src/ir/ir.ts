/**
 * kb-owned query IR — JSON-serialisable, covering the stored-query subset
 * plus r4's `reach` clause. Anything outside the subset is `{ kind: "raw" }`.
 *
 * Find positions are typed so a DataScript adapter can revive only `node-ref`
 * slots; aggregates that collide with live eids stay numbers.
 */

export type FindType = "node-ref" | "scalar" | "aggregate";

export type Term =
  | { t: "var"; name: string }
  | { t: "str"; value: string }
  | { t: "num"; value: number }
  | { t: "bool"; value: boolean };

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
 * (`compile`).
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

export type Clause = PatternClause | ChildrenClause | ReachClause | RuleCallClause;

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
