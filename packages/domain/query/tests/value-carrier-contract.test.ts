/**
 * One contract, every index: a carrier a family declares reads each value
 * with its field's declared type, across every field, and the reference
 * relation follows the graph as it moves. A value whose field becomes a
 * date starts to mention its target, and one whose field stops being a date
 * stops, on the incremental path as on a fresh build. Run over the
 * in-process DataScript index and the remote index whose engine runs
 * behind a port (in thread here; `remote.test.ts` proves a worker answers
 * as the thread does).
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type StoreTx } from "@kb/model";
import {
  DatascriptIndex,
  derivedWith,
  inThreadPort,
  RemoteIndex,
  type DerivedRef,
  type ValueRefCarrier,
} from "@kb/query";

const AT = "2026-01-01T00:00:00.000Z";
function node(id: string, props: KbNode["props"] = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT };
}
const str = (v: string) => [{ t: "str" as const, v }];
const typed = (type: string) => ({ [SYSTEM_IDS.fieldTypeField]: [{ t: "ref" as const, v: type }] });

/** A date value names the node `day.<date>`, in whichever field holds it, while that field is a date. */
const DATES: ValueRefCarrier = {
  refsOf: (value, field) => (field.type === "date" && value.t === "str" ? [`day.${value.v}`] : []),
};
const DERIVED = derivedWith({ carriers: [DATES] });

const MENTIONS =
  "[:find ?id ?target :where [?n :node/id ?id] [?n :node/mentions ?t] [?t :node/id ?target]]";

/** What every index answers here: the mention rows, the references of one node, and its moves. */
interface Subject {
  readonly mentions: () => Promise<string[]>;
  readonly referencesOf: (node: KbNode) => ReadonlySet<string>;
  readonly referenceFields: (node: KbNode, target: string) => ReadonlySet<string>;
  readonly applyTx: (tx: StoreTx) => void;
}

const sortedRows = (rows: unknown[][]) => rows.map((row) => row.join(" ")).toSorted();

const INDEXES: Record<string, (nodes: KbNode[], derived: readonly DerivedRef[]) => Subject> = {
  DataScript: (nodes, derived) => {
    const index = new DatascriptIndex(nodes, { derived });
    return {
      mentions: () => Promise.resolve(sortedRows(index.runDatalog(MENTIONS))),
      referencesOf: (n) => index.referencesOf(n),
      referenceFields: (n, target) => index.referenceFields(n, target),
      applyTx: (tx) => index.applyTx(tx),
    };
  },
  remote: (nodes, derived) => {
    const index = new RemoteIndex(
      nodes,
      derived,
      () => inThreadPort({ derived }, () => performance.now(), queueMicrotask),
      {
        set: (run, ms) => {
          const handle = setTimeout(run, ms);
          return () => clearTimeout(handle);
        },
      },
    );
    return {
      mentions: async () => {
        const answer = await index.transport.run({ edn: MENTIONS, budgetMs: 10_000 });
        return answer.kind === "rows" ? sortedRows(answer.rows) : [answer.kind];
      },
      referencesOf: (n) => index.referencesOf(n),
      referenceFields: (n, target) => index.referenceFields(n, target),
      applyTx: (tx) => index.applyTx(tx),
    };
  },
};

/** The mentions `held` makes (a field's own ref to its type option is a mention too). */
async function heldBy(subject: Subject): Promise<string[]> {
  return (await subject.mentions()).filter((row) => row.startsWith("held "));
}

const due = node("f.due", typed(SYSTEM_IDS.ftDate));
const note = node("f.note");
const task = node("task", { "f.due": str("2026-11-12"), "f.note": str("2026-11-13") });
const dayOne = node("day.2026-11-12");
const days = [dayOne, node("day.2026-11-13")];

