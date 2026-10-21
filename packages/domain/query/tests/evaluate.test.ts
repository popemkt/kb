/**
 * One contract, two implementations: the condition model answered by
 * `compile(lowerIr(conditions))` on kb's index, and by `conditionsMatcher`
 * in JS (the narrowing placement, GAP [[01M5E7RM5EQ2TSJZSMM330T5DH]]). Over
 * generated graphs and generated conditions, every node is answered alike.
 *
 * The graphs keep each field to the kinds a comparison is defined over (the
 * evaluator answers false across kinds, where DataScript orders them), and
 * their numbers clear of the eids a ref is stored as
 * (GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]).
 */
import {
  DatascriptIndex,
  conditionGraph,
  conditionsMatcher,
  derivedWith,
  lowerIr,
  type Condition,
  type ConditionValue,
  type NarrowingCondition,
} from "@kb/query";
import type { ClockSample, KbNode, PropValue } from "@kb/model";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { treeArb } from "./condition-arb.ts";

/** 2026-10-20T22:30Z: the 21st in Amsterdam, the 20th in UTC. */
const CLOCK: ClockSample = { nowMs: Date.UTC(2026, 9, 20, 22, 30), timeZone: "Europe/Amsterdam" };

const CONTENT = ["n0", "n1", "n2", "n3", "n4", "n5"];
const OPTIONS = ["o0", "o1"];
const TAGS = ["t0", "t1"];
const IDS = [...CONTENT, ...OPTIONS, ...TAGS];

const TEXTS = ["alpha", "Beta", "see [[n1]]", "", "step [[o0]]", "Doing", "1000.5", "true"];
const INSTANTS = [
  "2026-10-10T00:00:00.000Z",
  "2026-10-18T09:00:00.000Z",
  "2026-10-20T22:00:00.000Z",
  "2026-10-25T00:00:00.000Z",
];
const DATES = ["2026-10-14", "2026-10-20", "2026-10-21", "2026-11-03", "2026-11-04", "2027-01-01"];
const NUMBERS = [1000.5, 2000, 3.25, -7.5];

const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);
const ref = (ids: readonly string[]) => pick(ids).map((v): PropValue => ({ t: "ref", v }));
const str = (xs: readonly string[]) => pick(xs).map((v): PropValue => ({ t: "str", v }));

/** Each field and the values it may hold. */
const FIELD_VALUES: Record<string, fc.Arbitrary<PropValue>> = {
  "sys.f.type": fc.oneof(ref(TAGS), ref(["gone"])),
  st: fc.oneof(ref(OPTIONS), ref(CONTENT), ref(["gone"])),
  tx: fc.oneof(
    str(TEXTS),
    str(DATES),
    pick(DATES).map((v): PropValue => ({ t: "date", v })),
  ),
  nm: pick(NUMBERS).map((v): PropValue => ({ t: "num", v })),
  fl: fc.boolean().map((v): PropValue => ({ t: "bool", v })),
  mx: fc.oneof(
    str(TEXTS),
    ref(IDS),
    fc.boolean().map((v): PropValue => ({ t: "bool", v })),
  ),
};
const FIELDS = Object.keys(FIELD_VALUES);

const nodeArb = (id: string): fc.Arbitrary<KbNode> =>
  fc
    .record({
      text: pick(TEXTS),
      children: fc.uniqueArray(pick([...CONTENT, "gone"]), { maxLength: 3 }),
      createdAt: pick(INSTANTS),
      updatedAt: pick(INSTANTS),
      props: fc.record(
        Object.fromEntries(
          FIELDS.map((f) => [f, fc.array(FIELD_VALUES[f] ?? fc.constant(null), { maxLength: 2 })]),
        ),
        { requiredKeys: [] },
      ),
    })
    .map(({ props, ...n }) => ({
      id,
      ...n,
      props: Object.fromEntries(
        Object.entries(props).filter(
          (e): e is [string, PropValue[]] => Array.isArray(e[1]) && e[1].length > 0,
        ),
      ),
    }));

const graphArb: fc.Arbitrary<KbNode[]> = fc.tuple(...IDS.map(nodeArb));

const valueArb: fc.Arbitrary<ConditionValue> = fc.oneof(
  pick([...IDS, "gone"]).map((v) => ({ t: "ref" as const, v })),
  pick([...TEXTS, ...DATES]).map((v) => ({ t: "str" as const, v })),
  pick(NUMBERS).map((v) => ({ t: "num" as const, v })),
  fc.boolean().map((v) => ({ t: "bool" as const, v })),
  pick([...TEXTS, ...IDS, "gone", "true", "1000.5"]).map((v) => ({ t: "label" as const, v })),
);

const field = pick(FIELDS);
const days = fc.integer({ min: -20, max: 20 });
const needle = pick(["a", "A", "step", "Do", "", "[[", "0", "true"]);

