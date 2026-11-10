import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type NodeLike } from "@kb/model";
import { dateDayReferences, datedOn, datesOf } from "../src/index.ts";

function node(id: string, props: NodeLike["props"] = {}): NodeLike {
  return { id, text: id, props, children: [] };
}
const ref = (v: string) => [{ t: "ref" as const, v }];
const str = (...vs: string[]) => vs.map((v) => ({ t: "str" as const, v }));

const due = node("due", { [SYSTEM_IDS.fieldTypeField]: ref(SYSTEM_IDS.ftDate) });
const starts = node("starts", { [SYSTEM_IDS.fieldTypeField]: ref(SYSTEM_IDS.ftDate) });
const note = node("note");

function graph(...nodes: NodeLike[]): Map<string, NodeLike> {
  return new Map([due, starts, note, ...nodes].map((n) => [n.id, n]));
}

describe("datesOf", () => {
  test("every value of every date-typed field, and nothing from other fields", () => {
    const g = graph();
    const task = node("task", {
      due: str("2026-11-12"),
      starts: str("2026-11-10", "2026-11-11"),
      note: str("2026-11-12"),
    });
    expect(datesOf(task, (id) => g.get(id))).toEqual([
      { field: "due", day: "2026-11-12" },
      { field: "starts", day: "2026-11-10" },
      { field: "starts", day: "2026-11-11" },
    ]);
  });

  test("a cleared date and a field that is gone date nothing", () => {
    const g = graph();
    expect(
      datesOf(node("x", { due: str(""), gone: str("2026-11-12") }), (id) => g.get(id)),
    ).toEqual([]);
  });
});

describe("datedOn", () => {
  test("the nodes holding the day in a date field, each with the field that dates it", () => {
    const g = graph(
      node("task", { due: str("2026-11-12") }),
      node("talk", { starts: str("2026-11-12") }),
      node("other", { due: str("2026-11-13") }),
      node("text", { note: str("2026-11-12") }),
    );
    expect(datedOn(g, "2026-11-12")).toEqual([
      { id: "task", field: "due" },
      { id: "talk", field: "starts" },
    ]);
  });
});

describe("dateDayReferences", () => {
  test("a date field's value names its day's node; any other value names nothing", () => {
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "date" })).toEqual([
      "days.2026-11-12",
    ]);
    expect(dateDayReferences({ t: "str", v: "" }, { type: "date" })).toEqual([]);
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "text" })).toEqual([]);
  });
});
