import { describe, expect, test } from "vitest";
import { followPointer } from "./unicorn-scene";

describe("the Unicorn scene's cursor", () => {
  test("follows only while the page's pointer source has the pointer over its frame", () => {
    const scene = { interactivity: { mouse: { disabled: false } } };
    let at: { x: number; y: number } | null = null;
    const pointer = { now: () => at };
    followPointer(scene, pointer);
    expect(scene.interactivity.mouse.disabled).toBe(true);
    at = { x: 40, y: 20 };
    followPointer(scene, pointer);
    expect(scene.interactivity.mouse.disabled).toBe(false);
  });
});
