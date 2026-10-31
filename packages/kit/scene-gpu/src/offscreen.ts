/**
 * An offscreen pass: a picture a scene draws at a resolution of its own,
 * before its frame, and samples in its frame like any texture (Lab principle
 * P3: the cost is the scene's to hold). Three needs share it:
 *
 * - **Expensive and soft.** A raymarch or a deep noise field costs per pixel
 *   and has no fine detail to lose, so it is drawn at a fraction of the
 *   frame's pixels and scaled up, and that fraction is a knob a scene turns
 *   when its frames run long.
 * - **Accumulated.** With `history`, the pass keeps its last picture and
 *   hands it to the next as a texture, so a scene can blend a jittered
 *   sample into the ones before it: noise that moves every frame averages
 *   away, and fewer samples a frame look like many.
 * - **Baked once, read smaller.** With `mipmapped`, the target keeps its mip
 *   chain, built again after each render, so a picture drawn once at a high
 *   resolution and read at whatever size the frame shows it (a relief) is
 *   filtered over each pixel's footprint, never sampled into stairs and
 *   sparkle. Its reads name that footprint themselves (the screen
 *   derivatives of where they read): a scene's frame is its background, and
 *   three reads every texture there at the background's fixed level, which
 *   would read the chain's finest level at every size.
 *
 * One TSL graph on one quad (T1); `history` is the picture before this one,
 * and `size` the target's size in pixels. Disposing gives back both targets
 * and the quad's material.
 */
import {
  HalfFloatType,
  LinearMipmapLinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  Vector2,
  type WebGPURenderer,
} from "three/webgpu";
import { dFdx, dFdy, texture, uniform } from "three/tsl";
import { sampleTexture, type TslNode } from "./tsl";

/** A picture read at a point (UV, 0–1 each way): the vec4 there, filtered. */
export type PictureSampler = (at: TslNode<"vec2">) => TslNode<"vec4">;

export interface OffscreenInputs {
  /** The pass's previous picture (with `history`), else its current target. */
  readonly history: PictureSampler;
  /** The target's size in pixels. */
  readonly size: TslNode<"vec2">;
}

export interface OffscreenPass {
  /** The latest picture, to sample in the frame; it follows each render. */
  readonly picture: PictureSampler;
  /** The target's size in pixels, as a uniform (a texel is its inverse). */
  readonly size: TslNode<"vec2">;
  /** Size the target, in its own pixels (at least 1×1). */
  readonly setSize: (width: number, height: number) => void;
  /** Draw the next picture. */
  readonly render: () => void;
  readonly dispose: () => void;
}

/** How a pass's target is kept: its last picture handed to the next (`history`), and its mip chain (`mipmapped`). */
export interface OffscreenOptions {
  readonly history: boolean;
  readonly mipmapped?: boolean;
}

/** A half-float target with no depth, resized by the pass, with its mip chain where it is read smaller. */
function offscreenTarget(mipmapped: boolean): RenderTarget {
  const target = new RenderTarget(1, 1, {
    depthBuffer: false,
    type: HalfFloatType,
    ...(mipmapped ? { generateMipmaps: true, minFilter: LinearMipmapLinearFilter } : {}),
  });
  target.texture.name = "offscreen";
  return target;
}

export function offscreenPass(
  renderer: WebGPURenderer,
  fragment: (inputs: OffscreenInputs) => TslNode<"vec4">,
  options: OffscreenOptions,
): OffscreenPass {
  const mipmapped = options.mipmapped ?? false;
  let write = offscreenTarget(mipmapped);
  let read = options.history ? offscreenTarget(mipmapped) : write;
  const size = uniform(new Vector2(1, 1));
  const history = texture(read.texture);
  const picture = texture(write.texture);
  const material = new NodeMaterial();
  material.name = "offscreen";
  material.fragmentNode = fragment({ history: (at) => sampleTexture(history, at), size });
  const quad = new QuadMesh(material);

  return {
    picture: (at) =>
      mipmapped ? picture.sample(at).grad(dFdx(at), dFdy(at)) : sampleTexture(picture, at),
    size,
    setSize: (width, height) => {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      if (write.width === w && write.height === h) return;
      write.setSize(w, h);
      read.setSize(w, h);
      size.value.set(w, h);
    },
    render: () => {
      history.value = read.texture;
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(write);
      quad.render(renderer);
      renderer.setRenderTarget(before);
      picture.value = write.texture;
      if (options.history) [write, read] = [read, write];
    },
    dispose: () => {
      write.dispose();
      if (read !== write) read.dispose();
      // The quad's geometry is three's one shared quad (bloom draws with it too), never freed.
      material.dispose();
    },
  };
}
