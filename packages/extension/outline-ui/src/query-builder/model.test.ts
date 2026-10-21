/**
 * The builder's model, over trees a person could build: each tree is the
 * result of a sequence of the builder's own edits (add a condition or a
 * group, pick a subject, an operator, values, a node, text, days, an edge,
 * regroup, remove), applied from the empty tree, so what is proved is what
 * the screen can reach — drafts, rows said with empty values and empty
 * groups included — and over rows lifted from stored text, operands an
 * empty text, tag or node among them.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PropValue } from "@kb/model";
import { canonicalConditions, type ConditionEdge, type ConditionRow } from "@kb/query";
import {
  allPaths,
  ATTRIBUTES,
  BLANK,
  childrenOf,
  conditionAt,
  insertAt,
  isGroupCondition,
  newGroup,
  OPERATORS,
  readQuery,
  regroup,
  removeAt,
  replaceAt,
  rowForSubject,
  subjectOf,
  withDays,
  withExactCase,
  withOperator,
  withTarget,
  withText,
  withValues,
  withVia,
  writable,
  writtenEdn,
  type BuilderCondition,
  type BuilderTree,
  type GroupKind,
  type Line,
  type OperandKind,
  type Path,
  type Subject,
} from "./model";

/** The fields a person can pick, each with the kind of value its type holds. */
const FIELDS: Readonly<Record<string, OperandKind>> = {
  status: "node",
  due: "date",
  est: "number",
  note: "text",
  done: "checkbox",
};
const FIELD_IDS = Object.keys(FIELDS);

const nodeId = fc.oneof(fc.constantFrom("a", "b", "t.todo", "s.doing"), fc.string());
const textArb = fc.oneof(fc.constantFrom("draft", "Doing", ""), fc.string());

/** A value a field's own editor would hand back, by the kind of value it holds. */
function valueOf(kind: OperandKind): fc.Arbitrary<PropValue> {
  switch (kind) {
    case "node":
      return nodeId.map((v) => ({ t: "ref" as const, v }));
    case "date":
      return fc
        .date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true })
        .map((d) => ({ t: "date" as const, v: d.toISOString().slice(0, 10) }));
    case "number":
      return fc
        .oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }))
        .filter((n) => !Object.is(n, -0))
        .map((v) => ({ t: "num" as const, v }));
    case "checkbox":
      return fc.boolean().map((v) => ({ t: "bool" as const, v }));
    case "text":
      return textArb.map((v) => ({ t: "str" as const, v }));
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

const subject: fc.Arbitrary<Subject> = fc.oneof(
  fc.constantFrom(...FIELD_IDS).map((field) => ({ t: "field" as const, field })),
  fc.constantFrom(...ATTRIBUTES).map((attr) => ({ t: "attr" as const, attr })),
);
const groupKind = fc.constantFrom<GroupKind>("any-of", "all-of", "none-of");
const edge: fc.Arbitrary<ConditionEdge> = fc.oneof(
  fc.constant({ t: "child" as const }),
  fc.constant({ t: "mentions" as const }),
  fc.constantFrom(...FIELD_IDS).map((field) => ({ t: "field" as const, field })),
);

/** One of the builder's edits; `at` picks a place among those the tree has, modulo their count. */
type Edit =
  | { readonly op: "add"; readonly at: number; readonly index: number }
  | { readonly op: "group"; readonly at: number; readonly index: number; readonly kind: GroupKind }
  | { readonly op: "subject"; readonly at: number; readonly subject: Subject }
  | { readonly op: "operator"; readonly at: number; readonly pick: number }
  | { readonly op: "values"; readonly at: number; readonly seed: number }
  | { readonly op: "target"; readonly at: number; readonly id: string }
  | { readonly op: "text"; readonly at: number; readonly text: string | null }
  | { readonly op: "lift"; readonly at: number; readonly index: number; readonly row: number }
  | { readonly op: "case"; readonly at: number; readonly exact: boolean }
  | { readonly op: "days"; readonly at: number; readonly days: number }
  | { readonly op: "via"; readonly at: number; readonly via: ConditionEdge }
  | { readonly op: "regroup"; readonly at: number; readonly kind: GroupKind }
  | { readonly op: "remove"; readonly at: number }
  | {
      readonly op: "say";
      readonly at: number;
      readonly subject: Subject;
      readonly pick: number;
      readonly seed: number;
      readonly id: string;
      readonly text: string;
    };

