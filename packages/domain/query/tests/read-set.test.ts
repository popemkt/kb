/**
 * An index runs a query again only when a transaction touched what its last
 * run read (DESIGN.md → Query layer → A run's read set). The law: after any
 * sequence of transactions, the answer the index gives is the answer a run
 * over the same db gives. The examples pin which edits a read set lets
 * through and which it does not, negative reads and clocked answers
 * included.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { bundledDerived } from "@kb/bundled";
import type { ClockSample, KbNode, PropValue, StoreTx } from "@kb/model";
import { DatascriptIndex, lowerIr, parseEdn, printEdn } from "@kb/query";
import { treeArb } from "./condition-arb.ts";
import { ednCorpus } from "./edn-corpus.ts";

const AT = "2026-10-20T10:00:00.000Z";
const CLOCK: ClockSample = { nowMs: Date.UTC(2026, 9, 20, 12), timeZone: "UTC" };

/** The ids and fields `treeArb`'s conditions name, so its rows meet the graph. */
const IDS = ["a", "b", "c", "d", "tag.todo", "s.doing"];
const TEXTS = ["draft", "Doing", "kb notes", "", "see [[a]]", "2026-10-21"];
const DATES = ["2026-10-14", "2026-10-20", "2026-10-21", "2026-11-03"];

const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);
const ref = pick([...IDS, "gone"]).map((v): PropValue => ({ t: "ref", v }));
const str = pick([...TEXTS, ...DATES]).map((v): PropValue => ({ t: "str", v }));
// Small integers are eids too: a run revives one as a node once its attribute holds a ref.
const num = pick([1000.5, 3.25, -7.5, 0.5, 1, 2, 3]).map((v): PropValue => ({ t: "num", v }));
const bool = fc.boolean().map((v): PropValue => ({ t: "bool", v }));
const FIELD_VALUES: Record<string, fc.Arbitrary<PropValue>> = {
  "sys.f.type": ref,
  status: fc.oneof(ref, str),
  due: str,
  est: fc.oneof({ weight: 4, arbitrary: num }, { weight: 1, arbitrary: ref }),
  note: fc.oneof(str, bool),
  owner: ref,
};

const nodeArb = (id: string): fc.Arbitrary<KbNode> =>
  fc
    .record({
      text: pick(TEXTS),
      children: fc.uniqueArray(pick([...IDS, "gone"]), { maxLength: 3 }),
      props: fc.record(
        Object.fromEntries(
          Object.entries(FIELD_VALUES).map(([f, v]) => [f, fc.array(v, { maxLength: 2 })]),
        ),
      ),
      updatedAt: pick(["2026-10-01T00:00:00.000Z", "2026-10-19T00:00:00.000Z", AT]),
    })
    .map(({ text, children, props, updatedAt }) => ({
      id,
      text,
      children: children.filter((c) => c !== id),
      props: Object.fromEntries(Object.entries(props).filter(([, vs]) => vs.length > 0)),
      createdAt: AT,
      updatedAt,
    }));

const graphArb: fc.Arbitrary<KbNode[]> = fc
  .subarray(IDS, { minLength: 2 })
  .chain((ids) => fc.tuple(...ids.map(nodeArb)));

/** One edit: a node written whole (made, if it was not there), or one deleted. */
const txArb: fc.Arbitrary<StoreTx> = fc.oneof(
  {
    weight: 4,
    arbitrary: pick(IDS)
      .chain(nodeArb)
      .map((n) => ({ upserts: [n], deletes: [] })),
  },
  { weight: 1, arbitrary: pick(IDS).map((id) => ({ upserts: [], deletes: [id] })) },
);

