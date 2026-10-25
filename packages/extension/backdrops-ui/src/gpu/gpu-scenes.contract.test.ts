/**
 * The scene contract (`sceneContract`, `@kb/ui-test-kit`) over the GPU
 * backdrops' scenes, Lens and Black hole, each on a dark page and a light
 * one: both draw an offscreen pass every frame (the nebula, the hole), so
 * the stand-in renderer counts those too, and a hidden scene must still
 * draw nothing.
 */
import { vi } from "vitest";
import type { ScenePalette } from "@kb/scene";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { sceneContract } from "@kb/ui-test-kit";
import type * as ThreeWebGpu from "three/webgpu";
import type { GpuBackdropInit, GpuBackdropMount } from "./gpu-scene";

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
}));

const DARK: ScenePalette = {
  ground: "rgb(10, 10, 12)",
  edge: "rgb(10, 10, 12)",
  hue: "rgb(90, 80, 160)",
  ink: "rgb(230, 230, 240)",
  accent: "rgb(210, 140, 40)",
};
const LIGHT: ScenePalette = { ...DARK, ground: "rgb(250, 250, 250)", edge: "rgb(250, 250, 250)" };

const init = (dark: boolean, reducedMotion: boolean): GpuBackdropInit => ({
  palette: dark ? DARK : LIGHT,
  dark,
  presence: 1,
  direction: "down",
  reducedMotion,
  timing: TIMING_FALLBACK,
  seed: 7,
  pointer: { now: () => null },
});

const mounts: Record<string, () => Promise<GpuBackdropMount>> = {
  lens: () => import("../lens/lens-scene").then((m) => m.mountLens),
  "black hole": () => import("../black-hole/black-hole-scene").then((m) => m.mountBlackHole),
};

sceneContract(
  Object.entries(mounts).flatMap(([name, load]) =>
    [true, false].map(
      (dark) =>
        [
          `${name} (${dark ? "dark" : "light"})`,
          async (host: HTMLElement, reduced: boolean) => (await load())(host, init(dark, reduced)),
        ] as const,
    ),
  ),
);
