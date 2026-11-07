/**
 * A knob: one typed, live parameter of a scene, as whoever draws the scene
 * declares it (DESIGN-UI.md → The lab; → Page-head backdrops → Knobs). One
 * schema for every surface that offers one, so a lab study's parameters and
 * a backdrop's are declared, drawn (`KnobControl`, `@kb/ui-sdk`) and read
 * the same way. Isomorphic: what a knob is and how a value reads against it
 * are facts the page, the seed and the CLI all need.
 */

/** One choice of an enum knob: its id, the value the knob takes, and its label. */
export interface KnobOption {
  readonly id: string;
  readonly label: string;
}

interface KnobBase {
  /** Local to whatever declares the knob. */
  readonly id: string;
  readonly label: string;
}

/** A number in a range, moved in steps. */
export interface NumberKnob extends KnobBase {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Shown after the value. */
  readonly unit?: string;
}

/** On or off. */
export interface BooleanKnob extends KnobBase {
  readonly kind: "boolean";
  readonly default: boolean;
}

/** One of a fixed list. */
export interface EnumKnob extends KnobBase {
  readonly kind: "enum";
  readonly options: readonly KnobOption[];
  readonly default: string;
}

/** A colour, `#rrggbb`. */
export interface ColorKnob extends KnobBase {
  readonly kind: "color";
  readonly default: string;
}

/**
 * The seed a scene's variation is drawn from (DESIGN-UI.md → Page-head
 * backdrops → Variation): a whole number pins one composition; none, the
 * default, draws a new one each load.
 */
export interface SeedKnob extends KnobBase {
  readonly kind: "seed";
  readonly default: number | null;
}

export type Knob = NumberKnob | BooleanKnob | EnumKnob | ColorKnob | SeedKnob;
export type KnobKind = Knob["kind"];
export type KnobValue = Knob["default"];
export type KnobValues = Readonly<Record<string, KnobValue>>;

/** Each knob's declared default, by id: what a scene starts from. */
export function knobDefaults(knobs: readonly Knob[]): KnobValues {
  return Object.fromEntries(knobs.map((knob) => [knob.id, knob.default]));
}

/** The number `values` hold for the knob `id`, or `fallback` where they hold none. */
export function knobNumber(values: KnobValues, id: string, fallback: number): number {
  const value = values[id];
  return typeof value === "number" ? value : fallback;
}

/**
 * The value `values` hold for `knob`, typed as its kind's, or its default
 * where they hold none of that kind: how a scene reads the knob it
 * declared, by the knob itself, so its default is stated once.
 */
export function knobValue(values: KnobValues, knob: NumberKnob): number;
export function knobValue(values: KnobValues, knob: BooleanKnob): boolean;
export function knobValue(values: KnobValues, knob: EnumKnob | ColorKnob): string;
export function knobValue(values: KnobValues, knob: SeedKnob): number | null;
export function knobValue(values: KnobValues, knob: Knob): KnobValue {
  const value = values[knob.id];
  switch (knob.kind) {
    case "number":
      return typeof value === "number" ? value : knob.default;
    case "seed":
      return typeof value === "number" ? value : knob.default;
    case "boolean":
      return typeof value === "boolean" ? value : knob.default;
    case "enum":
    case "color":
    default:
      return typeof value === "string" ? value : knob.default;
  }
}

/** A colour as a colour knob holds it. */
export const KNOB_COLOR = /^#[0-9a-f]{6}$/i;

/** Whether `value` is a whole number of `step`s from `min`, within a float's rounding. */
function onStep(value: number, min: number, step: number): boolean {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Why `knob`'s own declaration cannot be drawn or read, or null where it can. */
function ownError(knob: Knob): string | null {
  switch (knob.kind) {
    case "number":
      if (!(knob.step > 0) || !(knob.max > knob.min)) return "its range or step is empty";
      if (knob.default < knob.min || knob.default > knob.max) return "its default is out of range";
      return onStep(knob.default, knob.min, knob.step) ? null : "its default is off its step";
    case "enum": {
      const ids = knob.options.map(({ id }) => id);
      if (new Set(ids).size !== ids.length) return "an option is listed twice";
      return ids.includes(knob.default) ? null : "its default is none of its options";
    }
    case "color":
      return KNOB_COLOR.test(knob.default) ? null : "its default is not #rrggbb";
    case "seed":
      return knob.default === null || Number.isSafeInteger(knob.default)
        ? null
        : "its default is not a whole number";
    // A boolean is either value; nothing it declares can be wrong.
    case "boolean":
    default:
      return null;
  }
}

/**
 * Why a list of knobs, as one scene declares them, is not a schema a panel
 * can draw and a reader resolve, or null where it is: each id once, each
 * default one its own knob accepts, and at most one seed, since a scene
 * draws its variation from one.
 */
export function knobSchemaError(knobs: readonly Knob[]): string | null {
  const seen = new Set<string>();
  for (const knob of knobs) {
    if (seen.has(knob.id)) return `the knob ${knob.id} is declared twice`;
    seen.add(knob.id);
    const error = ownError(knob);
    if (error !== null) return `the knob ${knob.id}: ${error}`;
  }
  const seeds = knobs.filter(({ kind }) => kind === "seed");
  return seeds.length > 1 ? `more than one seed: ${seeds.map(({ id }) => id).join(", ")}` : null;
}
