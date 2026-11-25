/**
 * Gliding's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): ocean layers, painterly shadows,
 * aircraft & wave-edge sheen/gleam, wind trails, and living seagull flock.
 */
import type { Knob, NumberKnob } from "@kb/model";

type EnumKnob = Extract<Knob, { readonly kind: "enum" }>;

const numKnob = (spec: {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit?: string;
}): NumberKnob => ({ kind: "number", ...spec });

const enumKnob = (spec: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly default: string;
}): EnumKnob => ({ kind: "enum", ...spec });

export const GLIDING_KNOB_MAP = {
  /** Sunlight warmth across shallow turquoise pools, foam and aircraft highlights. */
  sunWarmth: numKnob({
    id: "sun-warmth",
    label: "Sun warmth",
    min: -1,
    max: 1,
    step: 0.05,
    default: 0,
  }),
  /** Sea-foam ribbon density and crest coverage across ocean swells. */
  foam: numKnob({ id: "foam", label: "Sea foam", min: 0, max: 2, step: 0.05, default: 1 }),
  /** Organic shallow-seabed light dapples (net-free painterly caustics). */
  caustics: numKnob({
    id: "caustics",
    label: "Seafloor dapples",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.7,
  }),
  /** Depth parallax separation between seabed, swells, foam, shadows and aircraft. */
  parallax: numKnob({
    id: "parallax",
    label: "Layer parallax",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Animation speed of deep seabed shoals and light dapples. */
  seabedMotion: numKnob({
    id: "seabed-motion",
    label: "Seabed motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Animation speed of mid-water gouache wave swells and ocean currents. */
  swellMotion: numKnob({
    id: "swell-motion",
    label: "Swell motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Animation speed of surface chalky sea-foam ribbons and bubble lace. */
  foamMotion: numKnob({
    id: "foam-motion",
    label: "Foam motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Unified full-scene gouache brushwork & moving-painting edge harmony. */
  painterly: numKnob({
    id: "painterly",
    label: "Painterly brush",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  /** Unified cold-press watercolor paper tooth & pigment granulation over the whole frame. */
  paperTexture: numKnob({
    id: "paper-texture",
    label: "Paper grain",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  /** Blending mode used for ocean cast shadows under WB-027 and seagulls. */
  shadowBlend: enumKnob({
    id: "shadow-blend",
    label: "Shadow blend",
    options: [
      { id: "multiply", label: "Multiply" },
      { id: "ink", label: "Ink wash" },
      { id: "normal", label: "Gouache" },
      { id: "burn", label: "Deep burn" },
    ],
    default: "multiply",
  }),
  /** Painterly ocean cast shadow intensity for both WB-027 and seagulls. */
  shadowDepth: numKnob({
    id: "shadow-depth",
    label: "Ocean shadow",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  }),
  /** Painterly brush bleed & edge softness of ocean cast shadows. */
  shadowSoftness: numKnob({
    id: "shadow-softness",
    label: "Shadow softness",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  shadowSize: numKnob({
    id: "shadow-size",
    label: "Shadow size",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Nominal flight altitude / sun-offset distance coupling aircraft & shadow scale. */
  shadowAltitude: numKnob({
    id: "shadow-altitude",
    label: "Flight altitude",
    min: 0.4,
    max: 1.8,
    step: 0.05,
    default: 1,
    unit: "×",
  }),
  /** Intensity of cast nacelle shadow & dark shaded flanks directly on WB-027. */
  hullShadow: numKnob({
    id: "hull-shadow",
    label: "Plane shadow",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  }),
  /** Anime edge & corner-riding rim sheen sweeping across WB-027 bevels. */
  hullSheen: numKnob({
    id: "hull-sheen",
    label: "Wing & intake sheen",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  /** Luminous anime highlight sheen riding along the sunlit edges of ocean swells. */
  waveSheen: numKnob({
    id: "wave-sheen",
    label: "Wave-edge sheen",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  /** Subtle sunlit diamond sea gleam across bright swell facets. */
  seaGleam: numKnob({
    id: "sea-gleam",
    label: "Sea gleam",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  }),
  /** Short wingtip slipstream wind lines appearing on steep banks or high speed. */
  windTrails: numKnob({
    id: "wind-trails",
    label: "Wind trails",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.6,
  }),
  /** Living seagull flock visibility and cruising speed (0 hides birds). */
  birds: numKnob({ id: "birds", label: "Seagulls", min: 0, max: 2, step: 0.05, default: 1 }),
} as const;

export const GLIDING_KNOBS: readonly Knob[] = [
  GLIDING_KNOB_MAP.painterly,
  GLIDING_KNOB_MAP.paperTexture,
  GLIDING_KNOB_MAP.shadowBlend,
  GLIDING_KNOB_MAP.shadowDepth,
  GLIDING_KNOB_MAP.shadowSoftness,
  GLIDING_KNOB_MAP.shadowSize,
  GLIDING_KNOB_MAP.shadowAltitude,
  GLIDING_KNOB_MAP.hullShadow,
  GLIDING_KNOB_MAP.hullSheen,
  GLIDING_KNOB_MAP.waveSheen,
  GLIDING_KNOB_MAP.seaGleam,
  GLIDING_KNOB_MAP.sunWarmth,
  GLIDING_KNOB_MAP.foam,
  GLIDING_KNOB_MAP.caustics,
  GLIDING_KNOB_MAP.parallax,
  GLIDING_KNOB_MAP.seabedMotion,
  GLIDING_KNOB_MAP.swellMotion,
  GLIDING_KNOB_MAP.foamMotion,
  GLIDING_KNOB_MAP.windTrails,
  GLIDING_KNOB_MAP.birds,
];