/** Rows over the generated graphs' fields and nodes; comparisons only over fields of one kind. */
const rowArb: fc.Arbitrary<Condition> = fc.oneof(
  pick([...TAGS, "gone"]).map((tag) => ({ kind: "has-tag" as const, tag })),
  pick(TAGS).map((tag) => ({ kind: "lacks-tag" as const, tag })),
  field.map((f) => ({ kind: "field-set" as const, field: f })),
  field.map((f) => ({ kind: "field-unset" as const, field: f })),
  fc
    .record({ field, values: fc.array(valueArb, { minLength: 1, maxLength: 3 }) })
    .map((r) => ({ kind: "field-is" as const, ...r })),
  fc
    .record({ field, values: fc.array(valueArb, { minLength: 1, maxLength: 2 }) })
    .map((r) => ({ kind: "field-is-not" as const, ...r })),
  fc
    .record({ field, text: needle, exactCase: fc.boolean() })
    .map((r) => ({ kind: "field-contains" as const, ...r })),
  fc
    .record({
      op: pick(["<", "<=", ">", ">="] as const),
      on: fc.oneof(
        pick(NUMBERS).map((v) => ({ field: "nm", value: { t: "num" as const, v } })),
        pick(DATES).map((v) => ({ field: "tx", value: { t: "str" as const, v } })),
      ),
    })
    .map(({ op, on }) => ({ kind: "field-compares" as const, op, ...on })),
  fc
    .record({ text: needle, exactCase: fc.boolean() })
    .map((r) => ({ kind: "text-contains" as const, ...r })),
  fc
    .record({ attr: pick(["created", "edited"] as const), days })
    .map((r) => ({ kind: "instant-within" as const, ...r })),
  fc
    .record({ direction: pick(["next", "last"] as const), days })
    .map((r) => ({ kind: "date-within" as const, field: "tx", ...r })),
  fc
    .record({
      kind: pick(["under", "above"] as const),
      node: pick([...IDS, "gone"]),
      via: fc.oneof(
        fc.constant({ t: "child" as const }),
        fc.constant({ t: "mentions" as const }),
        fc.constant({ t: "field" as const, field: "st" }),
      ),
      maxHops: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
    })
    .map(({ maxHops, ...r }) => ({ ...r, ...(maxHops === undefined ? {} : { maxHops }) })),
  pick([...IDS, "gone"]).map((node) => ({ kind: "child-of" as const, node })),
  fc.constant({ kind: "has-children" as const }),
  pick([...IDS, "gone"]).map((node) => ({ kind: "links-to" as const, node })),
  pick([...IDS, "gone"]).map((node) => ({ kind: "linked-from" as const, node })),
);

function both(nodes: KbNode[], conditions: readonly Condition[]): [string[], string[]] {
  const derived = derivedWith({});
  const index = new DatascriptIndex(nodes, { derived, clock: () => CLOCK });
  const datalog = index
    .run(lowerIr(conditions))
    .map((row) => String(row[0]))
    .toSorted();
  const matches = conditionsMatcher(
    conditions,
    conditionGraph(new Map(nodes.map((n) => [n.id, n])), derived, CLOCK),
  );
  return [
    datalog,
    nodes
      .filter(matches)
      .map((n) => n.id)
      .toSorted(),
  ];
}

describe("the narrowing's evaluator answers what the query placement answers", () => {
  test("every node, over generated graphs and condition trees", () => {
    fc.assert(
      fc.property(graphArb, treeArb(2, rowArb), (nodes, tree) => {
        const [datalog, evaluated] = both(nodes, tree);
        expect(evaluated).toEqual(datalog);
      }),
      { numRuns: 300 },
    );
  });

  test("every node, row by row", () => {
    fc.assert(
      fc.property(graphArb, rowArb, (nodes, row) => {
        const [datalog, evaluated] = both(nodes, [row]);
        expect(evaluated).toEqual(datalog);
      }),
      { numRuns: 2000 },
    );
  });

  test("a date row without a clock fails, as a query does", () => {
    const matches = conditionsMatcher(
      [{ kind: "date-within", field: "tx", direction: "next", days: 1 }],
      conditionGraph(new Map(), derivedWith({})),
    );
    expect(() =>
      matches({
        id: "n",
        text: "",
        props: { tx: [{ t: "str", v: "2026-10-20" }] },
        children: [],
        createdAt: "",
        updatedAt: "",
      }),
    ).toThrow("kb/today reads the clock");
  });
});

describe("anywhere-contains: the narrowing's own row", () => {
  const nodes = new Map<string, KbNode>(
    [
      { id: "o", text: "Doing", props: {} },
      { id: "blank", text: "", props: {} },
      { id: "a", text: "Ship kb", props: {} },
      { id: "b", text: "Other", props: { status: [{ t: "ref", v: "o" }] } },
      {
        id: "c",
        text: "Other",
        props: { est: [{ t: "num", v: 42 }], due: [{ t: "date", v: "2026-11-01" }] },
      },
      {
        id: "d",
        text: "Other",
        props: { owner: [{ t: "ref", v: "blank" }], gone: [{ t: "ref", v: "zz-gone" }] },
      },
    ].map((n): [string, KbNode] => [
      n.id,
      { ...n, props: n.props as KbNode["props"], children: [], createdAt: "", updatedAt: "" },
    ]),
  );
  const graph = conditionGraph(nodes, derivedWith({}));
  const answer = (c: NarrowingCondition) =>
    [...nodes.values()].filter(conditionsMatcher([c], graph)).map((n) => n.id);

  test.each([
    ["node text, ignoring case", "SHIP", false, ["a"]],
    ["a ref by its node's text", "doing", false, ["o", "b"]],
    ["a number and a date by their text", "42", false, ["c"]],
    ["a date", "2026-11", false, ["c"]],
    ["a ref to a node with no text by its id", "blank", false, ["d"]],
    ["a dangling ref by its id", "zz-g", false, ["d"]],
    ["exact case", "doing", true, []],
    ["empty text: every node", "", false, ["o", "blank", "a", "b", "c", "d"]],
  ])("%s", (_label, text, exactCase, ids) => {
    expect(answer({ kind: "anywhere-contains", text, exactCase })).toEqual(ids);
  });
});