/** Queries over value tests, negations, `missing?`, a pull, a count and raw datalog, beside the builder's. */
const HAND: readonly string[] = [
  `[:find ?id :where [?n :node/id ?id] (not [?n :f/status _])]`,
  `[:find ?id :where [?n :node/id ?id] [(missing? $ ?n :f/due)]]`,
  `[:find ?id :where [?n :f/due ?d] [(< ?d "2026-10-21")] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :f/due ?d] [(>= "2026-10-20" ?d)] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :node/text ?t] [(clojure.string/starts-with? ?t "Do")] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :node/text ?t] [(kb/includes-ci? ?t "KB")] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :f/est ?e] [(> ?e 1)] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :f/note ?v] [(= ?v true)] [?n :node/id ?id]]`,
  `[:find ?id :where [?n :f/status ?s] [(not= ?s "draft")] [?n :node/id ?id]]`,
  `[:find (count ?n) :where [?n :node/id _]]`,
  `[:find (pull ?n [:node/id :node/text]) :where [?n :f/sys.f.type ?t] [?t :node/id "tag.todo"]]`,
  `[:find ?id :where [?p :node/id "a"] [?p :node/child ?c] [?c :node/id ?id]]`,
  `[:find ?id :where [?p :node/id "b"] [?p :node/child ?c] [?p :node/child-order ?o] [?c :node/id ?id]]`,
  `[:find ?id :where [?n :node/id ?id] (or-join [?n] [?n :f/owner ?o] (and [?n :node/text ?t] [(= ?t "draft")]))]`,
  `[:find ?id :where [?n :node/id ?id] (not-join [?n] [?n :node/mentions ?m] [?m :node/id "a"])]`,
  `[:find ?id :where [?r :node/id "c"] (reach ?r :node/child ?n) [?n :node/id ?id]]`,
  `[:find ?id ?u :where [?n :node/id ?id] [?n :node/updated-at ?u] [(> ?u "2026-10-10")]]`,
  `[:find ?id :where [?n :node/id ?id] [?n :f/due ?d] [(kb/today) ?today] [(<= ?d ?today)]]`,
  `[:find ?x :where [?n :node/id ?x] [(get-else $ ?n :node/text "") ?t]]`,
  `[:find ?v :where [?n :node/id "a"] [?n :f/est ?v]]`,
  `[:find (pull ?n [:node/id :node/_child]) :where [?n :node/id "a"]]`,
  `[:find ?id :where [?n :f/est ?v] [(clojure.string/includes? ?n "x")] [(> ?v 1)] [?n :node/id ?id]]`,
];

const corpus = ednCorpus()
  .filter((entry) => entry.ir.in === undefined)
  .map((entry) => entry.edn);

const queryArb: fc.Arbitrary<string> = fc.oneof(
  treeArb(2).map((tree) => printEdn(lowerIr(tree))),
  pick(HAND),
  pick(corpus),
);

const options = { derived: bundledDerived(), clock: () => CLOCK };

/** What a query answers, order aside, or that it threw. */
function outcome(index: DatascriptIndex, edn: string): string {
  try {
    const { rows, holdsUntilMs } = index.answerDatalog(edn);
    return JSON.stringify([rows.map((r) => JSON.stringify(r)).toSorted(), holdsUntilMs]);
  } catch (error) {
    return `threw ${error instanceof Error ? error.name : "?"}`;
  }
}

