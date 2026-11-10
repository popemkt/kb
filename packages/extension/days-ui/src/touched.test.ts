import { describe, expect, test } from "vitest";
import { DAYS_IDS } from "@kb/days";
import { SYSTEM_IDS } from "@kb/model";
import { touchedOn, type Stamped } from "./touched";

function node(id: string, extra: Partial<Stamped> = {}): Stamped {
  return { id, text: id, props: {}, children: [], ...extra };
}
const ref = (v: string) => [{ t: "ref" as const, v }];

describe("touchedOn", () => {
  const nodes = new Map<string, Stamped>(
    [
      node("made", {
        createdAt: "2026-11-10T03:00:00.000Z",
        updatedAt: "2026-11-10T03:00:00.000Z",
      }),
      node("edited", {
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-11-10T09:00:00.000Z",
      }),
      node("yesterday", {
        createdAt: "2026-11-09T03:00:00.000Z",
        updatedAt: "2026-11-09T03:00:00.000Z",
      }),
      // 23:30 UTC on the 9th is the 10th in Ho Chi Minh City (UTC+7).
      node("late", {
        createdAt: "2026-11-09T23:30:00.000Z",
        updatedAt: "2026-11-09T23:30:00.000Z",
      }),
      node("day", {
        props: { [DAYS_IDS.keyField]: [{ t: "str", v: "2026-11-10" }] },
        createdAt: "2026-11-10T01:00:00.000Z",
      }),
      node("tag", {
        props: { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) },
        children: ["option"],
        createdAt: "2026-11-10T01:00:00.000Z",
      }),
      node("option", { createdAt: "2026-11-10T01:00:00.000Z" }),
      node("sys.thing", { createdAt: "2026-11-10T01:00:00.000Z" }),
    ].map((n) => [n.id, n]),
  );

  test("a node made or edited on the day counts, newest edit first", () => {
    expect(touchedOn(nodes, "2026-11-10", "UTC")).toEqual(["edited", "made"]);
  });

  test("the day is read in the page's zone", () => {
    expect(touchedOn(nodes, "2026-11-10", "Asia/Ho_Chi_Minh")).toEqual(["edited", "made", "late"]);
    expect(touchedOn(nodes, "2026-11-09", "UTC")).toEqual(["late", "yesterday"]);
  });

  test("period nodes, schema, options and sys nodes are never what a day made", () => {
    const listed = touchedOn(nodes, "2026-11-10", "UTC");
    for (const id of ["day", "tag", "option", "sys.thing"]) expect(listed).not.toContain(id);
  });
});
