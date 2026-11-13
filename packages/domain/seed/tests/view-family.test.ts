import { expect, test } from "bun:test";
import { SYSTEM_IDS, VIEW_FAMILY_OPTIONS, declaredOptionId, viewOptionId } from "@kb/model";
import { foldSeed } from "../src/seed-fold.ts";
import { systemSeedNodes } from "../src/seed.ts";

test("a declaration adds a view family without a core registry, and labels do not change identity", () => {
  const family = "example.visual";
  const id = declaredOptionId(VIEW_FAMILY_OPTIONS, family);
  const fold = (label: string) =>
    foldSeed(
      [
        { name: "core", label: "Core", seed: systemSeedNodes },
        {
          name: "example",
          label: "Example",
          declaredOptions: [{ kind: VIEW_FAMILY_OPTIONS, options: [{ id: family, label }] }],
          views: [{ key: { id: "example.main", label: "Example view", family } }],
        },
      ],
      "2026-11-13T00:00:00.000Z",
    );
  const original = fold("Visual view");
  const renamed = fold("Renamed label");
  const nodes = new Map(renamed.nodes.map((node) => [node.id, node]));
  expect(nodes.get(SYSTEM_IDS.viewFamilyField)?.children).toEqual([id]);
  expect(nodes.get(id)?.text).toBe("Renamed label");
  expect(nodes.get(viewOptionId("example.main"))?.props[SYSTEM_IDS.viewFamilyField]).toEqual([
    { t: "ref", v: id },
  ]);
  expect(original.owners.get(id)).toBe("example");
  expect(renamed.owners.get(id)).toBe("example");
});

const source = (name: string, ids: readonly string[], order?: number) => ({
  name,
  label: name,
  declaredOptions: [
    {
      kind: VIEW_FAMILY_OPTIONS,
      options: ids.map((id) => ({ id, label: id, ...(order === undefined ? {} : { order }) })),
    },
  ],
});

test("declared-option priorities cross contributor boundaries and ties retain declaration order", () => {
  const folded = foldSeed(
    [
      { name: "core", label: "Core", seed: systemSeedNodes },
      source("later", ["example.a", "example.c"], 2),
      source("earlier", ["example.b"], 1),
      source("default", ["example.default"]),
      source("tie", ["example.d"], 2),
    ],
    "2026-11-13T00:00:00.000Z",
  );
  expect(folded.nodes.find((node) => node.id === SYSTEM_IDS.viewFamilyField)?.children).toEqual(
    ["example.default", "example.b", "example.a", "example.c", "example.d"].map((id) =>
      declaredOptionId(VIEW_FAMILY_OPTIONS, id),
    ),
  );
  expect(folded.owners.get(declaredOptionId(VIEW_FAMILY_OPTIONS, "example.b"))).toBe("earlier");
});
