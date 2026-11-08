/**
 * Knobs as data (DESIGN-UI.md → Page-head backdrops → Knobs): a declared
 * option's knobs are fields the fold derives, one per knob, each holding
 * one value and configuring the option's own node (`sys.f.configures`), so
 * a backdrop's values are fields on the backdrop's node, a variant's on the
 * variant's, written as any setting is: by a person, the CLI's `kb set`, or
 * an agent's `node.update`. The fold seeds no value: an absent one is the
 * knob's default, and taking a value out (`kb unset`) resets it.
 *
 * This module is the one home of the fields' ids, their types, and how a
 * value is written to its field and read back against its knob.
 */
import { backdropOptionId, backdropVariantOptionId, type SeedBackdrop } from "./backdrop.ts";
import { KNOB_COLOR, type Knob, type KnobValue, type KnobValues } from "./knob.ts";
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import type { FieldType } from "./field-type.ts";
import { seededField } from "./seed.ts";

/** The field holding the knob `knobId`'s value on the node `holder` it configures. */
export function knobFieldId(holder: NodeId, knobId: string): NodeId {
  return `${holder}.knob.${knobId}`;
}

/** The option node of the enum knob field `field` that says `optionId`: the field's child. */
export function knobOptionId(field: NodeId, optionId: string): NodeId {
  return `${field}.${optionId}`;
}

/** The field type a knob's value is held as. */
const FIELD_TYPE: Readonly<Record<Knob["kind"], FieldType>> = {
  number: "number",
  seed: "number",
  boolean: "checkbox",
  enum: "ref",
  color: "text",
};

/**
 * The fields `knobs` derive on the node `holder`, labelled `<holder's
 * label> · <knob's label>`: one per knob, configuring the holder and
 * holding one value, and an enum's options as its field's children.
 */
export function knobFields(
  holder: NodeId,
  holderLabel: string,
  knobs: readonly Knob[],
  at: string,
): KbNode[] {
  const setting = {
    one: true,
    props: { [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: holder }] },
  };
  return knobs.flatMap((knob) => {
    const id = knobFieldId(holder, knob.id);
    const field = seededField(
      id,
      `${holderLabel} · ${knob.label}`,
      FIELD_TYPE[knob.kind],
      at,
      setting,
    );
    if (knob.kind !== "enum") return [field];
    const options = knob.options.map(
      (option): KbNode => ({
        id: knobOptionId(id, option.id),
        text: option.label,
        props: {},
        children: [],
        createdAt: at,
        updatedAt: at,
      }),
    );
    return [{ ...field, children: options.map((option) => option.id) }, ...options];
  });
}

/** How many decimals `n` is written with, its exponent counted (`1e-7` is written with seven). */
function decimalsOf(n: number): number {
  const [mantissa = "", exponent = "0"] = String(n).split("e");
  return Math.max(0, (mantissa.split(".")[1] ?? "").length - Number(exponent));
}

/** A number held to `knob`'s range, on its nearest step. */
function stepped(knob: Extract<Knob, { kind: "number" }>, value: number): number {
  const steps = Math.round((value - knob.min) / knob.step);
  const on = knob.min + steps * knob.step;
  // Rounded to the decimals of the step and of its origin, so 0.1 steps read 0.3, not
  // 0.30000000000000004, and 0.1 steps from 0.05 read 0.15, not 0.2.
  const decimals = Math.max(decimalsOf(knob.step), decimalsOf(knob.min));
  return Math.min(knob.max, Math.max(knob.min, Number(on.toFixed(decimals))));
}

/** The value `held` says for `knob` (its field `field`), or undefined where it says none it accepts. */
function readHeld(knob: Knob, field: NodeId, held: PropValue | undefined): KnobValue | undefined {
  if (held === undefined) return undefined;
  switch (knob.kind) {
    case "number":
      return held.t === "num" && Number.isFinite(held.v) ? stepped(knob, held.v) : undefined;
    case "seed":
      return held.t === "num" && Number.isSafeInteger(held.v) && held.v >= 0 ? held.v : undefined;
    case "boolean":
      return held.t === "bool" ? held.v : undefined;
    case "color":
      return held.t === "str" && KNOB_COLOR.test(held.v) ? held.v.toLowerCase() : undefined;
    case "enum":
    default: {
      if (held.t !== "ref") return undefined;
      const option = knob.options.find(({ id }) => knobOptionId(field, id) === held.v);
      return option?.id;
    }
  }
}

/**
 * The value `field` holds for `value` of `knob`: what reads back as it
 * (`knobValues`), a number on its step, an enum's option as the ref to its
 * option node. Null where it holds none: a seed left to each load, or a
 * value its knob does not accept.
 */
export function knobPropValue(knob: Knob, field: NodeId, value: KnobValue): PropValue | null {
  switch (knob.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { t: "num", v: stepped(knob, value) }
        : null;
    case "seed":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? { t: "num", v: value }
        : null;
    case "boolean":
      return typeof value === "boolean" ? { t: "bool", v: value } : null;
    case "color":
      return typeof value === "string" && KNOB_COLOR.test(value)
        ? { t: "str", v: value.toLowerCase() }
        : null;
    case "enum":
    default:
      return typeof value === "string" && knob.options.some(({ id }) => id === value)
        ? { t: "ref", v: knobOptionId(field, value) }
        : null;
  }
}

/**
 * The values `knobs` have on the node `holder`, read from its `props`, by
 * knob id: each the value held where its knob accepts it (a number held to
 * its range and step), else its default. So whatever a store holds, a
 * scene is handed values its knobs declare.
 */
export function knobValues(
  knobs: readonly Knob[],
  holder: NodeId,
  props: KbNode["props"] | undefined,
): KnobValues {
  return Object.fromEntries(
    knobs.map((knob) => {
      const field = knobFieldId(holder, knob.id);
      return [knob.id, readHeld(knob, field, props?.[field]?.[0]) ?? knob.default];
    }),
  );
}

/**
 * The values of the knobs `backdrop` shows with its variant `variant` drawn
 * (`knobsOf`; null, none): its own, read from its option node's props
 * (`backdropProps`), and the variant's own, from the variant's option
 * node's (`variantProps`).
 */
export function backdropKnobValues(
  backdrop: SeedBackdrop,
  variant: string | null,
  backdropProps: KbNode["props"] | undefined,
  variantProps: KbNode["props"] | undefined,
): KnobValues {
  const own = backdrop.variants?.find(({ id }) => id === variant)?.knobs ?? [];
  return {
    ...knobValues(backdrop.knobs ?? [], backdropOptionId(backdrop.id), backdropProps),
    ...(variant === null
      ? {}
      : knobValues(own, backdropVariantOptionId(backdrop.id, variant), variantProps)),
  };
}
