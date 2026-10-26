/**
 * Motion options (DESIGN-UI.md → Motion options): how much the page moves,
 * as settings of core's node and as the preset a design system carries on
 * its option node. Every option defaults to the shown theme's value: the
 * value in force is the one core's node holds, else the theme's, else the
 * default, and each says which of the three it came from.
 *
 * The option names, their values and the effect ids are one contract with
 * bb-lively's (popemkt/mac-backup, `assets/bb-plugins/bb-lively`), so a
 * person's motion reads the same in both; each product implements it.
 */
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";

export const MOTION_MODES = ["system", "full", "reduced", "off"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];
export const MOTION_INTENSITIES = ["subtle", "lively", "bold"] as const;
export type MotionIntensity = (typeof MOTION_INTENSITIES)[number];
export const MOTION_STYLES = ["clean", "wobbly"] as const;
export type MotionStyle = (typeof MOTION_STYLES)[number];
export const MOTION_SPEEDS = ["snappy", "normal", "relaxed"] as const;
export type MotionSpeed = (typeof MOTION_SPEEDS)[number];

/**
 * The micro-interactions, each switched on or off: a press, a hover lift,
 * rows arriving, a focus glow, a toast's spring, menus and dialogs opening,
 * a toggle flipping, a page's content arriving, a theme's page-change and
 * write gestures, and the glow while the page is working.
 */
export const MOTION_EFFECTS = [
  "press",
  "hoverLift",
  "listEnter",
  "focusRing",
  "toastSpring",
  "overlayEnter",
  "toggles",
  "pageEnter",
  "pageWipe",
  "workingGlow",
] as const;
export type MotionEffect = (typeof MOTION_EFFECTS)[number];

/** The four option settings: each a field of core's node whose options are its children. */
export const MOTION_OPTION_SETTINGS = ["mode", "intensity", "style", "speed"] as const;
export type MotionOptionSetting = (typeof MOTION_OPTION_SETTINGS)[number];

export interface MotionSettings {
  readonly mode: MotionMode;
  readonly intensity: MotionIntensity;
  readonly style: MotionStyle;
  readonly speed: MotionSpeed;
  readonly effects: Readonly<Record<MotionEffect, boolean>>;
}

/** The field of core's node each option setting is. */
export const MOTION_FIELD_IDS: Readonly<Record<MotionOptionSetting, NodeId>> = {
  mode: SYSTEM_IDS.motionModeField,
  intensity: SYSTEM_IDS.motionIntensityField,
  style: SYSTEM_IDS.motionStyleField,
  speed: SYSTEM_IDS.motionSpeedField,
};

/** The option node naming `value` of `setting`: a child of its field. */
export function motionOptionId<S extends MotionOptionSetting>(
  setting: S,
  value: MotionSettings[S],
): NodeId {
  return `sys.motion-${setting}.${value}`;
}

/** The checkbox field of core's node that switches `effect`. */
export function motionEffectFieldId(effect: MotionEffect): NodeId {
  return `sys.f.motion.fx.${effect}`;
}

/** A theme's motion preset: any of the options, the rest left to the defaults. */
export interface MotionPreset {
  readonly mode?: MotionMode;
  readonly intensity?: MotionIntensity;
  readonly style?: MotionStyle;
  readonly speed?: MotionSpeed;
  readonly effects?: Partial<Record<MotionEffect, boolean>>;
}

/** The props a theme's option node carries for `preset`: the same fields as core's settings. */
export function motionPresetProps(preset: MotionPreset): KbNode["props"] {
  const props: Record<NodeId, KbNode["props"][string]> = {};
  const put = <S extends MotionOptionSetting>(setting: S, value: MotionSettings[S] | undefined) => {
    if (value !== undefined) {
      props[MOTION_FIELD_IDS[setting]] = [{ t: "ref", v: motionOptionId(setting, value) }];
    }
  };
  put("mode", preset.mode);
  put("intensity", preset.intensity);
  put("style", preset.style);
  put("speed", preset.speed);
  for (const effect of MOTION_EFFECTS) {
    const on = preset.effects?.[effect];
    if (on !== undefined) props[motionEffectFieldId(effect)] = [{ t: "bool", v: on }];
  }
  return props;
}
