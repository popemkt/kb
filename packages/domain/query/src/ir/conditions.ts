/**
 * The condition model: what a person can say about which nodes a query
 * answers, without writing datalog, and how it is the IR. One vocabulary,
 * and two placements: a query's `:where` (`lowerIr`, `lift`) and a view's
 * narrowing of its frame's rows (`evaluate.ts`). The rows, their lowering and the laws that hold
 * them are DESIGN.md → Query layer → Conditions; the design record is
 * docs/brainstorms/2026-10-20-query-builder.
 *
 * The subject of every condition is the result node, `?n`. Conditions in a
 * list are ANDed. A group is `any-of`, `all-of` or `none-of`; an `all-of` is
 * a branch's own list, so it exists in a person's tree and never in the
 * canonical form (`canonicalConditions`).
 */
import { SYSTEM_IDS } from "@kb/model";
import { alphaEquivalent } from "./alpha.ts";
import type {
  Clause,
  Ir,
  IrQuery,
  PatternClause,
  PredicateArg,
  PredicateClause,
  PredicateName,
  Term,
} from "./ir.ts";

/**
 * A value a field is compared with: a node (a ref to it), a literal, or a
 * `label`, the text a person typed, which matches a literal whose text it
 * is or a ref to a node whose id or text it is (a view filter's `:eq`).
 */
export type ConditionValue =
  | { readonly t: "ref"; readonly v: string }
  | { readonly t: "str"; readonly v: string }
  | { readonly t: "num"; readonly v: number }
  | { readonly t: "bool"; readonly v: boolean }
  | { readonly t: "label"; readonly v: string };

/** What `under` and `above` walk: the outline, the reference relation, or a ref field. */
export type ConditionEdge =
  | { readonly t: "child" }
  | { readonly t: "mentions" }
  | { readonly t: "field"; readonly field: string };

export type CompareOp = "<" | "<=" | ">" | ">=";

/** One row of the vocabulary: a sentence about `?n`. */
export type ConditionRow =
  | { readonly kind: "has-tag"; readonly tag: string }
  | { readonly kind: "lacks-tag"; readonly tag: string }
  | { readonly kind: "field-set"; readonly field: string }
  | { readonly kind: "field-unset"; readonly field: string }
  | {
      readonly kind: "field-is";
      readonly field: string;
      readonly values: readonly ConditionValue[];
    }
  | {
      readonly kind: "field-is-not";
      readonly field: string;
      readonly values: readonly ConditionValue[];
    }
  | {
      readonly kind: "field-contains";
      readonly field: string;
      readonly text: string;
      readonly exactCase: boolean;
    }
  | {
      readonly kind: "field-compares";
      readonly field: string;
      readonly op: CompareOp;
      readonly value: Extract<ConditionValue, { t: "str" | "num" }>;
    }
  | { readonly kind: "text-contains"; readonly text: string; readonly exactCase: boolean }
  /** `created` / `edited` in the last `days` days: an instant window ending now. */
  | { readonly kind: "instant-within"; readonly attr: "created" | "edited"; readonly days: number }
  /** A civil-date field within the next (today … today+days) or last (today−days … today) days. */
  | {
      readonly kind: "date-within";
      readonly field: string;
      readonly direction: "next" | "last";
      readonly days: number;
    }
  | {
      readonly kind: "under";
      readonly node: string;
      readonly via: ConditionEdge;
      readonly maxHops?: number;
    }
  | {
      readonly kind: "above";
      readonly node: string;
      readonly via: ConditionEdge;
      readonly maxHops?: number;
    }
  | { readonly kind: "child-of"; readonly node: string }
  | { readonly kind: "has-children" }
  | { readonly kind: "links-to"; readonly node: string }
  | { readonly kind: "linked-from"; readonly node: string };

/**
 * The model over rows and `X`, the rows a placement adds that the query
 * placement cannot hold; `Condition` adds none.
 */
export type ConditionOf<X extends PlacementRow> = ConditionRow | X | GroupOf<X>;

/** A row a placement adds to the vocabulary: any shape with a `kind` no row or group has. */
export type PlacementRow = { readonly kind: string };

/** A group of conditions: any branch holds, every one holds, or no branch holds. */
export type GroupOf<X extends PlacementRow> =
  | { readonly kind: "any-of"; readonly branches: readonly (readonly ConditionOf<X>[])[] }
  | { readonly kind: "all-of"; readonly conditions: readonly ConditionOf<X>[] }
  | { readonly kind: "none-of"; readonly branches: readonly (readonly ConditionOf<X>[])[] };

/** A condition a query's `:where` holds. */
export type Condition = ConditionOf<never>;

