/**
 * Astral's instruments as data (DESIGN-UI.md → Page-head backdrops → Astral):
 * what each composition is made of, how its trains move, and when the sky's
 * rare events come. Nothing here touches three: `astral-scene.ts` builds
 * whatever a `Mechanism` lists, by one builder per kind of part, so a
 * composition is only the list.
 *
 * - **Parts.** A wheel (a disc, an annulus, toothed or not, with spokes and
 *   engraving: a balance's hairspring is a spiral cut in a lacquered disc),
 *   an arm (a tapered rule, a hand, a rete pointer), a rod, a star (a
 *   four-point needle star, drawn
 *   facing the eye whatever carries it) and a bare group. Each stands in
 *   its parent's frame (`at`, `tilt`) and turns about its own axis by its
 *   drive.
 * - **Drives.** A train ticks (`trainClock`): eased steps with a little
 *   escapement recoil, then a rest; each wheel on it turns by its ratio, so
 *   meshing wheels (`meshed`) turn by their teeth, and a wheel that moves
 *   only every few ticks jumps on those. A balance swings; a bearing turns
 *   on, slowly.
 * - **Each load is composed anew** (`compositions.ts`): ring counts,
 *   ratios, where the stars and the wheels stand, from the load's
 *   variation, within what the composition's picture allows.
 * - **The sky's rare events** (`ambient`): a shooting star, a constellation
 *   drawing itself and fading, a far train engaging, a glint sweeping the
 *   metal, each on a clock of its own, a few a minute between them.
 */
import { TAU } from "../scene/math";
import type { Rng } from "../scene/rng";

/** The compositions, by the variant ids the backdrop declares (`@kb/backdrops`). */
export const ASTRAL_VARIANTS = ["movement", "orrery", "planisphere", "armillary"] as const;
export type AstralVariant = (typeof ASTRAL_VARIANTS)[number];

export const isAstralVariant = (id: string | null): id is AstralVariant =>
  (ASTRAL_VARIANTS as readonly (string | null)[]).includes(id);

/**
 * What a part is made of. On a dark page each is metal of its kind; on a
 * light one the same parts are ink and gilt on paper (`astral-shader.ts`):
 * plate and champagne are paper engraved in ink, silver is graphite, gilt
 * stays gilt and blued steel is the Prussian-blue accent.
 */
export type Metal = "plate" | "champagne" | "silver" | "gilt" | "blued";

/** A star's colour: dark, light. Ink on paper is champagne on the night sky. */
export type StarTone = "ivory" | "champagne" | "ice" | "gilt" | "ink";

/** What is cut into a wheel's face, radii in its own units. */
export type Engraving =
  | {
      readonly kind: "guilloche";
      readonly from: number;
      readonly to: number;
      readonly lines: number;
      readonly petals: number;
    }
  | {
      readonly kind: "scale";
      readonly from: number;
      readonly to: number;
      readonly ticks: number;
      readonly major: number;
    }
  | { readonly kind: "rings"; readonly radii: readonly number[] }
  /** A star chart's circles of declination and its hour arcs, out to `radius`. */
  | { readonly kind: "chart"; readonly radius: number }
  /** Côtes: fine straight lines across the face, as a wheel's finish. */
  | { readonly kind: "cotes" }
  /** A hairspring: a flat spiral of `coils` turns from `from` out to `to`. */
  | { readonly kind: "spiral"; readonly from: number; readonly to: number; readonly coils: number };

export interface WheelShape {
  readonly kind: "wheel";
  /** Its pitch radius (teeth) or rim. */
  readonly radius: number;
  /** An annulus's inner radius; 0, a solid disc. */
  readonly inner: number;
  readonly teeth: number;
  /** Spokes between the hub and the rim; 0, a solid web. */
  readonly spokes: number;
  readonly thickness: number;
  readonly metal: Metal;
  readonly engravings: readonly Engraving[];
}

/** A tapered rule from its pivot out along +x: `length` ahead, `tail` behind. */
export interface ArmShape {
  readonly kind: "arm";
  readonly length: number;
  readonly tail: number;
  readonly width: number;
  readonly thickness: number;
  readonly metal: Metal;
}

/** A round rod along +y from its foot. */
export interface RodShape {
  readonly kind: "rod";
  readonly length: number;
  readonly radius: number;
  readonly metal: Metal;
}

