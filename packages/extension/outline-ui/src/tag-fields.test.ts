/** A tag's fields as the tag-fields picker names them: by the words each reads as. */
import { describe, expect, it } from "vitest";
import { schemaOfGraph, wireToOutlineMap } from "@kb/ui-sdk";
import { SYSTEM_IDS } from "@kb/model";
import { resolveTagFields } from "./tag-fields";

const ref = (v: string) => [{ t: "ref" as const, v }];
const node = (id: string, text: string, props: Record<string, { t: "ref"; v: string }[]> = {}) => ({
  id,
  text,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

describe("resolveTagFields", () => {
  it("names each field as it reads, and sorts by that name", () => {
    const nodes = wireToOutlineMap([
      node("f.b", "**Budget**", { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.field) }),
      node("f.a", "_Area_", { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.field) }),
      node("t.x", "x", { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) }),
    ]);
    const { all } = resolveTagFields(schemaOfGraph(nodes), "t.x");
    expect(all).toEqual([
      { id: "f.a", name: "Area" },
      { id: "f.b", name: "Budget" },
    ]);
  });
});
