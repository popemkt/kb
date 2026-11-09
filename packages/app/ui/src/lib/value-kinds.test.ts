/**
 * A family's field type's value kind (DESIGN-UI.md → Field values): its page
 * half contributes it for the type's option node, under the type's declared
 * id, with its glyph named as a form names one.
 */
import { describe, expect, it } from "vitest";
import { StarIcon } from "@phosphor-icons/react";
import { FIELD_TYPE_OPTIONS, declaredOptionId } from "@kb/model";
import { provideValueKind, type ValueKindSpec } from "@kb/ui-sdk";

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
