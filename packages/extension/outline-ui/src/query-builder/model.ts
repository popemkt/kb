/**
 * The query builder's model: a person's condition tree as they build it, the
 * edits the builder makes to it, and the one way it is written. Pure: no
 * React, no DOM.
 *
 * The tree is `@kb/query`'s condition model (`ir/conditions.ts`) with one
 * row of the builder's own, a `draft` — a condition a person is still
 * saying: no subject picked yet, or an operand not given yet — placed the
 * way the model places a row (`ConditionOf`). Whether an operand is given
 * is the draft's to say, never its value's: an empty text, tag or node is a
 * value like any other, and a row lifted from stored text is always a row.
 * What is written is the tree without its drafts, printed canonically,
 * `printEdn(lowerIr(…))` (`lowerIr` lowers a list's canonical form). The
 * tree is kept as the person built it; only the stored text is canonical
 * (docs/brainstorms/2026-10-20-query-builder → Switching between the
 * builder and the advanced editor).
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

/**
 * A condition a person is still saying: no subject picked yet (`row` null),
 * or a row whose operand they have not given yet, the operand's place in
 * `row` holding nothing anyone reads. It says nothing, so it is not written.
 */
export interface DraftRow {
  readonly kind: "draft";
  readonly row: ConditionRow | null;
}

/** One condition of a person's tree: a row of the model, a group, or a draft. */
export type BuilderCondition = ConditionOf<DraftRow>;

/** A condition that is not a group: a row, or a draft of one. */
export type Line = ConditionRow | DraftRow;

/** A person's conditions, ANDed, as they built them. */
export type BuilderTree = readonly BuilderCondition[];

export type Group = GroupOf<DraftRow>;

export type GroupKind = Group["kind"];

/** Where a condition is: an index into the top-level list, then into each group's children in turn. */
export type Path = readonly number[];

/** A condition just added: nothing said yet. */
export const BLANK: DraftRow = { kind: "draft", row: null };

/** The row a line is, or is a draft of; null while no subject is picked. */
export function rowOf(line: Line): ConditionRow | null {
  return line.kind === "draft" ? line.row : line;
}

/** `row`, as a row when its operand is given, else as a draft of one. */
function given(row: ConditionRow, operand: boolean): Line {
  return operand ? row : { kind: "draft", row };
}

/** `line` with its row changed by `f`, a draft still a draft: the edit gives no operand. */
function mapLine(line: Line, f: (row: ConditionRow) => ConditionRow): Line {
  if (line.kind !== "draft") return f(line);
  return line.row === null ? line : { kind: "draft", row: f(line.row) };
}

export function isGroupCondition(c: BuilderCondition): c is Group {
  return c.kind === "any-of" || c.kind === "all-of" || c.kind === "none-of";
}

/** A row about one field: what it says of the field's values. */
export type FieldRow = Extract<ConditionRow, { readonly field: string }>;

