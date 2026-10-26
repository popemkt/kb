/**
 * The motion options as the page paints them (DESIGN-UI.md → Motion
 * options). Following the shown theme leaves its sheet's timing alone (it
 * already moves at its preset's speed, on its preset's spring); a person's
 * choice that departs from the preset rescales the timing by the ratio of
 * the two speeds and swaps the spring; `off` turns every effect off; and
 * every whole theme carries a preset, as data on its option node, which is
 * what the page moves by while core's node sets nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  designSystemOptionId,
  extensionNodeId,
  foldSeed,
  MOTION_FIELD_IDS,
  motionEffectFieldId,
  motionOptionId,
  type KbNode,
  motionChoice,
} from "@kb/model";
import { DesignSystemPoint, currentContributions } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { designSystemsUiPlugin } from "@/design-systems";
import { motionPaint, springEasing } from "@/lib/motion-paint";
import { useDesignSystemStore } from "@/stores/design-system.store";
import { useGraphStore } from "@/stores/graph.store";
import { startMotion } from "@/stores/motion.store";
import { PAGE_FAMILIES } from "@/test-support/design-systems";
import { syncPagePlugins } from "@/test-support/page-plugins";

const SEED = foldSeed(BUNDLED_DECLARATIONS, "2026-01-01T00:00:00.000Z").nodes;
const CORE = extensionNodeId("core");
const presetOf = (system: string) =>
  SEED.find((node) => node.id === designSystemOptionId(system))?.props;

/** The timing a sheet sets, as `motionPaint` reads it. */
const SHEET: Record<string, string> = {
  "--motion-duration-quick": "140ms",
  "--motion-duration-reveal": "0.2s",
};
const base = (token: string) => SHEET[token] ?? "";

const ref = (value: string) => [{ t: "ref" as const, v: value }];

describe("motionPaint", () => {
  it("following the theme changes none of its sheet's timing", () => {
    const { properties, attributes } = motionPaint(motionChoice({}, presetOf("themes.zzz")), base);
    expect(Object.keys(properties).toSorted()).toEqual(["--motion-lift", "--motion-press"]);
    expect(attributes["data-fx"].split(" ")).toContain("press");
  });

  it("a speed of the person's own rescales by the ratio to the theme's, and a style swaps the spring", () => {
    const core: KbNode["props"] = {
      [MOTION_FIELD_IDS.speed]: ref(motionOptionId("speed", "relaxed")),
      [MOTION_FIELD_IDS.style]: ref(motionOptionId("style", "clean")),
    };
    const { properties } = motionPaint(motionChoice(core, presetOf("themes.zzz")), base);
    // ZZZ is snappy (0.8): relaxed (1.25) is 1.5625 times its timing.
    expect(properties["--motion-duration-quick"]).toBe("219ms");
    expect(properties["--motion-duration-reveal"]).toBe("313ms");
    expect(properties["--motion-spring"]).toBe("var(--motion-settle)");
  });

  it("wobbly is a spring that overshoots and lands on 1", () => {
    const samples = /^linear\((.*)\)$/.exec(springEasing(0.14))?.[1]?.split(",").map(Number);
    expect(samples?.[0]).toBe(0);
    expect(samples?.at(-1)).toBe(1);
    expect(Math.max(...(samples ?? []))).toBeGreaterThan(1.1);
  });

  it("off turns every effect off and says so", () => {
    const core = { [MOTION_FIELD_IDS.mode]: ref(motionOptionId("mode", "off")) };
    const { attributes } = motionPaint(motionChoice(core, presetOf("themes.zzz")), base);
    expect(attributes).toEqual({ "data-motion": "off", "data-fx": "" });
  });
});

describe("every whole theme moves by a preset of its own", () => {
  let installed: InstalledDom | undefined;
  beforeAll(() => {
    installed = installDomGlobals();
    syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES]);
  });
  afterAll(() => installed?.restore());

  it("holds it as data on its option node", () => {
    const themes = currentContributions(DesignSystemPoint)
      .map(({ value }) => value)
      .filter(({ Art }) => Art !== undefined);
    expect(themes.length).toBeGreaterThan(2);
    for (const { key } of themes) {
      const { sources } = motionChoice({}, presetOf(key.id));
      expect(sources.style, key.id).toBe("theme");
      expect(sources.speed, key.id).toBe("theme");
    }
  });

  it("the painter paints it on <html>, and core's setting over it", () => {
    useGraphStore.getState().hydrateFromWire(SEED, 1, "fixtures");
    useDesignSystemStore.setState({ painted: "themes.zzz" });
    const stop = startMotion();
    const root = document.documentElement;
    expect(root.getAttribute("data-motion")).toBe("system");
    expect(root.getAttribute("data-fx")?.split(" ")).toContain("hoverLift");
    useGraphStore.getState().hydrateFromWire(
      SEED.map((node) =>
        node.id === CORE
          ? {
              ...node,
              props: {
                ...node.props,
                [motionEffectFieldId("hoverLift")]: [{ t: "bool" as const, v: false }],
              },
            }
          : node,
      ),
      2,
      "fixtures",
    );
    expect(root.getAttribute("data-fx")?.split(" ")).not.toContain("hoverLift");
    stop();
  });
});