/**
 * A four-point needle star: its long spike `size` (own units), the cross
 * spike `across` of it, turned `angle` in the picture. The hub is the one
 * that flares at an event, and its needles run far past the mechanism.
 */
export interface StarShape {
  readonly kind: "star";
  readonly size: number;
  readonly tone: StarTone;
  readonly across: number;
  readonly angle: number;
  readonly hub?: boolean;
}

export interface GroupShape {
  readonly kind: "group";
}

type Shape = WheelShape | ArmShape | RodShape | StarShape | GroupShape;

/** Which train a part ticks with: the instrument's, or the far one that engages now and then. */
export type Train = "main" | "far";

export type Drive =
  /** Turns `ratio` steps (`STEP` radians) a tick, moving only on every `every`th. */
  | { readonly kind: "tick"; readonly train: Train; readonly ratio: number; readonly every: number }
  /** Swings `amplitude` radians either way, once every `period` seconds. */
  | { readonly kind: "swing"; readonly amplitude: number; readonly period: number }
  /** Turns on, `rate` radians a second. */
  | { readonly kind: "turn"; readonly rate: number };

export type Vec3 = readonly [number, number, number];

export interface Part {
  readonly shape: Shape;
  /** In its parent's frame (the instrument's units: its main circle is about 1). */
  readonly at: Vec3;
  /** Euler angles (XYZ, radians) from its parent's frame. */
  readonly tilt?: Vec3;
  /** Its turn about its own axis at rest (radians). */
  readonly spin?: number;
  readonly drive?: Drive;
  readonly children?: readonly Part[];
}

/** A composition: its parts, its far train, its scale and its own looks. */
export interface Mechanism {
  readonly variant: AstralVariant;
  readonly parts: readonly Part[];
  /** Frame heights per unit of the instrument at its wide scale. */
  readonly unit: number;
  /** Where the hero stands (`framing.ts`): its panel and wide compositions. */
  readonly panel: { readonly x: number; readonly y: number; readonly scale: number };
  readonly wide: { readonly x: number; readonly y: number; readonly scale: number };
  /** How far the whole leans, and how far and how slowly it drifts (radians, seconds): the eye moving round it. */
  readonly lean: Vec3;
  readonly drift: { readonly yaw: number; readonly pitch: number; readonly period: number };
  /**
   * Its dark sky (linear), when it is not the ink-navy with a champagne
   * warmth at the hub: the night it pools to and the light its hub glows
   * with. The orrery is silver on black; the armillary glows cool.
   */
  readonly sky?: {
    readonly night: readonly [number, number, number];
    readonly glow: readonly [number, number, number];
  };
  /** The sky's graduated great circle, far behind: its centre from the hero and its radius (the instrument's units). */
  readonly arc?: { readonly at: readonly [number, number]; readonly radius: number };
  /** The constellation far behind it, in open sky. */
  readonly constellation: Constellation;
  /**
   * Where the eye focuses, as the concept pictures' depth of field: the
   * focal plane's depth from the hero (`at`, z in the instrument's units),
   * the band either side of it that stays sharp (`depth`), how much further
   * a part takes to blur fully (`falloff`), and that widest blur (`radius`,
   * CSS pixels). None: every depth sharp.
   */
  readonly focus?: {
    readonly at: number;
    readonly depth: number;
    readonly falloff: number;
    readonly radius: number;
  };
}

/** How many stars and links a constellation has at most: the sky's slots for it. */
export const CONSTELLATION_POINTS = 7;
export const CONSTELLATION_LINKS = 8;

/**
 * A constellation in the sky: its stars (x, y from the hero and the long
 * spike, the instrument's units), and the hairlines joining them, by index
 * into `stars`. The sky draws it (`astral-shader.ts`), each star in a small
 * ring, as the concept pictures do.
 */
export interface Constellation {
  readonly stars: readonly Vec3[];
  readonly links: readonly (readonly [number, number])[];
}

/** One step of a tick: a sixtieth of a turn, as a seconds wheel. */
const STEP = TAU / 60;

/** How often the instrument ticks (s), and how long a step takes. Calm: a slow escapement. */
export const TICK_PERIOD = 2;
export const STEP_SECONDS = 0.34;

/** How far a step overshoots before the escapement's recoil settles it (a share of a step). */
const OVERSHOOT = 0.06;

/**
 * A step's shape over `u` (0–1): a quick advance a little past the notch,
 * a recoil just short of it, then the rest. 0 at 0, 1 from 1 on.
 */