/**
 * Node text or any value — a ref by its node's label — contains `text`: a
 * view filter's `{:text …}`. The IR has no attribute variable, so a query
 * cannot say "any field": the row has no lowering, and only the narrowing
 * placement holds it. GAP [[01M5E7S398F4GM2490R3RZ3ZPP]]
 */
export type AnywhereContains = {
  readonly kind: "anywhere-contains";
  readonly text: string;
  readonly exactCase: boolean;
};

/** A condition a view's narrowing holds: the query's, and `anywhere-contains`. */
export type NarrowingCondition = ConditionOf<AnywhereContains>;

/** `has tag #t`: `type is t`, one row of the vocabulary under its own name. */
const TYPE_FIELD = SYSTEM_IDS.typeField;

/** The result node's variable, and the find variable its id is. */
const SUBJECT = "n";
const ID = "id";

/* -------------------------------------------------------------------------- */
/* Canonical conditions                                                        */
/* -------------------------------------------------------------------------- */

const ROW_KINDS: ReadonlySet<string> = new Set(
  Object.keys({
    "has-tag": true,
    "lacks-tag": true,
    "field-set": true,
    "field-unset": true,
    "field-is": true,
    "field-is-not": true,
    "field-contains": true,
    "field-compares": true,
    "text-contains": true,
    "instant-within": true,
    "date-within": true,
    under: true,
    above: true,
    "child-of": true,
    "has-children": true,
    "links-to": true,
    "linked-from": true,
  } satisfies Record<ConditionRow["kind"], true>),
);

export function isRow<X extends PlacementRow>(c: ConditionOf<X>): c is ConditionRow {
  return ROW_KINDS.has(c.kind);
}

export function isGroup<X extends PlacementRow>(c: ConditionOf<X>): c is GroupOf<X> {
  return c.kind === "any-of" || c.kind === "all-of" || c.kind === "none-of";
}

/** `c` as a `field-is`, when it is one or a `has-tag` (type is the tag). */
function asFieldIs<X extends PlacementRow>(
  c: ConditionOf<X>,
): { field: string; values: readonly ConditionValue[] } | undefined {
  if (!isRow(c)) return undefined;
  if (c.kind === "field-is") return c;
  if (c.kind === "has-tag") return { field: TYPE_FIELD, values: [{ t: "ref", v: c.tag }] };
  return undefined;
}

/** Branches that are each one `is` on one field, as one `field-is` of all their values. */
function mergedIs<X extends PlacementRow>(
  branches: readonly (readonly ConditionOf<X>[])[],
): Extract<ConditionRow, { kind: "field-is" }> | undefined {
  const rows = branches.map((b) =>
    b.length === 1 && b[0] !== undefined ? asFieldIs(b[0]) : undefined,
  );
  const first = rows[0];
  if (first === undefined || !rows.every((r) => r !== undefined && r.field === first.field)) {
    return undefined;
  }
  return { kind: "field-is", field: first.field, values: rows.flatMap((r) => r?.values ?? []) };
}

/** A row's operator form under "none of": is → is not, has tag → lacks tag, is set → is not set. */
function negationOf<X extends PlacementRow>(c: ConditionOf<X>): ConditionRow | undefined {
  if (!isRow(c)) return undefined;
  if (c.kind === "field-is") return { kind: "field-is-not", field: c.field, values: c.values };
  if (c.kind === "has-tag") return { kind: "lacks-tag", tag: c.tag };
  if (c.kind === "field-set") return { kind: "field-unset", field: c.field };
  return undefined;
}

function canonicalBranches<X extends PlacementRow>(
  branches: readonly (readonly ConditionOf<X>[])[],
): ConditionOf<X>[][] {
  return branches.map((b) => canonicalConditions(b)).filter((b) => b.length > 0);
}

function canonicalGroup<X extends PlacementRow>(g: GroupOf<X>): ConditionOf<X>[] {
  if (g.kind === "all-of") return canonicalConditions(g.conditions);
  let branches = canonicalBranches(g.branches);
  if (g.kind === "any-of") {
    if (branches.length === 0) return [];
    if (branches.length === 1) return branches[0] ?? [];
    const merged = mergedIs(branches);
    return merged === undefined ? [{ kind: "any-of", branches }] : canonicalConditions([merged]);
  }
  if (branches.length === 0) return [];
  const only = branches.length === 1 && branches[0]?.length === 1 ? branches[0][0] : undefined;
  if (only !== undefined && isGroup(only) && only.kind === "any-of")
    branches = only.branches.map((b) => [...b]);
  const single =
    mergedIs(branches) ??
    (branches.length === 1 && branches[0]?.length === 1 ? branches[0][0] : undefined);
  const negated = single === undefined ? undefined : negationOf(single);
  return negated === undefined ? [{ kind: "none-of", branches }] : canonicalConditions([negated]);
}

