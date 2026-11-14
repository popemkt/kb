/**
 * What a match requires (DESIGN.md → Query layer → What a match requires):
 * its law is that a node made with what `requirementsOf` gives holds every
 * condition it did not count unmet, as the narrowing's evaluator answers it.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import {
  canonicalConditions,
  conditionGraph,
  conditionsMatcher,
  derivedWith,
  readQuery,
  requirementsOf,
  type Condition,
  type ConditionValue,
} from "@kb/query";

const AT = "2026-11-14T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"] = {}, children: string[] = []) {
  return { id, text, props, children, createdAt: AT, updatedAt: AT } satisfies KbNode;
}

const ref = (v: string) => ({ t: "ref" as const, v });
const fieldOf = (type: string, one = false) => ({
  [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)],
  [SYSTEM_IDS.fieldTypeField]: [ref(type)],
  ...(one ? { [SYSTEM_IDS.cardinalityField]: [ref(SYSTEM_IDS.cardinalityOne)] } : {}),
});

/** Two tags, a parent, and a field of each kind a label is read by. */
const GRAPH: KbNode[] = [
  node("t.task", "task", { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] }),
  node("t.bug", "bug", { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] }),
  node("inbox", "Inbox"),
  node("elsewhere", "Elsewhere"),
  node("f.status", "status", fieldOf(SYSTEM_IDS.ftRef, true), ["o.open", "o.doing"]),
  node("o.open", "Open"),
  node("o.doing", "Doing"),
  node("f.labels", "labels", fieldOf(SYSTEM_IDS.ftRef), ["o.red", "o.blue"]),
  node("o.red", "Red"),
  node("o.blue", "Blue"),
  node("f.est", "estimate", fieldOf(SYSTEM_IDS.ftNumber)),
  node("f.done", "done", fieldOf(SYSTEM_IDS.ftCheckbox)),
  node("f.note", "note", fieldOf(SYSTEM_IDS.ftText)),
];
const BY_ID = new Map(GRAPH.map((n) => [n.id, n]));
const read = (id: string) => BY_ID.get(id);

/** The node `requirementsOf` describes, put in the graph as `node.add` would put it. */
function made(conditions: readonly Condition[]): { nodes: KbNode[]; made: KbNode; unmet: number } {
  const req = requirementsOf(conditions, read);
  const props: KbNode["props"] = {};
  for (const tag of req.tags) (props[SYSTEM_IDS.typeField] ??= []).push(ref(tag));
  for (const { field, value } of req.props) (props[field] ??= []).push(value);
  const fresh = node("new", "", props);
  const nodes = GRAPH.map((n) =>
    n.id === req.parent ? { ...n, children: [...n.children, fresh.id] } : n,
  );
  return { nodes: [...nodes, fresh], made: fresh, unmet: req.unmet.length };
}

function holds(conditions: readonly Condition[], nodes: KbNode[], target: KbNode): boolean {
  const graph = conditionGraph(new Map(nodes.map((n) => [n.id, n])), derivedWith({}));
  return conditionsMatcher(conditions, graph)(target);
}

const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);
const FIELDS = ["f.status", "f.labels", "f.est", "f.done", "f.note", SYSTEM_IDS.typeField];
const valueArb: fc.Arbitrary<ConditionValue> = fc.oneof(
  pick(["o.open", "o.doing", "o.red", "t.task", "gone"]).map((v) => ({ t: "ref" as const, v })),
  pick(["Open", "x", ""]).map((v) => ({ t: "str" as const, v })),
  pick([3, 4.5]).map((v) => ({ t: "num" as const, v })),
  fc.boolean().map((v) => ({ t: "bool" as const, v })),
  pick(["Doing", "Red", "o.blue", "3", "true", "nothing", "Inbox"]).map((v) => ({
    t: "label" as const,
    v,
  })),
);
const rowArb: fc.Arbitrary<Condition> = fc.oneof(
  pick(["t.task", "t.bug", "gone"]).map((tag) => ({ kind: "has-tag" as const, tag })),
  pick(["t.task"]).map((tag) => ({ kind: "lacks-tag" as const, tag })),
  pick(["inbox", "elsewhere", "gone"]).map((n) => ({ kind: "child-of" as const, node: n })),
  fc
    .record({ field: pick(FIELDS), values: fc.array(valueArb, { minLength: 1, maxLength: 2 }) })
    .map((r) => ({ kind: "field-is" as const, ...r })),
  fc
    .record({ field: pick(FIELDS), values: fc.array(valueArb, { minLength: 1, maxLength: 1 }) })
    .map((r) => ({ kind: "field-is-not" as const, ...r })),
  pick(FIELDS).map((field) => ({ kind: "field-set" as const, field })),
  fc.constant({ kind: "text-contains" as const, text: "a", exactCase: false }),
);
const conditionArb: fc.Arbitrary<Condition> = fc.oneof(
  { weight: 4, arbitrary: rowArb },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.array(rowArb, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 2 })
      .map((branches) => ({ kind: "any-of" as const, branches })),
  },
);