export function tickEase(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < 0.5) {
    const k = u / 0.5;
    return (1 + OVERSHOOT) * (1 - (1 - k) ** 3);
  }
  const s = (u - 0.5) / 0.5;
  return 1 + OVERSHOOT * Math.cos(TAU * 0.75 * s) * (1 - s) ** 2;
}

/**
 * A train's position, in ticks: it ticks every `period` seconds from its
 * start, and an event adds one more at once (`notch`). Steps under way are
 * eased (`tickEase`); one begun while another is under way runs over it.
 */
export interface TrainClock {
  /** Advance to `time` (seconds; only ever forward). */
  readonly advance: (time: number) => void;
  /** One more tick, now. */
  readonly notch: () => void;
  /** Where a wheel that moves on every `every`th tick stands: whole ticks and the eased step. */
  readonly position: (every: number) => number;
  /** How many ticks have begun. */
  readonly ticks: () => number;
}

interface Begun {
  readonly index: number;
  readonly at: number;
}

export function trainClock(period: number, start: number): TrainClock {
  let now = start;
  let scheduled = Math.floor(start / period);
  let begun = scheduled;
  let underway: Begun[] = [];
  const begin = (at: number) => {
    underway.push({ index: begun, at });
    begun += 1;
  };
  return {
    advance: (time) => {
      if (time < now) return;
      now = time;
      while ((scheduled + 1) * period <= now) {
        scheduled += 1;
        begin(scheduled * period);
      }
      underway = underway.filter((tick) => now - tick.at < STEP_SECONDS);
    },
    notch: () => begin(now),
    position: (every) => {
      const k = Math.max(1, Math.round(every));
      // Steps a wheel has finished: of the ticks done, every kth.
      const done = begun - underway.length;
      let at = Math.floor(done / k);
      for (const tick of underway) {
        if ((tick.index + 1) % k === 0) at += tickEase((now - tick.at) / STEP_SECONDS);
      }
      return at;
    },
    ticks: () => begun,
  };
}

/** The angle a drive stands at: `ticks(every)` from its train, `time` for the rest. */
export function driveAngle(
  drive: Drive,
  ticks: (train: Train, every: number) => number,
  time: number,
): number {
  switch (drive.kind) {
    case "tick":
      return ticks(drive.train, drive.every) * drive.ratio * STEP;
    case "swing":
      return drive.amplitude * Math.sin((TAU * time) / drive.period);
    case "turn":
      return drive.rate * time;
    default:
      return drive satisfies never;
  }
}

/**
 * Wheel `b` meshing with wheel `a`: where its centre stands (`angle` from
 * a's, both pitch circles touching), its turn at rest so its teeth fall
 * in a's gaps, and its ratio, opposite a's by their teeth.
 */
export function meshed(
  a: { readonly at: Vec3; readonly radius: number; readonly teeth: number; readonly spin: number },
  aRatio: number,
  b: { readonly radius: number; readonly teeth: number },
  angle: number,
): { readonly at: Vec3; readonly spin: number; readonly ratio: number } {
  const d = a.radius + b.radius;
  const at: Vec3 = [a.at[0] + d * Math.cos(angle), a.at[1] + d * Math.sin(angle), a.at[2]];
  // a's tooth phase where they touch (0 at a tooth's centre), and b's the mirror of it.
  const pitchA = TAU / a.teeth;
  const pitchB = TAU / b.teeth;
  const phase = ((((angle - a.spin) / pitchA - 0.5) % 1) + 1) % 1;
  const want = (((0.5 - phase) % 1) + 1) % 1;
  const spin = angle + Math.PI - (want + 0.5) * pitchB;
  return { at, spin, ratio: (-aRatio * a.teeth) / b.teeth };
}

/** The rare events of the sky, each on its own clock. */
export type AmbientKind = "shootingStar" | "constellation" | "farTrain" | "glint";

/** How long between two of a kind (s, drawn in the range) and how long one lasts. */
export const AMBIENT: Readonly<
  Record<AmbientKind, { readonly gap: readonly [number, number]; readonly lasts: number }>
> = {
  shootingStar: { gap: [28, 75], lasts: 1.3 },
  constellation: { gap: [55, 110], lasts: 21 },
  farTrain: { gap: [35, 85], lasts: 6 },
  glint: { gap: [24, 75], lasts: 3.4 },
};