function canonicalOne<X extends PlacementRow>(c: ConditionOf<X>): ConditionOf<X>[] {
  if (isGroup(c)) return canonicalGroup(c);
  if (!isRow(c) || (c.kind !== "field-is" && c.kind !== "field-is-not")) return [c];
  const [only, ...more] = c.values;
  if (only === undefined) return [];
  if (c.field !== TYPE_FIELD || more.length > 0 || only.t !== "ref") return [c];
  return [
    c.kind === "field-is" ? { kind: "has-tag", tag: only.v } : { kind: "lacks-tag", tag: only.v },
  ];
}

/**
 * The canonical form of a condition list: the one tree of the trees that
 * lower to one IR (property 4). An `all-of` is spliced into its parent; an
 * empty group, branch or value list is dropped; an `any-of` of one branch is
 * that branch; an `any-of` or `none-of` whose branches are each one `is` on
 * one field is one multi-value row; a `none-of` of one row with an operator
 * form is that form (`is not`, `lacks tag`, `is not set`), and a `none-of`
 * of one `any-of` is a `none-of` of its branches; `type is` one node is
 * `has tag`. The UI keeps a person's tree as built and writes this.
 */
export function canonicalConditions<X extends PlacementRow>(
  conditions: readonly ConditionOf<X>[],
): ConditionOf<X>[] {
  return conditions.flatMap(canonicalOne);
}

/* -------------------------------------------------------------------------- */
/* Lowering                                                                    */
/* -------------------------------------------------------------------------- */

const v = (name: string): { t: "var"; name: string } => ({ t: "var", name });
const str = (value: string): { t: "str"; value: string } => ({ t: "str", value });
const BLANK: Term = { t: "blank" };

const pattern = (entity: string, attr: string, value: Term): PatternClause => ({
  kind: "pattern",
  entity,
  attr,
  value,
});

const call = (fn: PredicateName, args: PredicateArg[], bind?: string): PredicateClause => ({
  kind: "predicate",
  fn,
  args,
  ...(bind === undefined ? {} : { bind }),
});

const orJoin = (branches: Clause[][]): Clause => ({ kind: "or", join: [SUBJECT], branches });
const notJoin = (clauses: Clause[]): Clause => ({ kind: "not", join: [SUBJECT], clauses });

const fieldAttr = (field: string) => `:f/${field}`;

const INSTANT_ATTRS = { created: ":node/created-at", edited: ":node/updated-at" } as const;

function edgeAttr(edge: ConditionEdge): string {
  if (edge.t === "child") return ":node/child";
  if (edge.t === "mentions") return ":node/mentions";
  return fieldAttr(edge.field);
}

export const includesFn = (exactCase: boolean): "kb/includes?" | "kb/includes-ci?" =>
  exactCase ? "kb/includes?" : "kb/includes-ci?";

/** A query's own variables: one prefix per role, numbered across the query, so every branch has its own. */
class Vars {
  readonly #counts = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.#counts.get(prefix) ?? 0) + 1;
    this.#counts.set(prefix, n);
    return `${prefix}${n}`;
  }
}

/** The number a label reads as, when `String` of it is the label, as a view filter compared it. */
export function labelNumber(label: string): number | undefined {
  const n = Number(label);
  return label.trim() !== "" && Number.isFinite(n) && String(n) === label ? n : undefined;
}

/**
 * The branches one value of `field is` lowers to, each a conjunction over
 * `?n`: a literal is a pattern, a node is its id and a pattern, and a label
 * is every way a value reads as it — the text, a node's id, a node's text,
 * and the number or boolean whose text it is.
 */