describe("what a match requires", () => {
  test("a node made with what it gives holds every condition it did not count unmet", () => {
    fc.assert(
      fc.property(fc.array(conditionArb, { maxLength: 5 }), (conditions) => {
        const req = requirementsOf(conditions, read);
        // Unmet conditions are named in the canonical form they were read in.
        const unmet = new Set(req.unmet.map((c) => JSON.stringify(c)));
        const met = canonicalConditions(conditions).filter((c) => !unmet.has(JSON.stringify(c)));
        const { nodes, made: fresh } = made(conditions);
        expect(holds(met, nodes, fresh)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  test("tags, one value each and a parent are what a write can do", () => {
    const conditions: Condition[] = [
      { kind: "has-tag", tag: "t.task" },
      { kind: "field-is", field: "f.status", values: [{ t: "label", v: "Doing" }] },
      { kind: "field-is", field: "f.est", values: [{ t: "label", v: "3" }] },
      { kind: "field-is", field: "f.done", values: [{ t: "label", v: "true" }] },
      { kind: "field-is", field: "f.note", values: [{ t: "label", v: "Doing" }] },
      { kind: "child-of", node: "inbox" },
    ];
    expect(requirementsOf(conditions, read)).toEqual({
      tags: ["t.task"],
      props: [
        { field: "f.status", value: ref("o.doing") },
        { field: "f.est", value: { t: "num", v: 3 } },
        { field: "f.done", value: { t: "bool", v: true } },
        { field: "f.note", value: { t: "str", v: "Doing" } },
      ],
      parent: "inbox",
      unmet: [],
    });
  });

  test("what a write cannot choose for a person is unmet, never guessed", () => {
    const choice: Condition = {
      kind: "field-is",
      field: "f.status",
      values: [ref("o.open"), ref("o.doing")],
    };
    const negation: Condition = { kind: "lacks-tag", tag: "t.bug" };
    const unknown: Condition = {
      kind: "field-is",
      field: "f.status",
      values: [{ t: "label", v: "Nobody" }],
    };
    const req = requirementsOf([choice, negation, unknown], read);
    expect(req.props).toEqual([]);
    expect(req.unmet).toHaveLength(3);
  });

  test("two values of a field that holds one, or two parents, disagree and are unmet", () => {
    const req = requirementsOf(
      [
        { kind: "field-is", field: "f.status", values: [ref("o.open")] },
        { kind: "field-is", field: "f.status", values: [ref("o.doing")] },
        { kind: "child-of", node: "inbox" },
        { kind: "child-of", node: "elsewhere" },
        { kind: "field-is", field: "f.labels", values: [ref("o.red")] },
        { kind: "field-is", field: "f.labels", values: [ref("o.blue")] },
      ],
      read,
    );
    expect(req.parent).toBeNull();
    expect(req.props).toEqual([
      { field: "f.labels", value: ref("o.red") },
      { field: "f.labels", value: ref("o.blue") },
    ]);
    expect(req.unmet).toHaveLength(4);
  });

  test("a query's stored text is read as the builder reads it", () => {
    const reading = readQuery(
      '[:find ?id :where [?n :node/id ?id] [?t :node/id "t.task"] [?n :node/is ?t]]',
    );
    expect(reading).toEqual({ lifted: true, conditions: [{ kind: "has-tag", tag: "t.task" }] });
    expect(readQuery("[:find").lifted).toBe(false);
  });
});
