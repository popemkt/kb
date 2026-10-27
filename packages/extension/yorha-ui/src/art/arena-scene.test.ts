import { describe, expect, it } from "vitest";
import {
  PerspectiveCamera,
  Scene,
  type BufferGeometry,
  type EventDispatcher,
  type Material,
  type Object3D,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { colorUniform, disposeGraph } from "@kb/scene-gpu";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { buildArena, type ArenaInit } from "./arena-scene";

interface Drawable {
  readonly geometry?: BufferGeometry;
  readonly material?: Material | Material[];
}

function stage() {
  return {
    scene: new Scene(),
    camera: new PerspectiveCamera(32, 6, 0.1, 200),
    colors: {
      ground: colorUniform(),
      edge: colorUniform(),
      hue: colorUniform(),
      ink: colorUniform(),
      accent: colorUniform(),
    },
    atmosphere: (near: number, far: number) => ({
      near: uniform(near),
      far: uniform(far),
      amount: uniform(1),
    }),
  };
}

const INIT: ArenaInit = {
  palette: { ground: "#ddd", edge: "#aaa", hue: "#c60", ink: "#333", accent: "#333" },
  dark: false,
  colors: { purple: "#93e", ship: "#fff", shipShare: 1, head: "#333" },
  timing: TIMING_FALLBACK,
  reducedMotion: false,
  pointer: { now: () => ({ x: 300, y: 90 }) },
  seed: 7,
};

/** Every geometry and material the scene holds, and which of them have been disposed. */
function resources(root: Object3D) {
  const live = new Set<EventDispatcher<{ dispose: object }>>();
  root.traverse((object: Object3D & Drawable) => {
    const held = [
      object.geometry,
      ...(Array.isArray(object.material) ? object.material : [object.material]),
    ];
    for (const one of held) {
      if (one === undefined || live.has(one)) continue;
      live.add(one);
      one.addEventListener("dispose", () => live.delete(one));
    }
  });
  return live;
}

describe("the Arena's scene", () => {
  it("plays frames with the pointer over it, the camera and every model at a finite place", () => {
    const on = stage();
    const arena = buildArena(on, INIT);
    arena.layout({ width: 600, height: 180, quality: 1 });
    arena.write();
    for (let i = 0; i < 90; i++) arena.frame(1 / 30, { calm: 0, pointer: { x: 300, y: 90 } });
    for (const object of [on.camera, ...on.scene.children]) {
      for (const value of object.position.toArray()) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("takes 30 keystrokes and an edit as nudges: its clock never goes back, nothing is rebuilt", () => {
    const on = stage();
    const arena = buildArena(on, INIT);
    const children = [...on.scene.children];
    let last = arena.clock();
    for (let key = 0; key < 31; key++) {
      const typing = key < 30;
      arena.write();
      arena.frame(1 / 30, { calm: typing ? 1 : 0, pointer: null });
      expect(arena.clock()).toBeGreaterThan(last);
      last = arena.clock();
    }
    expect(on.scene.children).toEqual(children);
  });

  it("puts everything it draws in the stage's scene, so the stage's disposal frees it all", () => {
    const on = stage();
    const arena = buildArena(on, INIT);
    arena.frame(1 / 30, { calm: 0, pointer: null });
    const live = resources(on.scene);
    expect(live.size).toBeGreaterThan(10);
    disposeGraph(on.scene);
    expect(live.size).toBe(0);
    expect(on.scene.children).toHaveLength(0);
  });
});
