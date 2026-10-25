/**
 * A dark page's grade for a painted scene: the filmic contrast its look was
 * drawn under. The stage's shoulder is the identity below its knee, so the
 * frame's ground meets the page to the level; a scene composed under ACES
 * (deep darks, lifted mids, richer colour) looks flat and grey through it.
 * This bends the scene by ACES where it stands above the ground and leaves
 * the ground itself (and the frame's fade into it) exactly as it was. Light
 * above white is kept, for the bloom.
 */
import { clamp, dot, max, min, mix, smoothstep, vec3 } from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";

type V3 = TslNode<"vec3">;

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** ACES (Narkowicz's fit) on a linear colour. */
function aces(x: V3): V3 {
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1);
}

/** `shown` (linear, over a dark page) graded as by ACES above `ground`, the ground untouched. */
export function darkGrade(shown: V3, ground: V3): V3 {
  const floor = dot(ground, LUMA);
  const above = smoothstep(floor.mul(1.2), floor.mul(1.2).add(0.05), dot(shown, LUMA));
  const graded = aces(min(shown, vec3(1, 1, 1))).add(max(shown.sub(1), vec3(0, 0, 0)));
  return mix(shown, graded, above);
}
