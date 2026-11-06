/**
 * Knobs as data (DESIGN-UI.md → Page-head backdrops → Knobs): the fold
 * derives one field per knob a declared option declares, typed by its
 * kind, holding one value and configuring that option's own node, so a
 * backdrop's values are fields on the backdrop's node, a variant's on the
 * variant's, written as any setting is; and a value read back resolves
 * against its knob, so whatever a store holds, the scene is handed a value
 * its knob accepts.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKDROP_OPTIONS,
  BACKDROP_VARIANT_OPTIONS,
  FIELD_TYPE_OPTION_IDS,
  SYSTEM_IDS,
  backdropKnobValues,
  backdropOptionId,
  backdropVariantOptions,
  cardinalityOf,
  configures,
  declaredOptionId,
  foldSeed,
  knobFieldId,
  knobOptionId,
  knobValues,
  type Knob,
  type KbNode,
  type PropValue,
  type SeedBackdrop,
  type SeedSource,
} from "../src/index.ts";

const AT = "2026-11-06T00:00:00.000Z";

const SPEED: Knob = {
  kind: "number",
  id: "speed",
  label: "Speed",
  min: 0,
  max: 2,
  step: 0.25,
  default: 1,
};
const LOOK: Knob = {
  kind: "enum",
  id: "look",
  label: "Look",
  options: [
    { id: "glow", label: "Glow" },
    { id: "ink", label: "Ink" },
  ],
  default: "glow",
};
const TINT: Knob = { kind: "color", id: "tint", label: "Tint", default: "#ff8800" };
const SEED: Knob = { kind: "seed", id: "seed", label: "Seed", default: null };
const GRAIN: Knob = { kind: "boolean", id: "grain", label: "Grain", default: true };
const SPIN: Knob = {
  kind: "number",
  id: "spin",
  label: "Spin",
  min: -1,
  max: 1,
  step: 0.5,
  default: 0,
};

const HOLE: SeedBackdrop = {
  id: "probe.hole",
  label: "Hole",
  knobs: [SPEED, LOOK, TINT, SEED, GRAIN],
  variants: [
    { id: "plain", label: "Plain" },
    { id: "warp", label: "Warp", knobs: [SPIN] },
  ],
};
const PROBE: SeedSource = {
  name: "probe",
  label: "Probe",
  declaredOptions: [
    { kind: BACKDROP_OPTIONS, options: [HOLE] },
    { kind: BACKDROP_VARIANT_OPTIONS, options: backdropVariantOptions([HOLE]) },
  ],
};
/** Core's own nodes, which the declared options are filed under. */
const CORE: SeedSource = {
  name: "core",
  label: "Core",
  seed: (at) =>
    [
      SYSTEM_IDS.backdropField,
      SYSTEM_IDS.backdropVariantField,
      SYSTEM_IDS.viewsRoot,
      SYSTEM_IDS.extensionsRoot,
    ].map(
      (id): KbNode => ({ id, text: id, props: {}, children: [], createdAt: at, updatedAt: at }),
    ),
};

const folded = foldSeed([CORE, PROBE], AT);
const byId = new Map(folded.nodes.map((node) => [node.id, node]));
const HOLE_NODE = backdropOptionId(HOLE.id);
const WARP_NODE = declaredOptionId(BACKDROP_VARIANT_OPTIONS, `${HOLE.id}.warp`);

