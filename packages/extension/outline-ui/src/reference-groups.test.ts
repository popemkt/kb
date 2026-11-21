import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { schemaOf } from "@kb/ui-sdk";
import { groupByPlace } from "./reference-groups";

const node = (id: string, text: string, children: string[] = [], at = "2026-11-01"): WireNode => ({
  id,
  text,
  props: {},
  children,
  createdAt: `${at}T00:00:00.000Z`,
  updatedAt: `${at}T00:00:00.000Z`,
});

const schema = schemaOf({
  wireNodes: [
    node("n.journal", "Journal", ["n.monday", "n.tuesday"]),
    node("n.monday", "Monday", ["n.m1", "n.m2", "n.m3"]),
    node("n.m1", "first"),
    node("n.m2", "second", [], "2026-11-03"),
    node("n.m3", "third"),
    node("n.tuesday", "Tuesday", ["n.t1"]),
    node("n.t1", "only", [], "2026-11-05"),
    node("n.loose", "at the top"),
  ],
});

describe("groupByPlace", () => {
  it("groups by parent, the place written in last first, rows in the place's order", () => {
    const groups = groupByPlace(["n.m3", "n.loose", "n.t1", "n.m1", "n.m2"], (id) => id, schema);
    expect(groups.map(({ place, rows }) => [place, rows])).toEqual([
      ["n.tuesday", ["n.t1"]],
      ["n.monday", ["n.m1", "n.m2", "n.m3"]],
      [null, ["n.loose"]],
    ]);
  });

  it("names the path above each place, home left out", () => {
    const [tuesday, , top] = groupByPlace(["n.t1", "n.m1", "n.loose"], (id) => id, schema);
    expect(tuesday?.crumbs).toEqual([{ id: "n.journal", text: "Journal" }]);
    expect(top?.crumbs).toEqual([]);
  });
});