for (const [name, make] of Object.entries(INDEXES))
  describe(`${name}: a value carrier reads each value with its field's type`, () => {
    test("a value in a date field mentions its target, in any field; one in a text field does not", async () => {
      const index = make([due, note, task, ...days], DERIVED);
      expect(await index.mentions()).toEqual(["task day.2026-11-12"]);
      expect(index.referencesOf(task)).toContain("day.2026-11-12");
      expect(index.referencesOf(task)).not.toContain("day.2026-11-13");
    });

    test("a field that becomes a date, or stops being one, moves its holders' mentions", async () => {
      const index = make([due, note, task, ...days], DERIVED);
      index.applyTx({ upserts: [node("f.note", typed(SYSTEM_IDS.ftDate))], deletes: [] });
      expect(await index.mentions()).toEqual(["task day.2026-11-12", "task day.2026-11-13"]);
      index.applyTx({ upserts: [node("f.due", typed(SYSTEM_IDS.ftText))], deletes: [] });
      expect(await index.mentions()).toEqual(["task day.2026-11-13"]);
      // The incremental path answers what a fresh build over the same graph answers.
      const fresh = make(
        [
          node("f.due", typed(SYSTEM_IDS.ftText)),
          node("f.note", typed(SYSTEM_IDS.ftDate)),
          task,
          ...days,
        ],
        DERIVED,
      );
      expect(await fresh.mentions()).toEqual(await index.mentions());
    });

    test("a field typed through a person's option follows that option's type, however it moves", async () => {
      // f.when chooses my.date, a person's option naming the built-in date type.
      const when = node("f.when", typed("my.date"));
      const held = node("held", { "f.when": str("2026-11-12") });
      const index = make([when, node("my.date", typed(SYSTEM_IDS.ftDate)), held, ...days], DERIVED);
      expect(await heldBy(index)).toEqual(["held day.2026-11-12"]);
      // The option is retyped, two hops from the holder: the mention goes.
      index.applyTx({ upserts: [node("my.date", typed(SYSTEM_IDS.ftText))], deletes: [] });
      expect(await heldBy(index)).toEqual([]);
      // Back to a date: it returns.
      index.applyTx({ upserts: [node("my.date", typed(SYSTEM_IDS.ftDate))], deletes: [] });
      expect(await heldBy(index)).toEqual(["held day.2026-11-12"]);
      // The option is deleted: the field reads as text, and the mention goes.
      index.applyTx({ upserts: [], deletes: ["my.date"] });
      expect(await heldBy(index)).toEqual([]);
      // The option arrives again, naming a date: the mention returns.
      index.applyTx({ upserts: [node("my.date", typed(SYSTEM_IDS.ftDate))], deletes: [] });
      expect(await heldBy(index)).toEqual(["held day.2026-11-12"]);
      const fresh = make([when, node("my.date", typed(SYSTEM_IDS.ftDate)), held, ...days], DERIVED);
      expect(await heldBy(fresh)).toEqual(await heldBy(index));
    });

    test("a field's other edits leave its holders' mentions as they were", async () => {
      const index = make([due, note, task, ...days], DERIVED);
      index.applyTx({ upserts: [{ ...due, text: "due by" }], deletes: [] });
      expect(await index.mentions()).toEqual(["task day.2026-11-12"]);
    });

    test("a target that arrives later is mentioned then", async () => {
      const index = make([due, note, task], DERIVED);
      expect(await index.mentions()).toEqual([]);
      index.applyTx({ upserts: [dayOne], deletes: [] });
      expect(await index.mentions()).toEqual(["task day.2026-11-12"]);
    });

    test("a reference says the fields it comes through, whichever carrier reads it", () => {
      const link = node("f.link");
      const through = {
        ...node("through", {
          "f.due": str("2026-11-12"),
          "f.link": [{ t: "ref" as const, v: "day.2026-11-12" }],
          "f.note": str("about [[day.2026-11-12]]"),
        }),
        text: "see [[day.2026-11-12]] and [[day.2026-11-13]]",
      };
      const index = make([due, note, link, through, ...days], DERIVED);
      // A date, a ref value and a token in a text value each name their field.
      expect([...index.referenceFields(through, "day.2026-11-12")].toSorted()).toEqual([
        "f.due",
        "f.link",
        "f.note",
      ]);
      // A token in the node's own text is in no field.
      expect([...index.referenceFields(through, "day.2026-11-13")]).toEqual([]);
      // The date is read with its field's type as it stands.
      index.applyTx({ upserts: [node("f.due", typed(SYSTEM_IDS.ftText))], deletes: [] });
      expect([...index.referenceFields(through, "day.2026-11-12")].toSorted()).toEqual([
        "f.link",
        "f.note",
      ]);
    });

    test("a carrier that names one field reads that field only", async () => {
      const only = derivedWith({ carriers: [{ ...DATES, field: "f.note" }] });
      const index = make(
        [
          node("f.due", typed(SYSTEM_IDS.ftDate)),
          node("f.note", typed(SYSTEM_IDS.ftDate)),
          task,
          ...days,
        ],
        only,
      );
      expect(await index.mentions()).toEqual(["task day.2026-11-13"]);
    });
  });

/** A date value names the nodes whose `f.key` is that date, whatever their ids. */
const KEYED = derivedWith({
  carriers: [
    {
      refsOf: (value, field) =>
        field.type === "date" && value.t === "str" ? [{ field: "f.key", value: value.v }] : [],
    },
  ],
});
const keyed = (id: string, key?: string) =>
  node(id, key === undefined ? {} : { "f.key": str(key) });

for (const [name, make] of Object.entries(INDEXES))
  describe(`${name}: a value carrier may name its target by key`, () => {
    test("a value names whichever node holds the key, under any id", async () => {
      const index = make([due, note, task, keyed("any-id", "2026-11-12")], KEYED);
      expect(await index.mentions()).toEqual(["task any-id"]);
      expect([...index.referenceFields(task, "any-id")]).toEqual(["f.due"]);
    });

    test("the mention follows the key as it arrives, moves and goes", async () => {
      const index = make([due, note, task], KEYED);
      expect(await index.mentions()).toEqual([]);
      // A node takes the key: it is mentioned.
      index.applyTx({ upserts: [keyed("first", "2026-11-12")], deletes: [] });
      expect(await index.mentions()).toEqual(["task first"]);
      // The key moves to another node in one transaction.
      index.applyTx({ upserts: [keyed("first"), keyed("second", "2026-11-12")], deletes: [] });
      expect(await index.mentions()).toEqual(["task second"]);
      // Its holder is deleted: nothing is mentioned.
      index.applyTx({ upserts: [], deletes: ["second"] });
      expect(await index.mentions()).toEqual([]);
      // It comes back under a third id, and the holder's own value changes.
      index.applyTx({ upserts: [keyed("third", "2026-11-12")], deletes: [] });
      index.applyTx({ upserts: [{ ...task, props: { "f.due": str("2026-11-13") } }], deletes: [] });
      expect(await index.mentions()).toEqual([]);
      index.applyTx({ upserts: [keyed("third", "2026-11-13")], deletes: [] });
      expect(await index.mentions()).toEqual(["task third"]);
      const fresh = make(
        [
          due,
          note,
          { ...task, props: { "f.due": str("2026-11-13") } },
          keyed("third", "2026-11-13"),
        ],
        KEYED,
      );
      expect(await fresh.mentions()).toEqual(await index.mentions());
    });

    test("a node only planned is read by key too, and a planned key holder is not yet held", () => {
      const index = make([due, note, keyed("held", "2026-11-12")], KEYED);
      expect(index.referencesOf(task)).toContain("held");
      expect(index.referencesOf(node("x", { "f.due": str("2026-11-14") }))).not.toContain("held");
    });
  });