describe("the fold derives a field per knob", () => {
  test("each a child of the option it configures, typed by its kind, holding one value", () => {
    expect(byId.get(HOLE_NODE)?.children).toEqual(
      ["speed", "look", "tint", "seed", "grain"].map((id) => knobFieldId(HOLE_NODE, id)),
    );
    const type = (id: string) =>
      byId.get(knobFieldId(HOLE_NODE, id))?.props[SYSTEM_IDS.fieldTypeField];
    expect(type("speed")).toEqual([{ t: "ref", v: FIELD_TYPE_OPTION_IDS.number }]);
    expect(type("seed")).toEqual([{ t: "ref", v: FIELD_TYPE_OPTION_IDS.number }]);
    expect(type("look")).toEqual([{ t: "ref", v: FIELD_TYPE_OPTION_IDS.ref }]);
    expect(type("tint")).toEqual([{ t: "ref", v: FIELD_TYPE_OPTION_IDS.text }]);
    expect(type("grain")).toEqual([{ t: "ref", v: FIELD_TYPE_OPTION_IDS.checkbox }]);
    for (const id of ["speed", "look", "tint", "seed", "grain"]) {
      const field = byId.get(knobFieldId(HOLE_NODE, id));
      expect(field?.text).toBe(`Hole · ${HOLE.knobs?.find((k) => k.id === id)?.label}`);
      expect(cardinalityOf(field?.props)).toBe("one");
      expect(configures(knobFieldId(HOLE_NODE, id), field, { id: HOLE_NODE })).toBe(true);
    }
  });

  test("an enum's options are its field's children, labelled", () => {
    const field = byId.get(knobFieldId(HOLE_NODE, "look"));
    expect(field?.children).toEqual([
      knobOptionId(field?.id ?? "", "glow"),
      knobOptionId(field?.id ?? "", "ink"),
    ]);
    expect(byId.get(knobOptionId(field?.id ?? "", "ink"))?.text).toBe("Ink");
  });

  test("a variant's own knobs configure the variant's node", () => {
    const spin = knobFieldId(WARP_NODE, "spin");
    expect(byId.get(WARP_NODE)?.children).toEqual([spin]);
    expect(configures(spin, byId.get(spin), { id: WARP_NODE })).toBe(true);
    expect(configures(spin, byId.get(spin), { id: HOLE_NODE })).toBe(false);
  });

  test("seeds no value, so an absent one is the default, and each is the declaring source's", () => {
    expect(
      Object.keys(byId.get(HOLE_NODE)?.props ?? {}).filter((f) => f.includes(".knob.")),
    ).toEqual([]);
    expect(folded.owners.get(knobFieldId(HOLE_NODE, "speed"))).toBe("probe");
    expect(folded.owners.get(knobFieldId(WARP_NODE, "spin"))).toBe("probe");
  });
});

/** The props of a node holding `values` for HOLE's knobs, by knob id. */
const holding = (node: string, values: Record<string, PropValue>): KbNode["props"] =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [knobFieldId(node, id), [value]]));

describe("a knob's value read back", () => {
  test("is its default where none is held", () => {
    expect(knobValues(HOLE.knobs ?? [], HOLE_NODE, {})).toEqual({
      speed: 1,
      look: "glow",
      tint: "#ff8800",
      seed: null,
      grain: true,
    });
  });

  test("is the value held, a number held to its range and step", () => {
    const read = (value: number) =>
      knobValues([SPEED], HOLE_NODE, holding(HOLE_NODE, { speed: { t: "num", v: value } })).speed;
    expect(read(1.5)).toBe(1.5);
    expect(read(9)).toBe(2);
    expect(read(-3)).toBe(0);
    expect(read(1.3)).toBe(1.25);
  });

  test("an enum's option by its ref, a colour lower-cased, a whole seed, a checkbox", () => {
    const look = knobFieldId(HOLE_NODE, "look");
    expect(
      knobValues(HOLE.knobs ?? [], HOLE_NODE, {
        ...holding(HOLE_NODE, {
          tint: { t: "str", v: "#00AAFF" },
          seed: { t: "num", v: 42 },
          grain: { t: "bool", v: false },
        }),
        [look]: [{ t: "ref", v: knobOptionId(look, "ink") }],
      }),
    ).toEqual({ speed: 1, look: "ink", tint: "#00aaff", seed: 42, grain: false });
  });

  test("a value its knob does not accept reads as the default", () => {
    const look = knobFieldId(HOLE_NODE, "look");
    expect(
      knobValues(HOLE.knobs ?? [], HOLE_NODE, {
        ...holding(HOLE_NODE, {
          speed: { t: "str", v: "fast" },
          tint: { t: "str", v: "orange" },
          seed: { t: "num", v: 4.5 },
          grain: { t: "str", v: "yes" },
        }),
        [look]: [{ t: "ref", v: "elsewhere" }],
      }),
    ).toEqual({ speed: 1, look: "glow", tint: "#ff8800", seed: null, grain: true });
  });

  test("a backdrop's from its node, the drawn variant's own from the variant's", () => {
    const backdrop = holding(HOLE_NODE, { speed: { t: "num", v: 2 } });
    const variant = holding(WARP_NODE, { spin: { t: "num", v: -1 } });
    expect(backdropKnobValues(HOLE, "warp", backdrop, variant)).toMatchObject({
      speed: 2,
      spin: -1,
    });
    expect(backdropKnobValues(HOLE, "plain", backdrop, undefined)).not.toHaveProperty("spin");
  });
});
