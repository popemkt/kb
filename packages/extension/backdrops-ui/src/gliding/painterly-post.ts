/**
 * Unified full-scene painterly gouache & cold-press watercolor paper post-pass
 * for Gliding (`gliding-scene.ts`). Runs over the composited scene (ocean,
 * wave-warped shadows, seagulls, and `WB-027` together) so every element shares
 * one cohesive moving-painting medium instead of separately shaded CGI layers:
 *
 * 1. **Directional Gouache Kuwahara (`brush`)**: smooth inverse-variance 4-lobe
 *    filter aligned with the ocean's ~32° flat-brush axis + gentle bristle UV
 *    tremor, wet-edge pigment pooling, and subtle gouache value grouping.
 * 2. **Unified Cold-Press Paper Medium (`paper`)**: stationary two-scale
 *    cold-press dimples + cellulose cotton-rag weave + raking sunlight emboss +
 *    valley pigment granulation shared across water, shadows, birds, and plane.
 */
import {
  Fn,
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { hash } from "../gpu/noise";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** Primary gouache flat-brush stroke axis (~32° SW-to-NE diagonal) and perpendicular. */
const BRUSH_X = 0.848;
const BRUSH_Y = 0.53;

const paperNoiseFn = Fn(([p]: readonly [V2]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash(i);
  const b = hash(i.add(vec2(1, 0)));
  const c = hash(i.add(vec2(0, 1)));
  const d = hash(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: "kbGlidePaperNoise", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const pNoise = (p: V2): F => paperNoiseFn(p);

export function createPainterlyUniforms() {
  return {
    /** Full-scene painterly brushwork / Kuwahara strength [0, 2]. */
    brush: uniform(1),
    /** Unified cold-press watercolor paper tooth & pigment granulation [0, 2]. */
    paper: uniform(1),
    /** 1 on dark page, 0 on light page. */
    dark: uniform(1),
    /** Sun warmth tint [-1, 1]. */
    sunWarmth: uniform(0),
    /** Viewport aspect ratio (width / height) for isotropic paper & brush scale. */
    aspect: uniform(1.78),
    /** One CSS pixel in UV space `(1 / width, 1 / height)`. */
    texel: uniform(new Vector2(1 / 1280, 1 / 720)),
  };
}

export type PainterlyUniforms = ReturnType<typeof createPainterlyUniforms>;

interface PaperField {
  readonly height: F;
  readonly relief: F;
  readonly coarse: F;
  readonly fine: F;
}

/** Evaluate stationary cold-press watercolor paper tooth, woven fibers & raking light relief. */
function samplePaperField(p: V2): PaperField {
  const coarse = pNoise(p.mul(130)).toVar();
  const medium = pNoise(p.mul(285).add(vec2(13.7, 8.3))).toVar();
  const fiberH = pNoise(vec2(p.x.mul(510), p.y.mul(165)).add(vec2(3.1, 7.4)));
  const fiberV = pNoise(vec2(p.x.mul(165), p.y.mul(510)).add(vec2(11.3, 2.9)));
  const fine = fiberH.mul(0.5).add(fiberV.mul(0.5)).toVar();
  const height = coarse.mul(0.44).add(medium.mul(0.34)).add(fine.mul(0.22)).toVar();

  // Raking sunlight along upper-right key direction (0.76, 0.36) embosses paper dimples.
  const sunShift = vec2(0.0024, 0.0014);
  const coarseSun = pNoise(p.add(sunShift).mul(130));
  const medSun = pNoise(p.add(sunShift.mul(0.55)).mul(285).add(vec2(13.7, 8.3)));
  const relief = height.sub(coarseSun.mul(0.58).add(medSun.mul(0.42)));
  return { height, relief, coarse, fine };
}

interface LobeResult {
  readonly mean: V3;
  readonly weight: F;
}

function evalBrushLobe(
  sampleScene: (uv: V2) => V3,
  center: V3,
  originUv: V2,
  stepPrimary: V2,
  stepSecondary: V2,
): LobeResult {
  const s1 = sampleScene(clamp(originUv.add(stepPrimary), vec2(0.001, 0.001), vec2(0.999, 0.999)));
  const s2 = sampleScene(
    clamp(originUv.add(stepSecondary), vec2(0.001, 0.001), vec2(0.999, 0.999)),
  );
  const mean = center.add(s1).add(s2).div(3.0);
  const lumW = vec3(0.299, 0.587, 0.114);
  const variance = dot(abs(s1.sub(center)).add(abs(s2.sub(center))), lumW);
  // Smooth inverse-variance weight preserves painted edges without temporal shimmering.
  const weight = float(1).div(float(0.0065).add(variance.mul(variance).mul(92.0)));
  return { mean, weight };
}

/**
 * Build the `StageOptions.finish` callback that unifies the entire Gliding frame
 * into one hand-painted gouache & cold-press watercolor moving painting.
 */
export function painterlyFinish(u: PainterlyUniforms): (sampleScene: (uv: V2) => V3) => V3 {
  return (sampleScene) =>
    Fn(() => {
      const baseUv = screenUV;
      const p = vec2(baseUv.x.sub(0.5).mul(u.aspect), float(0.5).sub(baseUv.y)).toVar();
      const brushAmt = clamp(u.brush, 0, 2).toVar();
      const paperAmt = clamp(u.paper, 0, 2).toVar();
      const paper = samplePaperField(p);

      // Subtle bristle-aligned UV tremor turns crisp digital straight lines into hand-brushed edges.
      const wobA = pNoise(p.mul(46).add(vec2(1.7, 3.3))).sub(0.5);
      const wobB = pNoise(p.mul(112).add(vec2(9.2, 4.8))).sub(0.5);
      const bDir = vec2(BRUSH_X, BRUSH_Y);
      const pDir = vec2(-BRUSH_Y, BRUSH_X);
      const wobbleOffset = bDir
        .mul(wobA.mul(1.05))
        .add(pDir.mul(wobB.mul(0.75)))
        .mul(u.texel)
        .mul(brushAmt.mul(0.85));
      const sampleUv = clamp(
        baseUv.add(wobbleOffset),
        vec2(0.001, 0.001),
        vec2(0.999, 0.999),
      ).toVar();

      const raw = sampleScene(baseUv).toVar();
      const center = sampleScene(sampleUv).toVar();
      const radius = brushAmt.mul(1.55);
      const stepB = bDir.mul(u.texel).mul(radius);
      const stepP = pDir.mul(u.texel).mul(radius.mul(0.74));

      // 4 directional brush lobes (9 total taps): smooths shaded regions along 32° strokes while keeping crisp edges.
      const lobeA = evalBrushLobe(
        sampleScene,
        center,
        sampleUv,
        stepB,
        stepB.mul(1.85).add(stepP.mul(0.32)),
      );
      const lobeB = evalBrushLobe(
        sampleScene,
        center,
        sampleUv,
        stepB.negate(),
        stepB.mul(-1.85).sub(stepP.mul(0.32)),
      );
      const lobeC = evalBrushLobe(
        sampleScene,
        center,
        sampleUv,
        stepP,
        stepP.mul(1.65).sub(stepB.mul(0.32)),
      );
      const lobeD = evalBrushLobe(
        sampleScene,
        center,
        sampleUv,
        stepP.negate(),
        stepP.mul(-1.65).add(stepB.mul(0.32)),
      );

      const weightSum = lobeA.weight.add(lobeB.weight).add(lobeC.weight).add(lobeD.weight);
      const kuwahara = lobeA.mean
        .mul(lobeA.weight)
        .add(lobeB.mean.mul(lobeB.weight))
        .add(lobeC.mean.mul(lobeC.weight))
        .add(lobeD.mean.mul(lobeD.weight))
        .div(weightSum);

      // Gentle watercolor wet-edge pigment pooling along medium painted transitions (avoids outlining white HUD).
      const edgeGrad = length(lobeA.mean.sub(lobeB.mean)).add(length(lobeC.mean.sub(lobeD.mean)));
      const lum = dot(kuwahara, vec3(0.299, 0.587, 0.114));
      const hudProtect = float(1).sub(
        smoothstep(0.74, 0.9, lum).mul(smoothstep(0.28, 0.6, edgeGrad)),
      );
      const wetEdge = smoothstep(0.06, 0.34, edgeGrad)
        .mul(float(1).sub(smoothstep(0.42, 0.85, edgeGrad)))
        .mul(hudProtect)
        .mul(clamp(brushAmt, 0, 1.5))
        .mul(0.11);

      // Subtle gouache tonal grouping unifies 3D aircraft shading with the painted sea.
      const toneRipple = sin(clamp(lum, 0, 1).mul(Math.PI * 2 * 7.5))
        .mul(0.015)
        .mul(clamp(brushAmt, 0, 1.5))
        .mul(hudProtect);
      const brushCol = clamp(
        kuwahara.mul(float(1).sub(wetEdge)).sub(vec3(toneRipple, toneRipple, toneRipple)),
        vec3(0, 0, 0),
        vec3(1, 1, 1),
      );
      // Preserve ultra-crisp high-contrast HUD lines while fully painting ocean, shadows, birds & WB-027.
      const brushBlend = clamp(brushAmt, 0, 1).mul(mix(float(0.25), float(1), hudProtect));
      const painted = mix(raw, brushCol, brushBlend).toVar();

      // Unified physical cold-press watercolor paper tooth, raking sunlight emboss & pigment granulation.
      const tooth = paper.height.sub(0.5);
      const emboss = paper.relief.mul(mix(float(0.14), float(0.18), u.dark));
      const granulate = tooth.mul(mix(float(0.085), float(0.11), u.dark));
      const paperMod = float(1).add(emboss.add(granulate).mul(paperAmt));
      const warmFiber = vec3(0.014, 0.01, -0.008)
        .add(vec3(0.006, 0.003, -0.006).mul(u.sunWarmth))
        .mul(tooth.add(paper.relief.mul(0.8)))
        .mul(paperAmt);

      return clamp(painted.mul(paperMod).add(warmFiber), vec3(0, 0, 0), vec3(0.998, 0.998, 0.998));
    })();
}
