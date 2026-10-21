/**
 * The query builder's model: a person's condition tree as they build it, the
 * edits the builder makes to it, and the one way it is written. Pure: no
 * React, no DOM.
 *
 * The tree is `@kb/query`'s condition model (`ir/conditions.ts`) with one
 * row of the builder's own, `blank` — a condition added and not yet said —
 * placed the way the model places a row (`ConditionOf`). What is written is
 * never the tree itself: a blank row and a row still missing what it needs
 * (`isComplete`) say nothing yet, so they are left out, and the rest is
 * printed canonically, `printEdn(lowerIr(…))` (`lowerIr` lowers a list's
 * canonical form). The tree is kept as the person built it; only the
 * stored text is canonical (docs/brainstorms/2026-10-20-query-builder →
 * Switching between the builder and the advanced editor).
 */
import type { FieldType, PropValue } from "@kb/model";
import {
  lift,
  lowerIr,
  parseEdn,
  printEdn,
  type CompareOp,
  type Condition,
  type ConditionEdge,
  type ConditionOf,
  type ConditionRow,
  type ConditionValue,
  type GroupOf,
  type Lifted,
} from "@kb/query";

/** A condition a person added and has not said anything with yet. */
export interface BlankRow {
  readonly kind: "blank";
}

/** One condition of a person's tree: a row of the model, a group, or a blank row. */
export type BuilderCondition = ConditionOf<BlankRow>;

/** A person's conditions, ANDed, as they built them. */
export type BuilderTree = readonly BuilderCondition[];

export type Group = GroupOf<BlankRow>;

export type GroupKind = Group["kind"];

/** Where a condition is: an index into the top-level list, then into each group's children in turn. */
export type Path = readonly number[];

export const BLANK: BlankRow = { kind: "blank" };

export function isGroupCondition(c: BuilderCondition): c is Group {
  return c.kind === "any-of" || c.kind === "all-of" || c.kind === "none-of";
}

/** A row about one field: what it says of the field's values. */
export type FieldRow = Extract<ConditionRow, { readonly field: string }>;

