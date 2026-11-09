/**
 * A family's field type's value kind (DESIGN-UI.md → Field values): its page
 * half contributes it for the type's option node, under the type's declared
 * id, with its glyph named as a form names one. The point holds every
 * contribution to its contract, so a malformed one is refused where it is
 * contributed, and a field of its type draws as the type it stores as.
 */
import { afterAll, describe, expect, it } from "vitest";
import { StarIcon } from "@phosphor-icons/react";
import { FIELD_TYPE_OPTIONS, declaredOptionId, SYSTEM_IDS } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  currentContributions,
  provideValueKind,
  schemaOfGraph,
  setToastSink,
  syncUiPlugins,
  ValueKindPoint,
  type OutlineNode,
  type ValueKindSpec,
} from "@kb/ui-sdk";
import { outlineValueKindsPlugin, slotKindOf } from "@kb/outline-ui";
import { browserHostUiPlugin } from "@/browser-host";

const spec: ValueKindSpec = {
  editor: "swatch",
  text: (value) => String(value.v),
  parse: (text) => ({ ok: true, value: { t: "num", v: Number(text) } }),
  isBlank: (value) => value.t !== "num",
  layout: "stack",
  follow: () => null,
};
const Surface = () => null;

describe("a family's value kind", () => {
  it("is for its type's option, answering to the type's declared id", () => {
    const entry = provideValueKind("x.stars", { icon: "star", spec, Surface });
    expect(entry.id).toBe("stars");
    expect(entry.value.type).toBe(declaredOptionId(FIELD_TYPE_OPTIONS, "x.stars"));
    expect(entry.value.type).toBe("sys.ft.x.stars");
    expect(entry.value.icon).toBe(StarIcon);
    expect(entry.value.spec).toBe(spec);
  });

  it("refuses an icon kb does not name", () => {
    for (const icon of ["unicorn", "constructor", "__proto__"]) {
      expect(() => provideValueKind("x.stars", { icon: icon as never, spec, Surface })).toThrow(
        /value kind x.stars: ".*" is no icon kb names/,
      );
    }
  });
});

/** A plugin contributing `value` as a kind, whatever it is. */
const malformed = (value: unknown) =>
  definePlugin({
    name: "x",
    namespace: "x",
    apply: (ctx) => ctx.contribute(ValueKindPoint, { id: "stars", value: value as never }),
  });
/** The kind the page holds for `option`, if any. */
const kinds = (option: string) =>
  currentContributions(ValueKindPoint).find(({ value }) => value.type === option)?.value;

describe("a value kind the point's contract refuses", () => {
  const STARS = "sys.ft.x.stars";
  const AT = "2026-11-09T00:00:00.000Z";
  const field: OutlineNode = {
    id: "f.rated",
    text: "rated",
    parentId: null,
    collapsed: false,
    tags: [],
    children: [],
    props: { [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: STARS }] },
    createdAt: AT,
    updatedAt: AT,
  };
  const schema = schemaOfGraph(new Map([[field.id, field]]));

  afterAll(() => syncUiPlugins([browserHostUiPlugin, outlineValueKindsPlugin]));

  it("is refused where it is contributed, and its fields draw as the type they store as", () => {
    const shapes = [
      { type: STARS, spec: {}, icon: null, Surface: null },
      { type: STARS, spec: { ...spec, editor: "dial" }, icon: StarIcon, Surface },
      { type: STARS, spec: { ...spec, parse: "number" }, icon: StarIcon, Surface },
      { type: STARS, spec, icon: "star", Surface },
    ];
    for (const shape of shapes) {
      const told: string[] = [];
      setToastSink((message) => told.push(message));
      syncUiPlugins([outlineValueKindsPlugin, malformed(shape)]);
      expect(told.join("\n")).toMatch(/UI plugin x failed to load/);
      expect(kinds(STARS)).toBeUndefined();
      expect(slotKindOf(kinds, "number", field.id, schema).name).toBe("number");
    }
  });

  it("holds a well-formed one as it was written", () => {
    syncUiPlugins([
      outlineValueKindsPlugin,
      malformed({ type: STARS, spec, icon: StarIcon, Surface }),
    ]);
    expect(kinds(STARS)?.spec.parse).toBe(spec.parse);
    expect(slotKindOf(kinds, "number", field.id, schema).name).toBe("x.stars");
  });
});
