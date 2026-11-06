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

export type Knob = NumberKnob | BooleanKnob | EnumKnob;
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