function valueBranches(field: string, value: ConditionValue, vars: Vars): Clause[][] {
  const attr = fieldAttr(field);
  // The node first, then the value: bound the other way, a value that is a
  // string (a text, a dangling ref) reaches `[?v :node/id …]`'s entity slot,
  // and DataScript throws.
  const byNode = (nodeAttr: string, text: string): Clause[] => {
    const x = vars.next("v");
    return [pattern(x, nodeAttr, str(text)), pattern(SUBJECT, attr, v(x))];
  };
  switch (value.t) {
    case "ref":
      return [byNode(":node/id", value.v)];
    case "str":
      return [[pattern(SUBJECT, attr, str(value.v))]];
    case "num":
      return [[pattern(SUBJECT, attr, { t: "num", value: value.v })]];
    case "bool":
      return [[pattern(SUBJECT, attr, { t: "bool", value: value.v })]];
    case "label": {
      const n = labelNumber(value.v);
      return [
        [pattern(SUBJECT, attr, str(value.v))],
        byNode(":node/id", value.v),
        byNode(":node/text", value.v),
        ...(n === undefined ? [] : [[pattern(SUBJECT, attr, { t: "num", value: n })]]),
        ...(value.v === "true" || value.v === "false"
          ? [[pattern(SUBJECT, attr, { t: "bool", value: value.v === "true" })]]
          : []),
      ];
    }
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

/** A window `[lo, hi]` over `value`: two bound functions and two `<=`. */
function windowOf(
  value: string,
  lo: [PredicateName, PredicateArg[]],
  hi: [PredicateName, PredicateArg[]],
  vars: Vars,
): Clause[] {
  const s1 = vars.next("s");
  const s2 = vars.next("s");
  return [
    call(lo[0], lo[1], s1),
    call(hi[0], hi[1], s2),
    call("<=", [v(s1), v(value)]),
    call("<=", [v(value), v(s2)]),
  ];
}

const days = (n: number): PredicateArg => ({ t: "num", value: n });

/** A row's clauses about `?n`, from the row and the query's variables. */
type Lowering<K extends ConditionRow["kind"]> = (
  row: Extract<ConditionRow, { kind: K }>,
  vars: Vars,
) => Clause[];

/** `[?a :node/id "<node>"]` and the clause that relates the anchor `?a` to `?n`. */
function anchored(node: string, vars: Vars, relate: (a: string) => Clause): Clause[] {
  const a = vars.next("a");
  return [pattern(a, ":node/id", str(node)), relate(a)];
}

/** `[?n <attr> ?x]` and the test `[(fn ?x "text")]` over it. */
function contains(attr: string, text: string, exactCase: boolean, x: string): Clause[] {
  return [pattern(SUBJECT, attr, v(x)), call(includesFn(exactCase), [v(x), str(text)])];
}

const reachOf = (
  from: string,
  to: string,
  row: { via: ConditionEdge; maxHops?: number },
): Clause => ({
  kind: "reach",
  from,
  to,
  edge: edgeAttr(row.via),
  ...(row.maxHops === undefined ? {} : { maxHops: row.maxHops }),
});

/**
 * The vocabulary: each row and the clauses it lowers to, the subject `?n`.
 * A negated row is `not-join` over its positive one, so the two cannot drift.
 */
const LOWERINGS: { readonly [K in ConditionRow["kind"]]: Lowering<K> } = {
  "has-tag": (row, vars) =>
    lowerRow({ kind: "field-is", field: TYPE_FIELD, values: [{ t: "ref", v: row.tag }] }, vars),
  "lacks-tag": (row, vars) => [notJoin(lowerRow({ kind: "has-tag", tag: row.tag }, vars))],
  "field-set": (row) => [pattern(SUBJECT, fieldAttr(row.field), BLANK)],
  "field-unset": (row, vars) => [notJoin(lowerRow({ kind: "field-set", field: row.field }, vars))],
  "field-is": (row, vars) => {
    const branches = row.values.flatMap((value) => valueBranches(row.field, value, vars));
    return branches.length === 1 ? (branches[0] ?? []) : [orJoin(branches)];
  },
  "field-is-not": (row, vars) => [
    notJoin(lowerRow({ kind: "field-is", field: row.field, values: row.values }, vars)),
  ],
  "field-contains": (row, vars) =>
    contains(fieldAttr(row.field), row.text, row.exactCase, vars.next("v")),
  "field-compares": (row, vars) => {
    const x = vars.next("v");
    const value: PredicateArg =
      row.value.t === "num" ? { t: "num", value: row.value.v } : { t: "str", value: row.value.v };
    return [pattern(SUBJECT, fieldAttr(row.field), v(x)), call(row.op, [v(x), value])];
  },
  "text-contains": (row, vars) => contains(":node/text", row.text, row.exactCase, vars.next("x")),
  "instant-within": (row, vars) => {
    const c = vars.next("c");
    return [
      pattern(SUBJECT, INSTANT_ATTRS[row.attr], v(c)),
      ...windowOf(c, ["kb/instant-days-ago", [days(row.days)]], ["kb/instant-now", []], vars),
    ];
  },
  "date-within": (row, vars) => {
    const x = vars.next("v");
    const window =
      row.direction === "next"
        ? windowOf(x, ["kb/today", []], ["kb/date-in-days", [days(row.days)]], vars)
        : windowOf(x, ["kb/date-in-days", [days(0 - row.days)]], ["kb/today", []], vars);
    return [pattern(SUBJECT, fieldAttr(row.field), v(x)), ...window];
  },
  under: (row, vars) => anchored(row.node, vars, (a) => reachOf(a, SUBJECT, row)),
  above: (row, vars) => anchored(row.node, vars, (a) => reachOf(SUBJECT, a, row)),
  "child-of": (row, vars) => anchored(row.node, vars, (a) => pattern(a, ":node/child", v(SUBJECT))),
  "has-children": () => [pattern(SUBJECT, ":node/child", BLANK)],
  "links-to": (row, vars) =>
    anchored(row.node, vars, (a) => pattern(SUBJECT, ":node/mentions", v(a))),
  "linked-from": (row, vars) =>
    anchored(row.node, vars, (a) => pattern(a, ":node/mentions", v(SUBJECT))),
};

function lowerRow(row: ConditionRow, vars: Vars): Clause[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the table is keyed by kind, so LOWERINGS[row.kind] takes this row; TypeScript cannot correlate the two
  const lower = LOWERINGS[row.kind] as (row: ConditionRow, vars: Vars) => Clause[];
  return lower(row, vars);
}

function lowerConditions(conditions: readonly Condition[], vars: Vars): Clause[] {
  return conditions.flatMap((c): Clause[] => {
    if (!isGroup(c)) return lowerRow(c, vars);
    if (c.kind === "all-of") return lowerConditions(c.conditions, vars);
    const branches = c.branches.map((b) => lowerConditions(b, vars));
    if (c.kind === "any-of") return [orJoin(branches)];
    return [notJoin(branches.length === 1 ? (branches[0] ?? []) : [orJoin(branches)])];
  });
}

/**
 * The query a condition list asks, in its canonical form:
 * `[:find ?id :where [?n :node/id ?id] …]`, `?n` bound first so every
 * negation finds it bound, every `or` and `not` the `-join` form over `[?n]`
 * (DataScript requires a plain `or`'s branches to share their variables) and
 * every branch its own variables. Total over any tree: it lowers
 * `canonicalConditions(conditions)`, so an empty group is never lowered.
 */
export function lowerIr(conditions: readonly Condition[]): IrQuery {
  return {
    kind: "query",
    find: [{ kind: "var", name: ID, type: "node-ref" }],
    where: [
      pattern(SUBJECT, ":node/id", v(ID)),
      ...lowerConditions(canonicalConditions(conditions), new Vars()),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Lifting                                                                     */
/* -------------------------------------------------------------------------- */

/** What `lift` answers: the conditions a query is, or why it is not one. */
export type Lifted =
  | { readonly lifted: true; readonly conditions: readonly Condition[] }
  | { readonly lifted: false; readonly reason: string };

/** A clause list being read, the subject named as the query names it. */
interface Cursor {
  readonly clauses: readonly Clause[];
  readonly subject: string;
}

type Match<T> = { readonly value: T; readonly used: number } | undefined;

const isVarTerm = (
  t: Term | PredicateArg | undefined,
  name?: string,
): t is { t: "var"; name: string } => t?.t === "var" && (name === undefined || t.name === name);

const literalOf = (t: Term): ConditionValue | undefined => {
  if (t.t === "str") return { t: "str", v: t.value };
  if (t.t === "num") return { t: "num", v: t.value };
  if (t.t === "bool") return { t: "bool", v: t.value };
  return undefined;
};

/** `:f/<field>` → the field, else undefined. */
const fieldOf = (attr: string): string | undefined =>
  attr.startsWith(":f/") ? attr.slice(":f/".length) : undefined;

function edgeOf(attr: string): ConditionEdge | undefined {
  if (attr === ":node/child") return { t: "child" };
  if (attr === ":node/mentions") return { t: "mentions" };
  const field = fieldOf(attr);
  return field === undefined ? undefined : { t: "field", field };
}

const asPattern = (c: Clause | undefined): PatternClause | undefined =>
  c?.kind === "pattern" ? c : undefined;
const asCall = (c: Clause | undefined, fn?: PredicateName): PredicateClause | undefined =>
  c?.kind === "predicate" && (fn === undefined || c.fn === fn) ? c : undefined;

/** `[(lo…) ?s1] [(hi…) ?s2] [(<= ?s1 ?x)] [(<= ?x ?s2)]` at `at`: the two bound calls. */
function windowAt(
  clauses: readonly Clause[],
  at: number,
  x: string,
): [PredicateClause, PredicateClause] | undefined {
  const lo = asCall(clauses[at]);
  const hi = asCall(clauses[at + 1]);
  const le1 = asCall(clauses[at + 2], "<=");
  const le2 = asCall(clauses[at + 3], "<=");
  if (lo?.bind === undefined || hi?.bind === undefined || le1 === undefined || le2 === undefined) {
    return undefined;
  }
  const [a, b] = le1.args;
  const [c, d] = le2.args;
  return isVarTerm(a, lo.bind) && isVarTerm(b, x) && isVarTerm(c, x) && isVarTerm(d, hi.bind)
    ? [lo, hi]
    : undefined;
}

const dayCount = (fn: PredicateClause): number | undefined => {
  const [arg] = fn.args;
  return fn.args.length === 1 && arg?.t === "num" ? arg.value : undefined;
};

/** `[(fn ?x operand)]` at `clause`, a test (no `?out`) of `x` against one constant. */
function testOf(
  clause: Clause | undefined,
  x: string,
): { fn: PredicateName; operand: PredicateArg } | undefined {
  const test = asCall(clause);
  const [subject, operand] = test?.args ?? [];
  if (test === undefined || test.bind !== undefined || test.args.length !== 2) return undefined;
  return isVarTerm(subject, x) && operand !== undefined ? { fn: test.fn, operand } : undefined;
}

/** A `contains` test: the text and whether case counts. */
function containsOf(
  test: { fn: PredicateName; operand: PredicateArg } | undefined,
): { text: string; exactCase: boolean } | undefined {
  if (test === undefined || test.operand.t !== "str") return undefined;
  if (test.fn !== "kb/includes?" && test.fn !== "kb/includes-ci?") return undefined;
  return { text: test.operand.value, exactCase: test.fn === "kb/includes?" };
}

const COMPARE_OPS: ReadonlySet<string> = new Set(["<", "<=", ">", ">="] satisfies CompareOp[]);
const isCompareOp = (fn: string): fn is CompareOp => COMPARE_OPS.has(fn);

function compareOf(
  test: { fn: PredicateName; operand: PredicateArg } | undefined,
): { op: CompareOp; value: Extract<ConditionValue, { t: "str" | "num" }> } | undefined {
  if (test === undefined || !isCompareOp(test.fn)) return undefined;
  const { operand } = test;
  if (operand.t === "num") return { op: test.fn, value: { t: "num", v: operand.value } };
  if (operand.t === "str") return { op: test.fn, value: { t: "str", v: operand.value } };
  return undefined;
}

const isToday = (fn: PredicateClause) => fn.fn === "kb/today" && fn.args.length === 0;
const offsetOf = (fn: PredicateClause) => (fn.fn === "kb/date-in-days" ? dayCount(fn) : undefined);

/** A civil-date window over `x` at `at`: which way it runs from today, and how many days. */
function dateWindowOf(
  clauses: readonly Clause[],
  at: number,
  x: string,
): { direction: "next" | "last"; days: number } | undefined {
  const window = windowAt(clauses, at, x);
  if (window === undefined) return undefined;
  const [lo, hi] = window;
  const next = isToday(lo) ? offsetOf(hi) : undefined;
  if (next !== undefined) return { direction: "next", days: next };
  const last = isToday(hi) ? offsetOf(lo) : undefined;
  return last === undefined ? undefined : { direction: "last", days: 0 - last };
}

/** The row `[?n :f/<field> ?x]` heads at `at`, read with what follows it. */
function fieldValueRow(cur: Cursor, at: number, field: string, x: string): Match<ConditionRow> {
  const test = testOf(cur.clauses[at + 1], x);
  const contained = containsOf(test);
  if (contained !== undefined)
    return { value: { kind: "field-contains", field, ...contained }, used: 2 };
  const compared = compareOf(test);
  if (compared !== undefined)
    return { value: { kind: "field-compares", field, ...compared }, used: 2 };
  const window = dateWindowOf(cur.clauses, at + 1, x);
  return window === undefined
    ? undefined
    : { value: { kind: "date-within", field, ...window }, used: 5 };
}

/** `(reach …)` between the anchor `a` and the subject: under the anchor, or above it. */
function reachRow(next: Clause, a: string, s: string, node: string): ConditionRow | undefined {
  if (next.kind !== "reach") return undefined;
  const via = edgeOf(next.edge);
  if (via === undefined) return undefined;
  const hops = next.maxHops === undefined ? {} : { maxHops: next.maxHops };
  if (next.from === a && next.to === s) return { kind: "under", node, via, ...hops };
  if (next.from === s && next.to === a) return { kind: "above", node, via, ...hops };
  return undefined;
}

/** `[?a <attr> ?n]`: the anchor points at the subject. */
function fromAnchorRow(p: PatternClause, node: string): ConditionRow | undefined {
  if (p.attr === ":node/child") return { kind: "child-of", node };
  if (p.attr === ":node/mentions") return { kind: "linked-from", node };
  return undefined;
}

/** `[?n <attr> ?a]`: the subject points at the anchor. */
function toAnchorRow(p: PatternClause, node: string): ConditionRow | undefined {
  if (p.attr === ":node/mentions") return { kind: "links-to", node };
  const field = fieldOf(p.attr);
  return field === undefined
    ? undefined
    : { kind: "field-is", field, values: [{ t: "ref", v: node }] };
}

/** The row an anchor `[?a :node/id "<node>"]` at `at` heads, read with the clause after it. */
function anchoredRow(cur: Cursor, at: number, a: string, node: string): Match<ConditionRow> {
  const next = cur.clauses[at + 1];
  const s = cur.subject;
  const p = asPattern(next);
  let row: ConditionRow | undefined;
  if (next !== undefined && p === undefined) row = reachRow(next, a, s, node);
  else if (p?.entity === a && isVarTerm(p.value, s)) row = fromAnchorRow(p, node);
  else if (p?.entity === s && isVarTerm(p.value, a)) row = toAnchorRow(p, node);
  return row === undefined ? undefined : { value: row, used: 2 };
}

/** The row `[?n :f/<field> v]` heads: `_` is set, a literal is that value, a variable reads on. */
function subjectFieldRow(cur: Cursor, at: number, field: string, value: Term): Match<ConditionRow> {
  if (value.t === "blank") return { value: { kind: "field-set", field }, used: 1 };
  const literal = literalOf(value);
  if (literal !== undefined)
    return { value: { kind: "field-is", field, values: [literal] }, used: 1 };
  return value.t === "var" ? fieldValueRow(cur, at, field, value.name) : undefined;
}

const INSTANT_KINDS = ["created", "edited"] as const;

/** `[?n :node/created-at ?c]` / `:node/updated-at` and the window after it. */
function instantRow(cur: Cursor, at: number, p: PatternClause): Match<ConditionRow> {
  const attr = INSTANT_KINDS.find((k) => INSTANT_ATTRS[k] === p.attr);
  if (attr === undefined || p.value.t !== "var") return undefined;
  const window = windowAt(cur.clauses, at + 1, p.value.name);
  if (window === undefined) return undefined;
  const [lo, hi] = window;
  const n = lo.fn === "kb/instant-days-ago" ? dayCount(lo) : undefined;
  return hi.fn === "kb/instant-now" && hi.args.length === 0 && n !== undefined
    ? { value: { kind: "instant-within", attr, days: n }, used: 5 }
    : undefined;
}

/** The row a pattern at `at` heads. */
function patternRow(cur: Cursor, at: number, p: PatternClause): Match<ConditionRow> {
  if (p.entity !== cur.subject) {
    return p.attr === ":node/id" && p.value.t === "str"
      ? anchoredRow(cur, at, p.entity, p.value.value)
      : undefined;
  }
  const field = fieldOf(p.attr);
  if (field !== undefined) return subjectFieldRow(cur, at, field, p.value);
  if (p.attr === ":node/child" && p.value.t === "blank") {
    return { value: { kind: "has-children" }, used: 1 };
  }
  if (p.attr === ":node/text" && p.value.t === "var") {
    const contained = containsOf(testOf(cur.clauses[at + 1], p.value.name));
    return contained === undefined
      ? undefined
      : { value: { kind: "text-contains", ...contained }, used: 2 };
  }
  return instantRow(cur, at, p);
}

/**
 * One value of `field is` an `or` branch is, by its atoms: a literal, a node
 * by id, or a node by text (only ever a label's, so it is read back as one).
 */
type ValueAtom =
  | { readonly t: "value"; readonly value: ConditionValue }
  | { readonly t: "text"; readonly v: string };

function valueAtom(
  branch: readonly Clause[],
  subject: string,
): { field: string; atom: ValueAtom } | undefined {
  const [first, second, ...rest] = branch;
  const head = asPattern(first);
  if (head === undefined || rest.length > 0) return undefined;
  if (second === undefined) {
    const field = head.entity === subject ? fieldOf(head.attr) : undefined;
    const literal = literalOf(head.value);
    return field === undefined || literal === undefined
      ? undefined
      : { field, atom: { t: "value", value: literal } };
  }
  const value = asPattern(second);
  const field = value?.entity === subject ? fieldOf(value.attr) : undefined;
  if (field === undefined || !isVarTerm(value?.value, head.entity) || head.value.t !== "str") {
    return undefined;
  }
  if (head.attr === ":node/id") {
    return { field, atom: { t: "value", value: { t: "ref", v: head.value.value } } };
  }
  if (head.attr === ":node/text") return { field, atom: { t: "text", v: head.value.value } };
  return undefined;
}

/** The values an `or`'s atoms are: a label is the text, the id and the text of a node, then its number or boolean. */
function valuesOf(atoms: readonly ValueAtom[]): ConditionValue[] | undefined {
  const out: ConditionValue[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom === undefined) return undefined;
    if (atom.t === "value") {
      out.push(atom.value);
      continue;
    }
    const id = out.pop();
    const text = out.pop();
    if (id?.t !== "ref" || text?.t !== "str" || id.v !== atom.v || text.v !== atom.v)
      return undefined;
    out.push({ t: "label", v: atom.v });
    const n = labelNumber(atom.v);
    const extra = atoms[i + 1];
    if (n !== undefined || atom.v === "true" || atom.v === "false") {
      if (extra?.t !== "value") return undefined;
      i += 1;
    }
  }
  return out;
}

/** An `or` over `[?n]`: one `field is` of several values, or an `any-of`. */
function orRow(branches: readonly (readonly Clause[])[], subject: string): Condition | undefined {
  const atoms = branches.map((b) => valueAtom(b, subject));
  const field = atoms[0]?.field;
  if (field !== undefined && atoms.every((a) => a?.field === field)) {
    const values = valuesOf(atoms.flatMap((a) => (a === undefined ? [] : [a.atom])));
    if (values !== undefined) return { kind: "field-is", field, values };
  }
  const lifted = branches.map((b) => liftConjunction({ clauses: b, subject }));
  if (!lifted.every((b) => b !== undefined)) return undefined;
  return { kind: "any-of", branches: lifted };
}

/** A `not` over `[?n]`: the negation of what its body says. */
function notRow(clauses: readonly Clause[], subject: string): Condition | undefined {
  const body = liftConjunction({ clauses, subject });
  if (body === undefined) return undefined;
  const [only] = body;
  if (body.length === 1 && only !== undefined && isGroup(only) && only.kind === "any-of") {
    return { kind: "none-of", branches: only.branches };
  }
  return { kind: "none-of", branches: [body] };
}

const joinsSubject = (join: readonly string[] | undefined, subject: string) =>
  join?.length === 1 && join[0] === subject;

/** A conjunction's clauses as conditions, row by row, or undefined at the first that is no row. */
function liftConjunction(cur: Cursor): Condition[] | undefined {
  const out: Condition[] = [];
  let at = 0;
  while (at < cur.clauses.length) {
    const clause = cur.clauses[at];
    let match: Match<Condition>;
    if (clause?.kind === "pattern") match = patternRow(cur, at, clause);
    else if (clause?.kind === "or" && joinsSubject(clause.join, cur.subject)) {
      const row = orRow(clause.branches, cur.subject);
      match = row === undefined ? undefined : { value: row, used: 1 };
    } else if (clause?.kind === "not" && joinsSubject(clause.join, cur.subject)) {
      const row = notRow(clause.clauses, cur.subject);
      match = row === undefined ? undefined : { value: row, used: 1 };
    }
    if (match === undefined) return undefined;
    out.push(match.value);
    at += match.used;
  }
  return out;
}

/**
 * The conditions `ir` is, all or nothing: proposed by structure (variable
 * names are free; a hand-written `[?task :f/sys.f.type ?tag] [?tag :node/id
 * "todo"]` is "has tag #todo"), then accepted only when lowering them gives
 * a query alpha-equivalent to `ir`, so lifting a query and writing it back
 * never changes what it asks (property 6). Anything else — a raw query, a
 * find or input the builder does not write, a clause outside the
 * vocabulary — answers why it does not lift.
 */
export function lift(ir: Ir): Lifted {
  if (ir.kind === "raw") return { lifted: false, reason: "the query is outside the IR subset" };
  const [find] = ir.find;
  if (ir.find.length !== 1 || find?.kind !== "var" || ir.in !== undefined) {
    return { lifted: false, reason: "its :find or :in is not the builder's [:find ?id]" };
  }
  const [head, ...rest] = ir.where;
  if (head?.kind !== "pattern" || head.attr !== ":node/id" || !isVarTerm(head.value, find.name)) {
    return { lifted: false, reason: "its first clause does not bind the result node's id" };
  }
  const proposed = liftConjunction({ clauses: rest, subject: head.entity });
  if (proposed === undefined)
    return { lifted: false, reason: "a clause is outside the vocabulary" };
  const conditions = canonicalConditions(proposed);
  if (!alphaEquivalent(lowerIr(conditions), ir)) {
    return { lifted: false, reason: "written back, it would ask something else" };
  }
  return { lifted: true, conditions };
}