/** One event under way: its kind, when it began, its own draw (0–1) for where and which way. */
export interface Happening {
  readonly kind: AmbientKind;
  readonly at: number;
  readonly draw: number;
}

/** The sky's clock: each kind's next event drawn from its own stream. */
export interface Ambient {
  /** Advance to `time`; each kind's event under way, if one is. */
  readonly at: (time: number) => Readonly<Partial<Record<AmbientKind, Happening>>>;
}

export function ambient(stream: (name: string) => Rng, start: number): Ambient {
  const kinds: readonly AmbientKind[] = ["shootingStar", "constellation", "farTrain", "glint"];
  const streams = new Map(kinds.map((kind) => [kind, stream(`ambient.${kind}`)] as const));
  const gapOf = (kind: AmbientKind): number => {
    const [low, high] = AMBIENT[kind].gap;
    return streams.get(kind)?.range(low, high) ?? high;
  };
  // The first of each comes part of a gap in, so a load does not open with all of them at once.
  const next = new Map(
    kinds.map((kind) => [kind, start + gapOf(kind) * (streams.get(kind)?.range(0.15, 0.8) ?? 0.5)]),
  );
  const current = new Map<AmbientKind, Happening>();
  return {
    at: (time) => {
      const out: Partial<Record<AmbientKind, Happening>> = {};
      for (const kind of kinds) {
        const due = next.get(kind) ?? Infinity;
        if (time >= due) {
          current.set(kind, { kind, at: due, draw: streams.get(kind)?.next() ?? 0.5 });
          next.set(kind, due + AMBIENT[kind].lasts + gapOf(kind));
        }
        const on = current.get(kind);
        if (on !== undefined && time - on.at < AMBIENT[kind].lasts) out[kind] = on;
        else current.delete(kind);
      }
      return out;
    },
  };
}

/** How far through its life an event is, 0–1. */
export const lifeOf = (happening: Happening, time: number): number =>
  Math.min(1, Math.max(0, (time - happening.at) / AMBIENT[happening.kind].lasts));

/** Where the gleam peaks (a share of its life), and how its flash rings down after (shares of its life). */
const GLEAM = { peak: 0.46, hold: 0.035, swap: 0.06, decay: 0.09 } as const;
/** The flash's first swing back, against its peak: the spring's overshoot, as in ZZZ's. */
const SPRING_OVERSHOOT = 0.42;
/** The spring's period: e^(-t/decay) has fallen to SPRING_OVERSHOOT by its half period. */
const RING = 2 * GLEAM.decay * Math.log(1 / SPRING_OVERSHOOT);

/** A gleam at one moment: how far across, how bright, its colour split (-1, 0 or 1) and its flash. */
export interface Gleam {
  readonly travel: number;
  readonly strength: number;
  readonly split: number;
  readonly flash: number;
}

/**
 * The gleam's life, 0–1, as a gesture rather than a swipe: it gathers
 * (a faint creep at its start), builds (gaining speed and light toward the
 * middle), strikes (a flash, and the colour split cyan and magenta for a
 * held beat, then swapped, then gone: hard steps, never a fade) and dies
 * away slowly as it leaves, the flash ringing down on an underdamped
 * spring.
 */
export function gleamAt(life: number): Gleam {
  const l = Math.min(1, Math.max(0, life));
  const { peak, hold, swap, decay } = GLEAM;
  const gather = 0.18;
  const creep = 0.06;
  let travel: number;
  let strength: number;
  if (l < gather) {
    const k = l / gather;
    travel = creep * k * k;
    strength = 0.25 * k;
  } else if (l < peak) {
    const k = (l - gather) / (peak - gather);
    travel = creep + (0.5 - creep) * k * k;
    strength = 0.25 + 0.75 * k * k;
  } else {
    const k = (l - peak) / (1 - peak);
    travel = 0.5 + 0.5 * (1 - (1 - k) * (1 - k));
    strength = Math.exp(-3 * k) * (1 - k);
  }
  const since = l - peak;
  const split = since < 0 ? 0 : since < hold ? 1 : since < swap ? -1 : 0;
  const flash = since < 0 ? 0 : Math.exp(-since / decay) * Math.cos((2 * Math.PI * since) / RING);
  return { travel, strength, split, flash };
}

/** Every part of `parts`, depth first, with its depth. */
export function* walk(parts: readonly Part[]): Generator<Part> {
  for (const part of parts) {
    yield part;
    if (part.children) yield* walk(part.children);
  }
}
