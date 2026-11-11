import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { DatascriptIndex, derivedWith } from "@kb/query";
import { DAYS_IDS, daysExtension, dateDayReferences } from "../src/index.ts";

const AT = "2026-11-11T00:00:00.000Z";
function node(id: string, props: KbNode["props"] = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT };
}
const str = (v: string) => [{ t: "str" as const, v }];

describe("dateDayReferences", () => {
  test("a date field's value names the day holding its date as key; any other value names nothing", () => {
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "date" })).toEqual([
      { field: "sys.f.days.key", value: "2026-11-12" },
    ]);
    expect(dateDayReferences({ t: "str", v: "" }, { type: "date" })).toEqual([]);
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "text" })).toEqual([]);
  });

  test("a day is referenced under whatever id it was made with", () => {
    const due = node("f.due", {
      [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftDate }],
    });
    const task = node("task", { "f.due": str("2026-11-12") });
    // days.2026-11-12 is taken by a node that is not that day, so the day has a fresh id.
    const taken = node("days.2026-11-12");
    const day = node("01FRESHDAY", { [DAYS_IDS.keyField]: str("2026-11-12") });
    const index = new DatascriptIndex([due, task, taken, day], {
      derived: derivedWith({ carriers: daysExtension.refCarriers }),
    });
    expect([...index.referencesOf(task)]).toContain("01FRESHDAY");
    expect([...index.referencesOf(task)]).not.toContain("days.2026-11-12");
    expect([...index.referenceFields(task, "01FRESHDAY")]).toEqual(["f.due"]);
  });
});
