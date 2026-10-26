/**
 * What the motion in force (`motionChoice`, DESIGN-UI.md → Motion options)
 * writes on `<html>`: the mode and the effects on as attributes the CSS
 * reads (`data-motion`, `data-fx`), the amplitudes of the micro-interactions,
 * and, where the person's choice departs from the theme's preset, the
 * timing the theme's sheet was drawn for, rescaled. Following the theme
 * changes none of its timing: a sheet already moves at its preset's speed
 * and on its preset's spring.
 */
import {
  MOTION_EFFECTS,
  type MotionIntensity,
  type MotionSpeed,
  type MotionChoice,
} from "@kb/model";

/** How much faster or slower each speed is than `normal`. */
const SPEED_FACTOR: Readonly<Record<MotionSpeed, number>> = {
  snappy: 0.8,
  normal: 1,
  relaxed: 1.25,
};

/** The amplitudes each intensity gives the micro-interactions. */
const INTENSITY: Readonly<
  Record<
    MotionIntensity,
    { readonly lift: number; readonly press: number; readonly overshoot: number }
  >
> = {
  subtle: { lift: 1, press: 0.985, overshoot: 0.06 },
  lively: { lift: 2, press: 0.965, overshoot: 0.14 },
  bold: { lift: 4, press: 0.94, overshoot: 0.26 },
};

/** The timing tokens a speed rescales. */
const SPEED_TOKENS = [
  "--motion-duration-quick",
  "--motion-duration-enter",
  "--motion-duration-reveal",
  "--motion-duration-theme",
  "--motion-duration-arrive",
  "--motion-duration-follow",
  "--motion-stagger",
] as const;

/**
 * A damped spring from rest to 1 that overshoots by `overshoot` (0.14 is
 * 14%), as a CSS `linear()` easing sampled at `points` steps. The damping
 * ratio follows from the overshoot; the stiffness makes it settle within 1%
 * by the end of the duration.
 */
export function springEasing(overshoot: number, points = 28): string {
  const ln = Math.log(Math.max(overshoot, 1e-4));
  const zeta = -ln / Math.sqrt(Math.PI ** 2 + ln ** 2);
  const omega = 4.6 / zeta;
  const damped = omega * Math.sqrt(1 - zeta ** 2);
  const at = (t: number) =>
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  const samples = Array.from({ length: points + 1 }, (_, i) =>
    i === points ? 1 : Math.round(at(i / points) * 1000) / 1000,
  );
  return `linear(${samples.join(", ")})`;
}

/** A CSS time in ms, or null. */
function ms(value: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (Number.isNaN(amount)) return null;
  return match[2] === "s" ? amount * 1000 : amount;
}

interface MotionPaint {
  readonly attributes: Readonly<Record<"data-motion" | "data-fx", string>>;
  /** Custom properties set on `<html>`; every one of `SPEED_TOKENS` and `--motion-spring` not here is the sheet's. */
  readonly properties: Readonly<Record<string, string>>;
}

/**
 * What `choice` writes, given the timing tokens as the theme's sheet sets
 * them (`base`, by token name: the computed values with nothing of this
 * written).
 */
export function motionPaint(choice: MotionChoice, base: (token: string) => string): MotionPaint {
  const { settings, theme } = choice;
  const off = settings.mode === "off";
  const amplitude = INTENSITY[settings.intensity];
  const properties: Record<string, string> = {
    "--motion-lift": `${amplitude.lift}px`,
    "--motion-press": `${amplitude.press}`,
  };
  const factor = SPEED_FACTOR[settings.speed] / SPEED_FACTOR[theme.speed];
  if (factor !== 1) {
    for (const token of SPEED_TOKENS) {
      const value = ms(base(token));
      if (value !== null) properties[token] = `${Math.round(value * factor)}ms`;
    }
  }
  if (settings.style !== theme.style || settings.intensity !== theme.intensity) {
    properties["--motion-spring"] =
      settings.style === "wobbly" ? springEasing(amplitude.overshoot) : "var(--motion-settle)";
  }
  return {
    attributes: {
      "data-motion": settings.mode,
      "data-fx": off ? "" : MOTION_EFFECTS.filter((effect) => settings.effects[effect]).join(" "),
    },
    properties,
  };
}
