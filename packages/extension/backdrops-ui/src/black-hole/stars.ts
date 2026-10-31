/**
 * The stars behind a black hole, in the direction a ray leaves: layers of
 * one star per cell of a grid over the sky's angles, each star a hash's
 * place, colour (a blackbody, orange to blue-white) and brightness. A look
 * asks for its own layers (`StarLayer`) and reads them through the lens it
 * draws, so they bend with everything else behind the hole. No band: lensed,
 * a band draws a ring of its own.
 */
import {
  Fn,
  asin,
  atan,
  clamp,
  exp,
  float,
  length,
  max,
  mix,
  pow,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { blackbody, hash } from "../gpu/noise";

type V3 = TslNode<"vec3">;

/** The halo's knee, in cells: inside it the glow is flat, beyond it falls as one over the distance. */
const KNEE = 0.02;

/** One layer of stars. */
export interface StarLayer {
  /** Grid cells per radian, across the sky. */
  readonly cells: number;
  /** The share of cells with no star (0–1): the higher, the fewer. */
  readonly sparse: number;
  readonly gain: number;
  /** How tight the core is: its gaussian's exponent, in cells. */
  readonly sharpness: number;
  /** A star's glow round its core, falling as one over the distance and gone by the cell's edge; 0, none. */
  readonly halo?: number;
  /** Keys the layer's hash apart from the others'. */
  readonly salt: number;
}

/** The stars of `layers`, one function in the shader (`name`) a look calls with a direction. */
export function starsOf(name: string, layers: readonly StarLayer[]) {
  const fn = Fn(([d]: readonly [V3]) => {
    const sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1, 1))).toVar();
    let light: V3 = vec3(0, 0, 0);
    for (const layer of layers) {
      const g = sp.mul(layer.cells);
      const id = g.floor();
      const f = g.fract().sub(0.5);
      const h = hash(id.add(layer.salt));
      const shown = smoothstep(layer.sparse, layer.sparse + 0.002, h);
      const o = vec2(hash(id.add(4)), hash(id.add(4.5)))
        .sub(0.5)
        .mul(0.7);
      const dd = length(f.sub(o));
      const core = exp(dd.mul(dd).mul(-layer.sharpness));
      const halo =
        layer.halo !== undefined && layer.halo > 0
          ? core.add(
              pow(max(dd.mul(-2).add(1), 0), 2)
                .mul(float(KNEE).div(dd.add(KNEE)))
                .mul(layer.halo),
            )
          : core;
      light = light.add(
        blackbody(mix(3.5, 12, hash(id.add(2))))
          .mul(pow(hash(id.add(7)), 3).mul(layer.gain))
          .mul(halo)
          .mul(shown),
      );
    }
    return light;
  }).setLayout({ name, type: "vec3", inputs: [{ name: "d", type: "vec3" }] });
  return (d: V3): V3 => fn(d);
}