const at = fc.nat();
const editArb: fc.Arbitrary<Edit> = fc.oneof(
  { arbitrary: fc.record({ op: fc.constant("add" as const), at, index: fc.nat() }), weight: 4 },
  {
    arbitrary: fc.record({
      op: fc.constant("group" as const),
      at,
      index: fc.nat(),
      kind: groupKind,
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ op: fc.constant("subject" as const), at, subject }), weight: 4 },
  { arbitrary: fc.record({ op: fc.constant("operator" as const), at, pick: fc.nat() }), weight: 3 },
  {
    arbitrary: fc.record({ op: fc.constant("values" as const), at, seed: fc.integer() }),
    weight: 3,
  },
  { arbitrary: fc.record({ op: fc.constant("target" as const), at, id: nodeId }), weight: 2 },
  {
    arbitrary: fc.record({
      op: fc.constant("text" as const),
      at,
      text: fc.option(textArb, { nil: null }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      op: fc.constant("lift" as const),
      at,
      index: fc.nat(),
      row: fc.nat(),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({ op: fc.constant("case" as const), at, exact: fc.boolean() }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      op: fc.constant("days" as const),
      at,
      days: fc.integer({ min: -3, max: 400 }),
    }),
    weight: 1,
  },
  { arbitrary: fc.record({ op: fc.constant("via" as const), at, via: edge }), weight: 1 },
  { arbitrary: fc.record({ op: fc.constant("regroup" as const), at, kind: groupKind }), weight: 1 },
  { arbitrary: fc.record({ op: fc.constant("remove" as const), at }), weight: 1 },
  {
    arbitrary: fc.record({
      op: fc.constant("say" as const),
      at,
      subject,
      pick: fc.nat(),
      seed: fc.integer(),
      id: nodeId,
      text: fc.string({ minLength: 1 }),
    }),
    weight: 5,
  },
);

const pickOf = <T>(xs: readonly T[], n: number): T | undefined =>
  xs.length === 0 ? undefined : xs[n % xs.length];

const rowPaths = (tree: BuilderTree) =>
  allPaths(tree).filter((p) => {
    const c = conditionAt(tree, p);
    return c !== undefined && !isGroupCondition(c);
  });
const groupPaths = (tree: BuilderTree) =>
  allPaths(tree).filter((p) => {
    const c = conditionAt(tree, p);
    return c !== undefined && isGroupCondition(c);
  });

/** The lists conditions can be added to: the top level, and every group's children. */
const listPaths = (tree: BuilderTree): Path[] => [[], ...groupPaths(tree)];

const listLength = (tree: BuilderTree, list: Path): number => {
  if (list.length === 0) return tree.length;
  return allPaths(tree).filter(
    (p) => p.length === list.length + 1 && list.every((x, i) => p[i] === x),
  ).length;
};

/**
 * Rows whose operand is a value a placeholder could be mistaken for — an
 * empty text, tag or node — as stored text lifts them: each is the lift of
 * the text the row writes.
 */
const EMPTY_OPERANDS: readonly ConditionRow[] = [
  { kind: "text-contains", text: "", exactCase: false },
  { kind: "text-contains", text: "", exactCase: true },
  { kind: "field-contains", field: "note", text: "", exactCase: false },
  { kind: "field-compares", field: "note", op: "<", value: { t: "str", v: "" } },
  { kind: "field-compares", field: "due", op: ">=", value: { t: "str", v: "" } },
  { kind: "field-is", field: "note", values: [{ t: "str", v: "" }] },
  { kind: "field-is-not", field: "note", values: [{ t: "str", v: "" }] },
  { kind: "has-tag", tag: "" },
  { kind: "lacks-tag", tag: "" },
  { kind: "under", node: "", via: { t: "child" } },
  { kind: "above", node: "", via: { t: "mentions" } },
  { kind: "child-of", node: "" },
  { kind: "links-to", node: "" },
  { kind: "linked-from", node: "" },
];
const LIFTED: readonly BuilderCondition[] = EMPTY_OPERANDS.flatMap((row) => {
  const read = readQuery(writtenEdn([row]));
  return read.lifted ? read.conditions : [];
});

/** A row edit at a row's path: the edit applies to rows it is about, else changes nothing. */
function editRow(
  tree: BuilderTree,
  n: number,
  edit: (line: Line) => BuilderCondition,
): BuilderTree {
  const path = pickOf(rowPaths(tree), n);
  if (path === undefined) return tree;
  const row = conditionAt(tree, path);
  if (row === undefined || isGroupCondition(row)) return tree;
  return replaceAt(tree, path, edit(row));
}

/** A field row with the operator `pick` names among those its field's type offers. */
function withPickedOperator(line: Line, pick: number): Line {
  const s = subjectOf(line);
  if (s?.t !== "field") return line;
  const op = pickOf(OPERATORS[FIELDS[s.field] ?? "text"], pick);
  return op === undefined ? line : withOperator(line, s.field, op);
}

/** A field row holding values its field's editor could hand back, drawn from `seed`. */
function withSampledValues(line: Line, seed: number, minLength = 0): Line {
  const s = subjectOf(line);
  if (s?.t !== "field") return line;
  const kind = FIELDS[s.field] ?? "text";
  const [values] = fc.sample(fc.array(valueOf(kind), { minLength, maxLength: 3 }), {
    numRuns: 1,
    seed,
  });
  return withValues(line, values ?? []);
}

type RowEdit = Extract<
  Edit,
  {
    readonly op:
      | "subject"
      | "operator"
      | "values"
      | "say"
      | "target"
      | "text"
      | "case"
      | "days"
      | "via";
  }
>;
type ListEdit = Exclude<Edit, RowEdit>;

const LIST_OPS: ReadonlySet<Edit["op"]> = new Set(["add", "group", "lift", "regroup", "remove"]);
const isListEdit = (edit: Edit): edit is ListEdit => LIST_OPS.has(edit.op);

/** What a row edit does to the row it lands on. */
function rowEdit(edit: RowEdit): (line: Line) => BuilderCondition {
  switch (edit.op) {
    case "subject":
      return (row) => rowForSubject(edit.subject, row);
    case "say":
      return (row) => {
        const picked = withPickedOperator(rowForSubject(edit.subject, row), edit.pick);
        return withText(withTarget(withSampledValues(picked, edit.seed, 1), edit.id), edit.text);
      };
    case "operator":
      return (line) => withPickedOperator(line, edit.pick);
    case "values":
      return (line) => withSampledValues(line, edit.seed);
    case "target":
      return (line) => withTarget(line, edit.id);
    case "text":
      return (line) => withText(line, edit.text);
    case "case":
      return (line) => withExactCase(line, edit.exact);
    case "days":
      return (line) => withDays(line, edit.days);
    case "via":
      return (line) => withVia(line, edit.via);
    default: {
      const _exhaustive: never = edit;
      return _exhaustive;
    }
  }
}

/** What an edit to the tree's lists does: a condition or group added, a group regrouped, a condition removed. */
function listEdit(tree: BuilderTree, edit: ListEdit): BuilderTree {
  switch (edit.op) {
    case "add":
    case "group":
    case "lift": {
      const list = pickOf(listPaths(tree), edit.at) ?? [];
      const index = edit.index % (listLength(tree, list) + 1);
      const added =
        edit.op === "add"
          ? BLANK
          : edit.op === "group"
            ? newGroup(edit.kind)
            : (pickOf(LIFTED, edit.row) ?? BLANK);
      return insertAt(tree, [...list, index], added);
    }
    case "regroup": {
      const path = pickOf(groupPaths(tree), edit.at);
      const group = path === undefined ? undefined : conditionAt(tree, path);
      return path === undefined || group === undefined || !isGroupCondition(group)
        ? tree
        : replaceAt(tree, path, regroup(group, edit.kind));
    }
    case "remove": {
      const path = pickOf(allPaths(tree), edit.at);
      return path === undefined ? tree : removeAt(tree, path);
    }
    default: {
      const _exhaustive: never = edit;
      return _exhaustive;
    }
  }
}

const apply = (tree: BuilderTree, edit: Edit): BuilderTree =>
  isListEdit(edit) ? listEdit(tree, edit) : editRow(tree, edit.at, rowEdit(edit));

/** A tree a person built: a sequence of the builder's edits from nothing. */
const builtTree: fc.Arbitrary<BuilderTree> = fc
  .array(editArb, { minLength: 4, maxLength: 48, size: "max" })
  .map((edits) => edits.reduce<BuilderTree>(apply, []));

const RUNS = { numRuns: 400 };

/** How many rows a tree holds, drafts not counted. */
const rows = (conditions: readonly BuilderCondition[]): number =>
  conditions.reduce(
    (n, c) => n + (isGroupCondition(c) ? rows(childrenOf(c)) : c.kind === "draft" ? 0 : 1),
    0,
  );

describe("the builder's model", () => {
  it("what a tree writes lifts back to the tree's canonical conditions", () => {
    fc.assert(
      fc.property(builtTree, (tree) => {
        const read = readQuery(writtenEdn(tree));
        expect(read.lifted ? read.conditions : read.reason).toEqual(
          canonicalConditions(writable(tree)),
        );
      }),
      RUNS,
    );
  });

  it("writing what stored text lifts to is that text, byte for byte", () => {
    fc.assert(
      fc.property(builtTree, (tree) => {
        const text = writtenEdn(tree);
        const read = readQuery(text);
        expect(read.lifted && writtenEdn(read.conditions)).toBe(text);
      }),
      RUNS,
    );
  });

  it("trees that say the same in another grouping write the same text", () => {
    fc.assert(
      fc.property(builtTree, (tree) => {
        const text = writtenEdn(tree);
        expect(writtenEdn([{ kind: "all-of", conditions: tree }, BLANK])).toBe(text);
        expect(writtenEdn([{ kind: "any-of", branches: [[...tree], []] }])).toBe(text);
      }),
      RUNS,
    );
  });

  it("a condition inserted is found where it was put, and removing it gives the tree back", () => {
    fc.assert(
      fc.property(builtTree, fc.nat(), fc.nat(), subject, (tree, list, index, s) => {
        const into = pickOf(listPaths(tree), list) ?? [];
        const path = [...into, index % (listLength(tree, into) + 1)];
        const row = rowForSubject(s, BLANK);
        const added = insertAt(tree, path, row);
        expect(conditionAt(added, path)).toEqual(row);
        expect(removeAt(added, path)).toEqual(tree);
      }),
      RUNS,
    );
  });

  it("replacing a condition leaves every condition not inside or around it as it was", () => {
    fc.assert(
      fc.property(builtTree, fc.nat(), subject, (tree, n, s) => {
        const path = pickOf(allPaths(tree), n);
        if (path === undefined) return;
        const next = replaceAt(tree, path, rowForSubject(s, BLANK));
        const related = (other: Path) =>
          other.slice(0, path.length).every((x, i) => x === path[i]) ||
          path.slice(0, other.length).every((x, i) => x === other[i]);
        for (const q of allPaths(tree).filter((other) => !related(other))) {
          expect(conditionAt(next, q)).toEqual(conditionAt(tree, q));
        }
      }),
      RUNS,
    );
  });

  it("every row a tree holds is written, whatever its values; only drafts are left out", () => {
    fc.assert(
      fc.property(builtTree, (tree) => {
        expect(rows(writable(tree))).toBe(rows(tree));
      }),
      RUNS,
    );
  });

  it("every row with an empty operand lifts, and an edit beside it keeps it written", () => {
    expect(LIFTED).toHaveLength(EMPTY_OPERANDS.length);
    for (const lifted of LIFTED) {
      const tree = insertAt(
        [lifted],
        [1],
        rowForSubject({ t: "attr", attr: "has-children" }, BLANK),
      );
      const read = readQuery(writtenEdn(tree));
      expect(read.lifted && read.conditions).toEqual(
        canonicalConditions([lifted, { kind: "has-children" }]),
      );
    }
  });

  it("a group holding one condition stays a group, whatever its kind", () => {
    for (const outer of ["any-of", "none-of", "all-of"] as const) {
      for (const inner of ["any-of", "none-of", "all-of"] as const) {
        const tree = insertAt([newGroup(outer)], [0, 0], newGroup(inner));
        expect(conditionAt(tree, [0, 0])).toEqual(newGroup(inner));
        expect(conditionAt(tree, [0, 0, 0])).toEqual(BLANK);
      }
    }
  });

  it("a row still missing what it needs says nothing, and an empty tree asks for every node", () => {
    const tree: BuilderTree = [BLANK, rowForSubject({ t: "field", field: "status" }, BLANK)];
    expect(writable(tree)).toEqual([]);
    expect(writtenEdn(tree)).toBe(writtenEdn([]));
    expect(readQuery(writtenEdn([]))).toEqual({ lifted: true, conditions: [] });
  });
});
