/**
 * The motion in force (DESIGN-UI.md → Motion options): core's settings over
 * the shown theme's preset over the defaults, each with its source. Apart
 * from `motion.ts`, which the seed needs, so the page loads it with the
 * painter that reads it, not up front.
 */
import type { KbNode } from "./model.ts";
import {
  MOTION_FIELD_IDS,
  MOTION_INTENSITIES,
  MOTION_MODES,
  MOTION_SPEEDS,
  MOTION_STYLES,
  motionEffectFieldId,
  motionOptionId,
  type MotionEffect,
  type MotionOptionSetting,
  type MotionSettings,
} from "./motion.ts";
import { firstBool, firstRef } from "./node-config.ts";

/** Where an option's value in force came from. */
export type MotionSource = "explicit" | "theme" | "default";

export interface MotionChoice {
  readonly settings: MotionSettings;
  /** What the shown theme's preset says, defaults filled: the settings its sheet was drawn for. */
  readonly theme: MotionSettings;
  readonly sources: Readonly<Record<MotionOptionSetting, MotionSource>> & {
    readonly effects: Readonly<Record<MotionEffect, MotionSource>>;
  };
}

/**
 * The defaults: kb as it moved before there were options. The page's
 * existing gestures (toasts, menus, a page's arrival, a theme's wipes) on,
 * the newer micro-interactions off until a theme or the person turns them on.
 */
export const MOTION_DEFAULTS: MotionSettings = {
  mode: "system",
  intensity: "subtle",
  style: "clean",
  speed: "normal",
  effects: {
    press: false,
    hoverLift: false,
    listEnter: false,
    focusRing: false,
    toastSpring: true,
    overlayEnter: true,
    toggles: false,
    pageEnter: true,
    pageWipe: true,
    workingGlow: false,
  },
};

const VALUES: {
  readonly [S in MotionOptionSetting]: readonly MotionSettings[S][];
} = {
  mode: MOTION_MODES,
  intensity: MOTION_INTENSITIES,
  style: MOTION_STYLES,
  speed: MOTION_SPEEDS,
};

type Props = KbNode["props"];

function optionIn<S extends MotionOptionSetting>(
  setting: S,
  props: Props | undefined,
): MotionSettings[S] | undefined {
  const ref = props === undefined ? undefined : firstRef(MOTION_FIELD_IDS[setting])(props);
  return VALUES[setting].find((value) => motionOptionId(setting, value) === ref);
}

function effectIn(effect: MotionEffect, props: Props | undefined): boolean | undefined {
  return props === undefined ? undefined : firstBool(motionEffectFieldId(effect))(props);
}

function sourceOf(own: unknown, preset: unknown): MotionSource {
  if (own !== undefined) return "explicit";
  return preset === undefined ? "default" : "theme";
}

/** A record over the effects, each from `of`. */
function byEffect<T>(of: (effect: MotionEffect) => T): Record<MotionEffect, T> {
  return {
    press: of("press"),
    hoverLift: of("hoverLift"),
    listEnter: of("listEnter"),
    focusRing: of("focusRing"),
    toastSpring: of("toastSpring"),
    overlayEnter: of("overlayEnter"),
    toggles: of("toggles"),
    pageEnter: of("pageEnter"),
    pageWipe: of("pageWipe"),
    workingGlow: of("workingGlow"),
  };
}

/**
 * The motion in force: each option as `explicit` (core's node) holds it,
 * else as `theme` (the shown theme's option node, its preset) does, else the
 * default, with where each came from.
 */
export function motionChoice(explicit: Props | undefined, theme: Props | undefined): MotionChoice {
  const pick = <S extends MotionOptionSetting>(setting: S) => {
    const own = optionIn(setting, explicit);
    const preset = optionIn(setting, theme);
    return {
      value: own ?? preset ?? MOTION_DEFAULTS[setting],
      preset: preset ?? MOTION_DEFAULTS[setting],
      source: sourceOf(own, preset),
    };
  };
  const mode = pick("mode");
  const intensity = pick("intensity");
  const style = pick("style");
  const speed = pick("speed");
  const own = byEffect((effect) => effectIn(effect, explicit));
  const preset = byEffect((effect) => effectIn(effect, theme));
  return {
    settings: {
      mode: mode.value,
      intensity: intensity.value,
      style: style.value,
      speed: speed.value,
      effects: byEffect(
        (effect) => own[effect] ?? preset[effect] ?? MOTION_DEFAULTS.effects[effect],
      ),
    },
    theme: {
      mode: mode.preset,
      intensity: intensity.preset,
      style: style.preset,
      speed: speed.preset,
      effects: byEffect((effect) => preset[effect] ?? MOTION_DEFAULTS.effects[effect]),
    },
    sources: {
      mode: mode.source,
      intensity: intensity.source,
      style: style.source,
      speed: speed.source,
      effects: byEffect((effect) => sourceOf(own[effect], preset[effect])),
    },
  };
}