describe("an answer the index remembers", () => {
  test("is the answer a run over the same db gives, after any edits", () => {
    fc.assert(
      fc.property(
        graphArb,
        fc.array(queryArb, { minLength: 1, maxLength: 6 }),
        fc.array(txArb, { minLength: 1, maxLength: 8 }),
        (nodes, queries, txs) => {
          const index = new DatascriptIndex(nodes, options);
          for (const edn of queries) outcome(index, edn);
          for (const [step, tx] of txs.entries()) {
            index.applyTx(tx);
            for (const edn of queries) {
              // The same query under a text the index has never seen: a run, now.
              const fresh = `${edn}${" ".repeat(step + 1)}`;
              expect(outcome(index, edn)).toBe(outcome(index, fresh));
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);
});

function node(id: string, extra: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props: {}, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const tagged = (tag: string): KbNode["props"] => ({ "sys.f.type": [{ t: "ref", v: tag }] });

/** How many runs answering `edn` once more costs after `tx`. */
function rerunsAfter(index: DatascriptIndex, edn: string, tx: StoreTx): number {
  index.answerDatalog(edn);
  const before = index.runs;
  index.applyTx(tx);
  index.answerDatalog(edn);
  return index.runs - before;
}

describe("a read set", () => {
  const todos = printEdn(lowerIr([{ kind: "has-tag", tag: "tag.todo" }]));
  const graph = () => [
    node("tag.todo"),
    node("tag.other"),
    node("x", { props: tagged("tag.todo") }),
    node("y"),
  ];

  test("an edit to what a query did not read runs nothing", () => {
    const index = new DatascriptIndex(graph(), options);
    expect(
      rerunsAfter(index, todos, { upserts: [node("y", { text: "typed" })], deletes: [] }),
    ).toBe(0);
    expect(
      rerunsAfter(index, todos, {
        upserts: [node("x", { text: "typed", props: tagged("tag.todo") })],
        deletes: [],
      }),
    ).toBe(0);
    expect(
      rerunsAfter(index, todos, {
        upserts: [node("y", { props: tagged("tag.other") })],
        deletes: [],
      }),
    ).toBe(0);
  });

  test("an edit to what it read runs it again", () => {
    const index = new DatascriptIndex(graph(), options);
    expect(
      rerunsAfter(index, todos, {
        upserts: [node("y", { props: tagged("tag.todo") })],
        deletes: [],
      }),
    ).toBe(1);
    expect(new Set(index.answerDatalog(todos).rows.map((r) => r[0]))).toEqual(new Set(["x", "y"]));
    expect(rerunsAfter(index, todos, { upserts: [], deletes: ["x"] })).toBe(1);
  });

  test("a node made that no clause matches runs nothing; one that matches runs it", () => {
    const index = new DatascriptIndex(graph(), options);
    expect(rerunsAfter(index, todos, { upserts: [node("z")], deletes: [] })).toBe(0);
    expect(
      rerunsAfter(index, todos, {
        upserts: [node("w", { props: tagged("tag.todo") })],
        deletes: [],
      }),
    ).toBe(1);
  });

  test("a read that found nothing is a read: the node it names, made, runs it", () => {
    const later = printEdn(lowerIr([{ kind: "has-tag", tag: "tag.later" }]));
    const index = new DatascriptIndex(
      [...graph(), node("v", { props: tagged("tag.later") })],
      options,
    );
    expect(index.answerDatalog(later).rows).toEqual([]);
    expect(rerunsAfter(index, later, { upserts: [node("tag.later")], deletes: [] })).toBe(1);
    expect(index.answerDatalog(later).rows).toEqual([["v"]]);
  });

  test("a negation reads what it rules out", () => {
    const untagged = `[:find ?id :where [?n :node/id ?id] (not [?n :f/sys.f.type _])]`;
    const index = new DatascriptIndex(graph(), options);
    expect(
      rerunsAfter(index, untagged, { upserts: [node("y", { text: "typed" })], deletes: [] }),
    ).toBe(0);
    expect(
      rerunsAfter(index, untagged, {
        upserts: [node("y", { props: tagged("tag.other") })],
        deletes: [],
      }),
    ).toBe(1);
  });

  test("a value test lets through only the values it could keep", () => {
    const kb = printEdn(lowerIr([{ kind: "text-contains", text: "kb", exactCase: false }]));
    const index = new DatascriptIndex(graph(), options);
    expect(rerunsAfter(index, kb, { upserts: [node("y", { text: "typed" })], deletes: [] })).toBe(
      0,
    );
    expect(
      rerunsAfter(index, kb, { upserts: [node("y", { text: "KB notes" })], deletes: [] }),
    ).toBe(1);
    expect(rerunsAfter(index, kb, { upserts: [node("y", { text: "gone" })], deletes: [] })).toBe(1);
  });

  test("raw datalog, a caller's rules, and an attribute pull read everything", () => {
    const index = new DatascriptIndex(graph(), options);
    const raw = `[:find ?x :where [?n :node/id ?x] [(get-else $ ?n :node/text "") ?t]]`;
    expect(parseEdn(raw).kind).toBe("raw");
    const pull = `[:find (pull ?n [*]) :where [?n :node/id "x"]]`;
    for (const [i, edn] of [raw, pull].entries()) {
      const typed = { upserts: [node("y", { text: `typed ${i}` })], deletes: [] };
      expect(rerunsAfter(index, edn, typed)).toBe(1);
    }
  });

  test("a rebuild forgets every answer", () => {
    const index = new DatascriptIndex(graph(), options);
    expect(
      rerunsAfter(index, todos, {
        upserts: [node("y", { props: { fresh: [{ t: "num", v: 1.5 }] } })],
        deletes: [],
      }),
    ).toBe(1);
  });

  test("a clocked answer is run again once its time is up, without an edit", () => {
    let now = CLOCK.nowMs;
    const index = new DatascriptIndex(graph(), {
      derived: bundledDerived(),
      clock: () => ({ ...CLOCK, nowMs: now }),
    });
    const today = `[:find ?d :where [(kb/today) ?d] [?n :node/id "x"]]`;
    const first = index.answerDatalog(today);
    index.answerDatalog(today);
    expect(index.runs).toBe(1);
    now = first.holdsUntilMs ?? 0;
    expect(index.answerDatalog(today).rows).toEqual([["2026-10-21"]]);
    expect(index.runs).toBe(2);
  });

  test("a query with inputs is run every time", () => {
    const index = new DatascriptIndex(graph(), options);
    const edn = `[:find ?id :in $ ?t :where [?n :node/text ?t] [?n :node/id ?id]]`;
    index.answerDatalog(edn, "x");
    index.answerDatalog(edn, "x");
    expect(index.runs).toBe(2);
  });
});
