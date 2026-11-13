import { describe, expect, test } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  canPan,
  fitScale,
  placeScene,
  scaleOf,
  sceneSize,
  zoomAboutCentre,
  zoomIn,
  zoomOut,
} from "./framing.ts";

const viewport = { width: 1000, height: 600 };
const presentation = { height: 240 };

describe("the studio's framing", () => {
  test("a page head's strip is the page's width at the head's height; the full page is the viewport; an aspect keeps its proportions across the width", () => {
    expect(sceneSize({ kind: "head" }, viewport, presentation)).toEqual({
      width: 1000,
      height: 240,
    });
    expect(sceneSize({ kind: "page" }, viewport, presentation)).toEqual(viewport);
    expect(sceneSize({ kind: "aspect", aspect: "16:9" }, viewport, presentation)).toEqual({
      width: 1000,
      height: 563,
    });
    expect(sceneSize({ kind: "aspect", aspect: "9:16" }, viewport, presentation)).toEqual({
      width: 1000,
      height: 1778,
    });
  });

  test("fit shows the whole scene, within the zoom's bounds; 1:1 is its own pixels", () => {
    expect(fitScale({ width: 1000, height: 1778 }, viewport)).toBeCloseTo(600 / 1778);
    expect(fitScale({ width: 1000, height: 240 }, viewport)).toBe(1);
    expect(fitScale({ width: 10, height: 10 }, viewport)).toBe(MAX_ZOOM);
    // Below the smallest step a person zooms to, when that is what the whole scene takes.
    expect(fitScale({ width: 1000, height: 1778 }, { width: 1000, height: 150 })).toBeCloseTo(
      150 / 1778,
    );
    expect(fitScale({ width: 100_000, height: 10 }, viewport)).toBe(0.01);
    expect(fitScale({ width: 0, height: 0 }, viewport)).toBe(1);
    expect(scaleOf("fit", viewport, viewport)).toBe(1);
    expect(scaleOf(1, { width: 1000, height: 1778 }, viewport)).toBe(1);
  });

  test("zooming steps to the next stop either way, from any scale, and stops at the bounds", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(0.34)).toBe(0.5);
    expect(zoomOut(0.34)).toBe(0.33);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    // From a fit below every step, out goes nowhere and in goes to the first step.
    expect(zoomOut(0.05)).toBe(0.05);
    expect(zoomIn(0.05)).toBe(MIN_ZOOM);
  });

  test("a short viewport still fits the whole of a tall scene", () => {
    const scene = sceneSize(
      { kind: "aspect", aspect: "9:16" },
      { width: 1000, height: 150 },
      presentation,
    );
    const scale = scaleOf("fit", scene, { width: 1000, height: 150 });
    expect(scene.height * scale).toBeLessThanOrEqual(150 + 1e-6);
    expect(
      canPan(
        { width: scene.width * scale, height: scene.height * scale },
        { width: 1000, height: 150 },
      ),
    ).toBe(false);
  });

  test("a scene that fits is centred whatever the pan; one larger than the viewport is held so no edge comes inside", () => {
    expect(placeScene({ x: -50, y: 40 }, { width: 500, height: 300 }, viewport)).toEqual({
      x: 250,
      y: 150,
    });
    const big = { width: 2000, height: 1200 };
    expect(placeScene(null, big, viewport)).toEqual({ x: -500, y: -300 });
    expect(placeScene({ x: 100, y: -5000 }, big, viewport)).toEqual({ x: 0, y: -600 });
    expect(canPan(big, viewport)).toBe(true);
    expect(canPan({ width: 1000, height: 600 }, viewport)).toBe(false);
  });

  test("zooming keeps the point under the viewport's centre where it was", () => {
    const at = { x: -200, y: -100 };
    const next = zoomAboutCentre(at, 1, 2, viewport);
    // The scene point under the centre, before and after.
    expect((500 - at.x) / 1).toBeCloseTo((500 - next.x) / 2);
    expect((300 - at.y) / 1).toBeCloseTo((300 - next.y) / 2);
  });
});
