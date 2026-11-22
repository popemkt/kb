import { type Box3, Plane, Raycaster, Vector2, Vector3, type Camera } from "three/webgpu";
import type { Reactions } from "../scene/reactions";

/** Project the shared header pointer through the same camera that drew it.
 * A held call latches until the gesture leaves; a wake stays where it was made. */
export function quayInput(cabinet: Box3, splash: (x: number, z: number, t: number) => void) {
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const canal = new Plane(new Vector3(0, 1, 0), 0.055);
  const previous = new Vector2(Infinity, Infinity);
  let dwell = 0,
    latched = false,
    lastDrop = -Infinity;
  return (
    pointer: Reactions["pointer"],
    camera: Camera,
    viewport: Vector2,
    t: number,
    dt: number,
  ) => {
    if (dt <= 0 || pointer.near < 0.4) {
      dwell = 0;
      latched = false;
      previous.set(Infinity, Infinity);
      return false;
    }
    ndc.set((2 * pointer.x) / viewport.x - 1, 1 - (2 * pointer.y) / viewport.y);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectsBox(cabinet)) {
      dwell += dt;
      if (dwell >= 0.62 && !latched) {
        latched = true;
        return true;
      }
      return false;
    }
    dwell = 0;
    latched = false;
    if (
      ray.ray.intersectPlane(canal, hit) &&
      hit.z > -7 &&
      hit.z < 4 &&
      t - lastDrop > 0.19 &&
      Math.hypot(hit.x - previous.x, hit.z - previous.y) > 0.12
    ) {
      splash(hit.x, hit.z, t);
      previous.set(hit.x, hit.z);
      lastDrop = t;
    }
    return false;
  };
}
