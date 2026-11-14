/**
 * Which kind a field's values sit in (DESIGN-UI.md → Field values): the kind
 * contributed to `ui.value-kinds` for its type's option, the outline's own
 * for a field that names its kind or parents its options.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StarIcon } from "@phosphor-icons/react";
import {
  currentContributions,
  schemaOfGraph,
  syncUiPlugins,
  ValueKindPoint,
  type FieldTypeKind,
  type OutlineNode,
} from "@kb/ui-sdk";
import { FIELD_TYPE_OPTION_IDS, FIELD_TYPES, SYSTEM_IDS } from "@kb/model";
import { outlineValueKindsPlugin, slotKindOf } from "./slot-kind";
import { VALUE_KINDS } from "./value-kind";
import { VALUE_VIEWS } from "./value-views";

const AT = "2026-11-09T00:00:00.000Z";

function node(id: string, props: OutlineNode["props"] = {}, children: string[] = []): OutlineNode {
  const base = { id, text: id, parentId: null, collapsed: false, tags: [] };
  return { ...base, children, props, createdAt: AT, updatedAt: AT };
}
const typed = (option: string) => ({
  [SYSTEM_IDS.fieldTypeField]: [{ t: "ref" as const, v: option }],
});

const STARS = "sys.ft.x.stars";
const stars: FieldTypeKind = {
  type: STARS,
  spec: VALUE_KINDS.number,
  icon: StarIcon,
  Surface: VALUE_VIEWS.number.Surface,
};
const schema = schemaOfGraph(
  new Map(
    [
      node("f.rated", typed(STARS)),
      node("f.counted", typed(FIELD_TYPE_OPTION_IDS.number)),
      node("f.status", typed(FIELD_TYPE_OPTION_IDS.ref), ["o.open"]),
      node("o.open"),
    ].map((n) => [n.id, n]),
  ),
);
const builtIns = (option: string) =>
  currentContributions(ValueKindPoint).find(({ value }) => value.type === option)?.value;
const withStars = (option: string) => (option === STARS ? stars : builtIns(option));

beforeAll(() => syncUiPlugins([outlineValueKindsPlugin]));
afterAll(() => syncUiPlugins([]));

describe("a field's value kind", () => {
  it("the outline contributes one kind per built-in type, for its option", () => {
    const types = currentContributions(ValueKindPoint).map(({ value }) => value.type);
    expect(types).toEqual(FIELD_TYPES.map((type) => FIELD_TYPE_OPTION_IDS[type]));
  });

  it("is the kind contributed for the option the field's type names", () => {
    const kind = slotKindOf(withStars, "number", "f.rated", schema);
    expect(kind.name).toBe("x.stars");
    expect(kind.icon).toBe(StarIcon);
    expect(slotKindOf(withStars, "number", "f.counted", schema).name).toBe("number");
  });

  it("is its type's when nothing is contributed for its option", () => {
    const kind = slotKindOf(builtIns, "number", "f.rated", schema);
    expect(kind.name).toBe("number");
    // The point holds what its contract read: the same row, field by field.
    expect(kind.spec).toStrictEqual(VALUE_KINDS.number);
  });

  it("is the outline's own for a field that names it or parents its options", () => {
    expect(slotKindOf(builtIns, "text", SYSTEM_IDS.colorField, schema).name).toBe("color");
    expect(slotKindOf(builtIns, "ref", "f.status", schema).name).toBe("option");
  });

  it("is refused, not guessed, when no kind is contributed for the type", () => {
    expect(() => slotKindOf(() => undefined, "date", "f.any", schema)).toThrow(
      /no value kind is contributed for date fields/,
    );
  });
});
