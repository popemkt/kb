import { describe, expect, test } from "bun:test";
import type { NodeLike } from "@kb/model";
import { DAYS_IDS } from "../src/ids";
import { JOURNAL_TEXT, planDay, type NewPeriodNode } from "../src/plan";

function minter() {
  let n = 0;
  return () => `n${++n}`;
}

function node(id: string, props: NodeLike["props"] = {}, text = id): NodeLike {
  return { id, text, props, children: [] };
}

const keyed = (id: string, key: string, text = id) =>
  node(id, { [DAYS_IDS.keyField]: [{ t: "str", v: key }] }, text);

/** Apply a plan's nodes to the graph, as committing it would. */
function apply(nodes: Map<string, NodeLike>, make: readonly NewPeriodNode[]) {
  for (const made of make) nodes.set(made.id, keyed(made.id, made.key ?? "", made.text));
  return nodes;
}

describe("planDay", () => {
  test("an empty graph gets journal, year, week and day, parent first", () => {
    const plan = planDay(new Map(), "2026-11-10", minter());
    expect(plan.make.map((m) => [m.text, m.parent, m.tag, m.key])).toEqual([
      [JOURNAL_TEXT, null, null, null],
      ["2026", "n1", DAYS_IDS.yearTag, "2026"],
      ["Week 46", "n2", DAYS_IDS.weekTag, "2026-W46"],
      ["Tue, Nov 10", "n3", DAYS_IDS.dayTag, "2026-11-10"],
    ]);
    expect(plan.day).toBe("n4");
    expect(plan.journal).toBe("n1");
  });

  test("asking twice makes nothing the second time", () => {
    const nodes = new Map<string, NodeLike>();
    const mint = minter();
    apply(nodes, planDay(nodes, "2026-11-10", mint).make);
    const again = planDay(nodes, "2026-11-10", mint);
    expect(again.make).toEqual([]);
    expect(again.day).toBe("n4");
  });

  test("a day is found by its key, whatever its text or place", () => {
    const nodes = new Map([["d", keyed("d", "2026-11-10", "my birthday")]]);
    expect(planDay(nodes, "2026-11-10", minter())).toEqual({ day: "d", make: [], journal: null });
  });

  test("a new day reuses its week and year where they are", () => {
    const nodes = new Map([
      ["y", keyed("y", "2026")],
      ["w", keyed("w", "2026-W46")],
    ]);
    const plan = planDay(nodes, "2026-11-12", minter());
    expect(plan.make.map((m) => [m.parent, m.key])).toEqual([["w", "2026-11-12"]]);
    expect(plan.journal).toBeNull();
  });

  test("a new week goes under the existing year, and the journal setting is the root", () => {
    const nodes = new Map<string, NodeLike>([
      ["j", node("j")],
      [DAYS_IDS.family, node(DAYS_IDS.family, { [DAYS_IDS.journalField]: [{ t: "ref", v: "j" }] })],
    ]);
    const plan = planDay(nodes, "2026-01-05", minter());
    expect(plan.make.map((m) => [m.parent, m.key])).toEqual([
      ["j", "2026"],
      ["n1", "2026-W02"],
      ["n2", "2026-01-05"],
    ]);
    expect(plan.journal).toBeNull();
  });

  test("a journal setting naming a deleted node makes a fresh root", () => {
    const nodes = new Map([
      [
        DAYS_IDS.family,
        node(DAYS_IDS.family, { [DAYS_IDS.journalField]: [{ t: "ref", v: "gone" }] }),
      ],
    ]);
    expect(planDay(nodes, "2026-11-10", minter()).journal).toBe("n1");
  });

  test("a day of a week that straddles New Year goes under the week's year", () => {
    const plan = planDay(new Map(), "2027-01-01", minter());
    expect(plan.make.map((m) => m.key)).toEqual([null, "2026", "2026-W53", "2027-01-01"]);
  });

  test("a value that is not a calendar date is refused", () => {
    expect(() => planDay(new Map(), "tomorrow", minter())).toThrow(RangeError);
  });
});