export function isFieldRow(row: ConditionRow | BlankRow): row is FieldRow {
  return "field" in row;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** Days, as the vocabulary counts them: a whole number. */
const isDayCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/** Whether a field row says what it needs of its field: a value, a whole number of days. */
function fieldRowSays(row: FieldRow): boolean {
  switch (row.kind) {
    case "field-set":
    case "field-unset":
      return true;
    case "date-within":
      return isDayCount(row.days);
    case "field-is":
    case "field-is-not":
    case "field-contains":
    case "field-compares":
      return valuesOfRow(row).length > 0;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/**
 * Whether a row says something yet: it has its tag, its node, its text, a
 * value, a whole number of days. A row that does not is the person's, on
 * screen, and is not written.
 */
export function isComplete(row: ConditionRow): boolean {
  if (isFieldRow(row)) return row.field !== "" && fieldRowSays(row);
  switch (row.kind) {
    case "has-tag":
    case "lacks-tag":
      return row.tag !== "";
    case "text-contains":
      return row.text !== "";
    case "instant-within":
      return isDayCount(row.days);
    case "under":
    case "above":
    case "child-of":
    case "links-to":
    case "linked-from":
      return row.node !== "";
    case "has-children":
      return true;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

function writableOne(c: BuilderCondition): Condition[] {
  if (c.kind === "blank") return [];
  if (c.kind === "all-of") return [{ kind: "all-of", conditions: writable(c.conditions) }];
  if (c.kind === "any-of" || c.kind === "none-of") {
    return [{ kind: c.kind, branches: c.branches.map(writable) }];
  }
  return isComplete(c) ? [c] : [];
}

/** What a person's tree says: the tree without its blank rows and the rows still missing what they need. */
export function writable(tree: BuilderTree): Condition[] {
  return tree.flatMap(writableOne);
}

/**
 * The stored text a person's tree is: what it says, lowered (which lowers
 * its canonical form) and printed.
 */
export function writtenEdn(tree: BuilderTree): string {
  return printEdn(lowerIr(writable(tree)));
}

/**
 * The conditions stored text is, or why it is not any: parsed, then lifted
 * all or nothing (`lift`). Reading never writes.
 */
export function readQuery(edn: string): Lifted {
  try {
    return lift(parseEdn(edn));
  } catch (error) {
    return { lifted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Paths and edits                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A group's children as the builder shows them: an `all-of`'s conditions,
 * or an `any-of` / `none-of`'s branches, one child each — a branch of one
 * condition is that condition, a longer one an `all-of` of them.
 */
export function childrenOf(group: Group): readonly BuilderCondition[] {
  if (group.kind === "all-of") return group.conditions;
  return group.branches.map((branch): BuilderCondition => {
    const [only] = branch;
    return branch.length === 1 && only !== undefined
      ? only
      : { kind: "all-of", conditions: branch };
  });
}

/**
 * `group` holding `children`, read back the way `childrenOf` reads them:
 * each child its own branch, so a group of one condition stays the group it
 * was built as. A branch of several (as stored text lifts to) is not
 * flattened back: canonicalisation, which every write goes through, says it
 * the same way.
 */
function withChildren(group: Group, children: readonly BuilderCondition[]): Group {
  if (group.kind === "all-of") return { kind: "all-of", conditions: children };
  return { kind: group.kind, branches: children.map((c) => [c]) };
}

/** The condition at `path`, if there is one. */
export function conditionAt(tree: BuilderTree, path: Path): BuilderCondition | undefined {
  const [head, ...rest] = path;
  if (head === undefined) return undefined;
  const here = tree[head];
  if (rest.length === 0 || here === undefined) return here;
  return isGroupCondition(here) ? conditionAt(childrenOf(here), rest) : undefined;
}

/** `tree` with the list the path `listPath` names (the top level for `[]`) replaced by `edit` of it. */
function editList(
  tree: BuilderTree,
  listPath: Path,
  edit: (list: readonly BuilderCondition[]) => readonly BuilderCondition[],
): BuilderTree {
  const [head, ...rest] = listPath;
  if (head === undefined) return edit(tree);
  const here = tree[head];
  if (here === undefined || !isGroupCondition(here)) return tree;
  const inner = withChildren(here, editList(childrenOf(here), rest, edit));
  return tree.map((c, i) => (i === head ? inner : c));
}

const parentOf = (path: Path): { list: Path; index: number } => ({
  list: path.slice(0, -1),
  index: path.at(-1) ?? 0,
});

/** `tree` with `condition` inserted at `path`, before what is there now. */
export function insertAt(tree: BuilderTree, path: Path, condition: BuilderCondition): BuilderTree {
  const { list, index } = parentOf(path);
  return editList(tree, list, (xs) => [...xs.slice(0, index), condition, ...xs.slice(index)]);
}

/** `tree` with the condition at `path` replaced by `condition`. */
export function replaceAt(tree: BuilderTree, path: Path, condition: BuilderCondition): BuilderTree {
  const { list, index } = parentOf(path);
  return editList(tree, list, (xs) => xs.map((c, i) => (i === index ? condition : c)));
}

/** `tree` without the condition at `path`. */
export function removeAt(tree: BuilderTree, path: Path): BuilderTree {
  const { list, index } = parentOf(path);
  return editList(tree, list, (xs) => xs.filter((_, i) => i !== index));
}

/** A new group of `kind`, holding one blank row to say its first condition with. */
export function newGroup(kind: GroupKind): Group {
  return kind === "all-of"
    ? { kind: "all-of", conditions: [BLANK] }
    : { kind, branches: [[BLANK]] };
}

/** `group` as a group of `kind`, its children kept. */
export function regroup(group: Group, kind: GroupKind): Group {
  return withChildren(kind === "all-of" ? { kind, conditions: [] } : { kind, branches: [] }, [
    ...childrenOf(group),
  ]);
}

/** Every path in `tree`, a group before its children. */
export function allPaths(tree: BuilderTree, prefix: Path = []): Path[] {
  return tree.flatMap((c, i) => {
    const path = [...prefix, i];
    return isGroupCondition(c) ? [path, ...allPaths(childrenOf(c), path)] : [path];
  });
}

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

/** What a row is about, beside a field: the sentences of the vocabulary that name no field. */
export const ATTRIBUTES = [
  "has-tag",
  "lacks-tag",
  "text",
  "created",
  "edited",
  "under",
  "above",
  "child-of",
  "has-children",
  "links-to",
  "linked-from",
] as const;

export type Attribute = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_LABELS: Readonly<Record<Attribute, string>> = {
  "has-tag": "has tag",
  "lacks-tag": "does not have tag",
  text: "text",
  created: "created",
  edited: "edited",
  under: "is under",
  above: "is above",
  "child-of": "is a child of",
  "has-children": "has children",
  "links-to": "links to",
  "linked-from": "is linked from",
};

/** The subject of a row: a field, or one of the vocabulary's own attributes. */
export type Subject =
  | { readonly t: "field"; readonly field: string }
  | { readonly t: "attr"; readonly attr: Attribute };

/** A row's subject; null for a blank row. */
export function subjectOf(row: ConditionRow | BlankRow): Subject | null {
  if (isFieldRow(row)) return { t: "field", field: row.field };
  switch (row.kind) {
    case "blank":
      return null;
    case "has-tag":
    case "lacks-tag":
    case "under":
    case "above":
    case "child-of":
    case "has-children":
    case "links-to":
    case "linked-from":
      return { t: "attr", attr: row.kind };
    case "text-contains":
      return { t: "attr", attr: "text" };
    case "instant-within":
      return { t: "attr", attr: row.attr };
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** How many days a new relative-date row counts, before the person says. */
const DEFAULT_DAYS = { next: 14, last: 7 } as const;

/** The row a newly picked attribute starts as. */
function attributeRow(attr: Attribute): ConditionRow {
  switch (attr) {
    case "has-tag":
    case "lacks-tag":
      return { kind: attr, tag: "" };
    case "text":
      return { kind: "text-contains", text: "", exactCase: false };
    case "created":
    case "edited":
      return { kind: "instant-within", attr, days: DEFAULT_DAYS.last };
    case "under":
    case "above":
      return { kind: attr, node: "", via: { t: "child" } };
    case "child-of":
    case "links-to":
    case "linked-from":
      return { kind: attr, node: "" };
    case "has-children":
      return { kind: "has-children" };
    default: {
      const _exhaustive: never = attr;
      return _exhaustive;
    }
  }
}

/** The row a subject starts as, picked over `from`: the same field keeps its row. */
export function rowForSubject(subject: Subject, from: ConditionRow | BlankRow): ConditionRow {
  if (subject.t === "attr") {
    const same = subjectOf(from);
    return same?.t === "attr" && same.attr === subject.attr && from.kind !== "blank"
      ? from
      : attributeRow(subject.attr);
  }
  const same = subjectOf(from);
  if (same?.t === "field" && same.field === subject.field && from.kind !== "blank") return from;
  return { kind: "field-is", field: subject.field, values: [] };
}

/* -------------------------------------------------------------------------- */
/* Operators                                                                   */
/* -------------------------------------------------------------------------- */

/** What a field row says of its field. */
export type Operator =
  | "is"
  | "is-not"
  | "contains"
  | CompareOp
  | "within-next"
  | "within-last"
  | "is-set"
  | "is-not-set";

/** How a field's values compare, by the kind of value its type holds. */
export type OperandKind = "text" | "number" | "date" | "node" | "checkbox";

export function operandKindOf(type: FieldType): OperandKind {
  switch (type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "ref":
      return "node";
    case "checkbox":
      return "checkbox";
    case "text":
    case "url":
    case "secret":
      return "text";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** The operators a field offers, by its operand kind (Notion, Linear: the operator adapts to the type). */
export const OPERATORS: Readonly<Record<OperandKind, readonly Operator[]>> = {
  text: ["is", "is-not", "contains", "is-set", "is-not-set"],
  number: ["is", "is-not", "<", "<=", ">", ">=", "is-set", "is-not-set"],
  date: ["is", "<", "<=", ">", ">=", "within-next", "within-last", "is-set", "is-not-set"],
  node: ["is", "is-not", "is-set", "is-not-set"],
  checkbox: ["is", "is-not", "is-set", "is-not-set"],
};

const COMPARE_LABELS: Readonly<Record<OperandKind, Readonly<Record<CompareOp, string>>>> = {
  number: { "<": "less than", "<=": "at most", ">": "greater than", ">=": "at least" },
  date: { "<": "before", "<=": "on or before", ">": "after", ">=": "on or after" },
  text: { "<": "before", "<=": "at most", ">": "after", ">=": "at least" },
  node: { "<": "before", "<=": "at most", ">": "after", ">=": "at least" },
  checkbox: { "<": "before", "<=": "at most", ">": "after", ">=": "at least" },
};

const OPERATOR_LABELS: Readonly<Record<Exclude<Operator, CompareOp>, string>> = {
  is: "is",
  "is-not": "is not",
  contains: "contains",
  "within-next": "within the next",
  "within-last": "in the last",
  "is-set": "is set",
  "is-not-set": "is not set",
};

export function operatorLabel(op: Operator, kind: OperandKind): string {
  return op === "<" || op === "<=" || op === ">" || op === ">="
    ? COMPARE_LABELS[kind][op]
    : OPERATOR_LABELS[op];
}

/** A field row's operator; null for a row that is not about a field. */
export function operatorOf(row: ConditionRow): Operator | null {
  if (!isFieldRow(row)) return null;
  switch (row.kind) {
    case "field-is":
      return "is";
    case "field-is-not":
      return "is-not";
    case "field-contains":
      return "contains";
    case "field-compares":
      return row.op;
    case "date-within":
      return row.direction === "next" ? "within-next" : "within-last";
    case "field-set":
      return "is-set";
    case "field-unset":
      return "is-not-set";
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** The values a field row holds, as `is` would hold them. */
function valuesOfRow(row: FieldRow): readonly ConditionValue[] {
  switch (row.kind) {
    case "field-is":
    case "field-is-not":
      return row.values;
    case "field-contains":
      return row.text === "" ? [] : [{ t: "str", v: row.text }];
    case "field-compares":
      return row.value.t === "str" && row.value.v === "" ? [] : [row.value];
    case "date-within":
    case "field-set":
    case "field-unset":
      return [];
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** A value a comparison can take: a number, or a text (a civil date is its text). */
function comparable(
  value: ConditionValue | undefined,
): Extract<ConditionValue, { t: "str" | "num" }> | null {
  if (value?.t === "num" || value?.t === "str") return value;
  if (value?.t === "label") return { t: "str", v: value.v };
  return null;
}

const NO_VALUE: Extract<ConditionValue, { t: "str" }> = { t: "str", v: "" };

/**
 * `row` with its operator changed to `op`, on the field it is about,
 * keeping what still applies: `is` and `is not` keep their values, a
 * comparison keeps one, `contains` keeps a text, a window keeps its days.
 */
export function withOperator(row: ConditionRow, field: string, op: Operator): ConditionRow {
  const values = isFieldRow(row) ? valuesOfRow(row) : [];
  const days = row.kind === "date-within" ? row.days : undefined;
  switch (op) {
    case "is":
      return { kind: "field-is", field, values };
    case "is-not":
      return { kind: "field-is-not", field, values };
    case "contains": {
      const text = values.find(
        (v): v is Extract<ConditionValue, { t: "str" | "label" }> =>
          v.t === "str" || v.t === "label",
      );
      return {
        kind: "field-contains",
        field,
        text: text?.v ?? "",
        exactCase: row.kind === "field-contains" ? row.exactCase : false,
      };
    }
    case "within-next":
      return { kind: "date-within", field, direction: "next", days: days ?? DEFAULT_DAYS.next };
    case "within-last":
      return { kind: "date-within", field, direction: "last", days: days ?? DEFAULT_DAYS.last };
    case "is-set":
      return { kind: "field-set", field };
    case "is-not-set":
      return { kind: "field-unset", field };
    case "<":
    case "<=":
    case ">":
    case ">=":
      return { kind: "field-compares", field, op, value: comparable(values[0]) ?? NO_VALUE };
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** A condition's value as a field holds it, so the field's own editor edits it. */
function propValueOf(value: ConditionValue): PropValue {
  return value.t === "label" ? { t: "str", v: value.v } : value;
}

/** A field's value as a condition compares with it: a date is its text. */
function conditionValueOf(value: PropValue): ConditionValue {
  return value.t === "date" ? { t: "str", v: value.v } : value;
}

/** A row's values as its field's editor holds them. */
export function rowValues(row: ConditionRow): PropValue[] {
  return isFieldRow(row) ? valuesOfRow(row).map(propValueOf) : [];
}

/** `row` holding `values`, in the shape its operator takes them. */
export function withValues(row: ConditionRow, values: readonly PropValue[]): ConditionRow {
  if (!isFieldRow(row)) return row;
  const held = values.map(conditionValueOf);
  switch (row.kind) {
    case "field-is":
    case "field-is-not":
      return { ...row, values: held };
    case "field-contains": {
      const [first] = held;
      return { ...row, text: first === undefined ? "" : String(first.v) };
    }
    case "field-compares":
      return { ...row, value: comparable(held[0]) ?? NO_VALUE };
    case "date-within":
    case "field-set":
    case "field-unset":
      return row;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** `row` counting `days`, when it counts days and `days` is a whole number of them. */
export function withDays(row: ConditionRow, days: number): ConditionRow {
  if (!isDayCount(days)) return row;
  return row.kind === "instant-within" || row.kind === "date-within" ? { ...row, days } : row;
}

/** `row` naming `id`: the tag a tag row names, the node a node row names. */
export function withTarget(row: ConditionRow, id: string): ConditionRow {
  if (row.kind === "has-tag" || row.kind === "lacks-tag") return { ...row, tag: id };
  if (
    row.kind === "under" ||
    row.kind === "above" ||
    row.kind === "child-of" ||
    row.kind === "links-to" ||
    row.kind === "linked-from"
  ) {
    return { ...row, node: id };
  }
  return row;
}

/** `row` matching text `text`, when it matches text. */
export function withText(row: ConditionRow, text: string): ConditionRow {
  return row.kind === "text-contains" || row.kind === "field-contains" ? { ...row, text } : row;
}

/** `row` with case counting or not, when it matches text. */
export function withExactCase(row: ConditionRow, exactCase: boolean): ConditionRow {
  return row.kind === "text-contains" || row.kind === "field-contains"
    ? { ...row, exactCase }
    : row;
}

/** `row` walking `via`, when it walks. */
export function withVia(row: ConditionRow, via: ConditionEdge): ConditionRow {
  return row.kind === "under" || row.kind === "above" ? { ...row, via } : row;
}

/** The tags a tree says a node has: the fields they template are the fields offered first. */
export function tagsOf(tree: BuilderTree): string[] {
  return tree.flatMap((c): string[] => {
    if (c.kind === "has-tag" && c.tag !== "") return [c.tag];
    return isGroupCondition(c) ? tagsOf(childrenOf(c)) : [];
  });
}
