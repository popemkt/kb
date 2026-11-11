import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { createUnicornScene, followPointer } from "./unicorn-scene";

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

describe("a Unicorn scene's start", () => {
  let installed: InstalledDom;
  let frames: FrameRequestCallback[] = [];
  const nextFrame = async () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
    await Promise.resolve();
  };
  /** The runtime's own scene: `addScene` resolves it while its planes are still being made. */
  const scene = {
    initializing: true,
    paused: false,
    interactivity: { mouse: { disabled: true } },
    destroy: () => {},
  };
  beforeEach(() => {
    installed = installDomGlobals();
    frames = [];
    scene.initializing = true;
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
    });
    Object.assign(window, { UnicornStudio: { addScene: () => Promise.resolve(scene) } });
  });
  afterEach(() => {
    delete (window as { UnicornStudio?: unknown }).UnicornStudio;
    installed.restore();
  });

  test("is handed over only once the runtime has started it, so it can be destroyed at once", async () => {
    let handed: unknown = null;
    void createUnicornScene(document.createElement("div"), new AbortController().signal).then(
      (ready) => {
        handed = ready;
      },
    );
    await nextFrame();
    await nextFrame();
    expect(handed, "still starting").toBeNull();
    scene.initializing = false;
    await nextFrame();
    expect(handed).toBe(scene);
  });

  test("is not started when its backdrop goes before the runtime has loaded", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createUnicornScene(document.createElement("div"), controller.signal),
    ).rejects.toThrow();
  });
});