export function isFieldRow(row: ConditionRow): row is FieldRow {
  return "field" in row;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** Days, as the vocabulary counts them: a whole number. */
const isDayCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

function writableOne(c: BuilderCondition): Condition[] {
  if (c.kind === "draft") return [];
  if (c.kind === "all-of") return [{ kind: "all-of", conditions: writable(c.conditions) }];
  if (c.kind === "any-of" || c.kind === "none-of") {
    return [{ kind: c.kind, branches: c.branches.map(writable) }];
  }
  return [c];
}

/** What a person's tree says: the tree without its drafts. */
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

/** A new group of `kind`, holding one draft to say its first condition with. */
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

/** A line's subject; null while none is picked. */
export function subjectOf(line: Line): Subject | null {
  const row = rowOf(line);
  if (row === null) return null;
  if (isFieldRow(row)) return { t: "field", field: row.field };
  switch (row.kind) {
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

/** The line a newly picked attribute starts as: a draft until its operand is given. */
function attributeRow(attr: Attribute): Line {
  switch (attr) {
    case "has-tag":
    case "lacks-tag":
      return given({ kind: attr, tag: "" }, false);
    case "text":
      return given({ kind: "text-contains", text: "", exactCase: false }, false);
    case "created":
    case "edited":
      return { kind: "instant-within", attr, days: DEFAULT_DAYS.last };
    case "under":
    case "above":
      return given({ kind: attr, node: "", via: { t: "child" } }, false);
    case "child-of":
    case "links-to":
    case "linked-from":
      return given({ kind: attr, node: "" }, false);
    case "has-children":
      return { kind: "has-children" };
    default: {
      const _exhaustive: never = attr;
      return _exhaustive;
    }
  }
}

/** The line a subject starts as, picked over `from`: the same subject keeps its line. */
export function rowForSubject(subject: Subject, from: Line): Line {
  const same = subjectOf(from);
  if (subject.t === "attr") {
    return same?.t === "attr" && same.attr === subject.attr ? from : attributeRow(subject.attr);
  }
  if (same?.t === "field" && same.field === subject.field) return from;
  return given({ kind: "field-is", field: subject.field, values: [] }, false);
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

/** The values a field row holds, as `is` would hold them; a draft's operand is none. */
function valuesOfRow(row: FieldRow): readonly ConditionValue[] {
  switch (row.kind) {
    case "field-is":
    case "field-is-not":
      return row.values;
    case "field-contains":
      return [{ t: "str", v: row.text }];
    case "field-compares":
      return [row.value];
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

/** What a draft's comparison holds in its value's place: nothing anyone reads. */
const NO_VALUE: Extract<ConditionValue, { t: "str" }> = { t: "str", v: "" };

/** The values a line's operand holds: none for a draft or a row not about a field. */
function operandValues(line: Line): readonly ConditionValue[] {
  return line.kind !== "draft" && isFieldRow(line) ? valuesOfRow(line) : [];
}

/** `field contains` the first text among `values`: a draft when there is none. */
function containsLine(field: string, values: readonly ConditionValue[], exactCase: boolean): Line {
  const text = values.find(
    (v): v is Extract<ConditionValue, { t: "str" | "label" }> => v.t === "str" || v.t === "label",
  );
  return given(
    { kind: "field-contains", field, text: text?.v ?? "", exactCase },
    text !== undefined,
  );
}

/**
 * `line` with its operator changed to `op`, on the field it is about,
 * keeping what still applies: `is` and `is not` keep their values, a
 * comparison keeps one, `contains` keeps a text, a window keeps its days.
 * What it keeps nothing for is a draft.
 */
export function withOperator(line: Line, field: string, op: Operator): Line {
  const row = rowOf(line);
  const values = operandValues(line);
  const days = row?.kind === "date-within" ? row.days : undefined;
  switch (op) {
    case "is":
      return given({ kind: "field-is", field, values }, values.length > 0);
    case "is-not":
      return given({ kind: "field-is-not", field, values }, values.length > 0);
    case "contains":
      return containsLine(field, values, row?.kind === "field-contains" && row.exactCase);
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
    case ">=": {
      const value = comparable(values[0]);
      return given({ kind: "field-compares", field, op, value: value ?? NO_VALUE }, value !== null);
    }
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

/** A line's values as its field's editor holds them: none while it is a draft. */
export function rowValues(line: Line): PropValue[] {
  return operandValues(line).map(propValueOf);
}

/** `line` holding `values`, in the shape its operator takes them: a draft while they give none. */
export function withValues(line: Line, values: readonly PropValue[]): Line {
  const row = rowOf(line);
  if (row === null || !isFieldRow(row)) return line;
  const held = values.map(conditionValueOf);
  switch (row.kind) {
    case "field-is":
    case "field-is-not":
      return given({ ...row, values: held }, held.length > 0);
    case "field-contains": {
      const [first] = held;
      return given(
        { ...row, text: first === undefined ? "" : String(first.v) },
        first !== undefined,
      );
    }
    case "field-compares": {
      const value = comparable(held[0]);
      return given({ ...row, value: value ?? NO_VALUE }, value !== null);
    }
    case "date-within":
    case "field-set":
    case "field-unset":
      return line;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/** `line` counting `days`, when it counts days and `days` is a whole number of them. */
export function withDays(line: Line, days: number): Line {
  if (!isDayCount(days)) return line;
  return mapLine(line, (row) =>
    row.kind === "instant-within" || row.kind === "date-within" ? { ...row, days } : row,
  );
}

/** `line` naming `id`, given: the tag a tag row names, the node a node row names. */
export function withTarget(line: Line, id: string): Line {
  const row = rowOf(line);
  if (row?.kind === "has-tag" || row?.kind === "lacks-tag") return { ...row, tag: id };
  if (
    row?.kind === "under" ||
    row?.kind === "above" ||
    row?.kind === "child-of" ||
    row?.kind === "links-to" ||
    row?.kind === "linked-from"
  ) {
    return { ...row, node: id };
  }
  return line;
}

/** `line` matching `text`, when it matches text; a draft while there is none (`null`). */
export function withText(line: Line, text: string | null): Line {
  const row = rowOf(line);
  if (row?.kind !== "text-contains" && row?.kind !== "field-contains") return line;
  return given({ ...row, text: text ?? "" }, text !== null);
}

/** `line` with case counting or not, when it matches text. */
export function withExactCase(line: Line, exactCase: boolean): Line {
  return mapLine(line, (row) =>
    row.kind === "text-contains" || row.kind === "field-contains" ? { ...row, exactCase } : row,
  );
}

/** `line` walking `via`, when it walks. */
export function withVia(line: Line, via: ConditionEdge): Line {
  return mapLine(line, (row) =>
    row.kind === "under" || row.kind === "above" ? { ...row, via } : row,
  );
}

/** The tags a tree says a node has: the fields they template are the fields offered first. */
export function tagsOf(tree: BuilderTree): string[] {
  return tree.flatMap((c): string[] => {
    if (c.kind === "has-tag") return [c.tag];
    return isGroupCondition(c) ? tagsOf(childrenOf(c)) : [];
  });
}
