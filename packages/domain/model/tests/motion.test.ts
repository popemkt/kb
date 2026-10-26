/**
 * Motion options (DESIGN-UI.md → Motion options): each option is what
 * core's node sets, else what the shown theme's preset sets, else the
 * default, and says which; a theme's preset is the same fields on its
 * option node, so the seed writes it as props and the choice reads it back.
 */
import { describe, expect, test } from "bun:test";
import {
  MOTION_EFFECTS,
  MOTION_FIELD_IDS,
  SYSTEM_IDS,
  motionEffectFieldId,
  motionOptionId,
  motionPresetProps,
  systemSeedNodes,
  MOTION_DEFAULTS,
  motionChoice,
} from "../src/index.ts";

const ZZZ = motionPresetProps({
  intensity: "lively",
  style: "wobbly",
  effects: { press: true, pageWipe: false },
});

describe("motionChoice", () => {
  test("with nothing set: the defaults, each from the default", () => {
    const choice = motionChoice(undefined, undefined);
    expect(choice.settings).toEqual(MOTION_DEFAULTS);
    expect(choice.theme).toEqual(MOTION_DEFAULTS);
    expect(choice.sources.mode).toBe("default");
    for (const effect of MOTION_EFFECTS) expect(choice.sources.effects[effect]).toBe("default");
  });

  test("a theme's preset applies where core sets nothing, and says so", () => {
    const choice = motionChoice({}, ZZZ);
    expect(choice.settings.style).toBe("wobbly");
    expect(choice.settings.intensity).toBe("lively");
    expect(choice.settings.speed).toBe(MOTION_DEFAULTS.speed);
    expect(choice.settings.effects.press).toBe(true);
    expect(choice.settings.effects.pageWipe).toBe(false);
    expect(choice.sources.style).toBe("theme");
    expect(choice.sources.speed).toBe("default");
    expect(choice.sources.effects.press).toBe("theme");
    expect(choice.theme.style).toBe("wobbly");
  });

  test("core's setting beats the theme's, which stays the preset the sheet was drawn for", () => {
    const core = {
      [MOTION_FIELD_IDS.style]: [{ t: "ref" as const, v: motionOptionId("style", "clean") }],
      [MOTION_FIELD_IDS.mode]: [{ t: "ref" as const, v: motionOptionId("mode", "off") }],
      [motionEffectFieldId("press")]: [{ t: "bool" as const, v: false }],
    };
    const choice = motionChoice(core, ZZZ);
    expect(choice.settings.style).toBe("clean");
    expect(choice.settings.mode).toBe("off");
    expect(choice.settings.effects.press).toBe(false);
    expect(choice.sources.style).toBe("explicit");
    expect(choice.sources.effects.press).toBe("explicit");
    expect(choice.theme.style).toBe("wobbly");
  });

  test("an unknown option reads as unset", () => {
    const stale = { [MOTION_FIELD_IDS.speed]: [{ t: "ref" as const, v: "sys.motion-speed.warp" }] };
    expect(motionChoice(stale, undefined).sources.speed).toBe("default");
  });
});

describe("the seeded motion fields", () => {
  test("each option setting is a field of core whose children are its options, each effect a checkbox", () => {
    const nodes = new Map(systemSeedNodes().map((node) => [node.id, node]));
    for (const value of ["system", "full", "reduced", "off"] as const) {
      expect(nodes.get(MOTION_FIELD_IDS.mode)?.children).toContain(motionOptionId("mode", value));
    }
    for (const effect of MOTION_EFFECTS) {
      const field = nodes.get(motionEffectFieldId(effect));
      expect(field?.props[SYSTEM_IDS.configuresField]?.[0]?.v, effect).toBe("sys.extension.core");
    }
  });
});
