/**
 * What the view settings popover offers, over a graph: the rows' fields in
 * the order a person reaches for them, the columns shown now, and the page
 * sizes.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { schemaOfGraph, wireToOutlineMap } from "@kb/ui-sdk";
import { SYSTEM_IDS } from "@kb/model";
import { frameColumns, frameFieldCandidates, pageSizeOptions } from "./view-settings-fields";

const ref = (v: string) => [{ t: "ref" as const, v }];
const hidden = [{ t: "ref" as const, v: SYSTEM_IDS.showNever }];

function node(id: string, text: string, props: WireNode["props"] = {}, children: string[] = []) {
  return { id, text, props, children, createdAt: "", updatedAt: "" };
}

const field = (id: string, text: string, props: WireNode["props"] = {}) =>
  node(id, text, { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.field), ...props });

const wires: WireNode[] = [
  field("f.status", "status"),
  field("f.zeta", "zeta"),
  field("f.alpha", "alpha"),
  field("f.secret", "secret", { [SYSTEM_IDS.showField]: hidden }),
  field("sys.f.untemplated", "untemplated"),
  node("t.task", "task", {
    [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag),
    [SYSTEM_IDS.fieldsField]: [...ref("f.status"), ...ref("f.secret")],
  }),
  node("frame", "Sprint", {}, ["r1"]),
  node("r1", "row", { [SYSTEM_IDS.typeField]: ref("t.task") }),
];
const nodes = wireToOutlineMap(wires, new Set());
const schema = schemaOfGraph(nodes);

describe("the view settings' fields", () => {
  it("offers the rows' templated fields first, then every other field a person made, by name", () => {
    expect(frameFieldCandidates("frame", nodes, schema).map((c) => c.id)).toEqual([
      "f.status",
      "f.alpha",
      "f.zeta",
    ]);
  });

  it("offers a pinned field first, before the rows' templated ones", () => {
    const pinned = wireToOutlineMap(
      [
        ...wires.filter((n) => n.id !== "f.zeta"),
        field("f.zeta", "zeta", { [SYSTEM_IDS.pinnedField]: [{ t: "bool", v: true }] }),
      ],
      new Set(),
    );
    expect(frameFieldCandidates("frame", pinned, schemaOfGraph(pinned)).map((c) => c.id)).toEqual([
      "f.zeta",
      "f.status",
      "f.alpha",
    ]);
  });

  it("shows the templated fields while the view names none, and the named ones after", () => {
    expect(frameColumns("frame", nodes, schema, { display: [] }).map((c) => c.fieldId)).toEqual([
      "f.status",
    ]);
    expect(
      frameColumns("frame", nodes, schema, { display: ["f.zeta", "f.alpha"] }).map(
        (c) => c.fieldId,
      ),
    ).toEqual(["f.zeta", "f.alpha"]);
  });

  it("offers the page sizes, with one a view node holds that is none of them", () => {
    expect(pageSizeOptions(100)).toEqual([10, 25, 50, 100, 250, 500]);
    expect(pageSizeOptions(37)).toEqual([10, 25, 37, 50, 100, 250, 500]);
  });
});
