/**
 * The stage every real-time 3D view stands on — each lab study and the 3D
 * graph (Lab principles P4): one renderer setup, one post chain, one palette,
 * one frame loop and one reveal, so no view has its own copy of any of them.
 *
 * - Renderer: three's `WebGPURenderer` — WebGPU where the browser has it, its
 *   own WebGL2 backend where it does not; the same TSL compiles to both.
 *   Antialiased, device pixel ratio clamped to 2 (P3). Soft shadows when the
 *   view asks for them (`shadows`), decided here once.
 * - Colour (L2): a set tone mapping (ACES unless a study compares others, or
 *   the shoulder for a scene that must meet the page around it: `tone.ts`)
 *   and sRGB output. Bloom's threshold is `BLOOM_THRESHOLD`, so only HDR
 *   values glow.
 * - Post chain: scene → optional ambient occlusion (GTAO, `ao`, decided once
 *   when the stage is built) → bloom → optional lens (`lens`: chromatic
 *   aberration toward the edges, an anamorphic streak drawn out of the
 *   bloom, film grain) → the edges fade to the ground (P1, L3), radially
 *   (`vignette`) or along the frame's own sides (`feather`), as far as the
 *   scene is present (`setPresence`) → tone mapping and sRGB → dither, a
 *   half-step of noise that breaks 8-bit banding in dark gradients (L4).
 * - GPU time (`gpuTiming`): on WebGPU the stage times each frame from its
 *   submission to the queue finishing it (`gpuMs`), so a scene can hold its
 *   own cost; on WebGL2 `gpuMs` stays null. Not timestamp queries: on Metal
 *   they sum passes that overlap, and read 50–75 ms for frames that run at
 *   54 fps.
 * - Palette (L1): the tokens as uniforms. A theme change eases every view's
 *   colours across at the theme duration (M1), or jumps when nothing may
 *   move (M7).
 * - Loop: dt clamped (M2). The animation loop runs only while the view is
 *   visible, motion is not reduced, and its frame reports that something
 *   still moves; otherwise a change draws one frame. Under reduced motion
 *   every frame steps by 0: a still composition, never a half-animation (M7).
 * - Reveal (P2): shaders are compiled before the first frame is shown, and
 *   the canvas fades in over the ground rather than popping.
 *
 * `mountScene` is the one way a view becomes a scene: it builds on a stage,
 * reveals it, gives the stage back if the build or the reveal fails, and
 * answers the scene host's handle (`@/scene/host`) from the stage.
 *
 * Only modules that are themselves behind a lazy boundary import this: the
 * lab's study scenes and the 3D graph's chunk (the lazy-chunk fence,
 * `UI_LAZY_ONLY` in harness/src/constraints.ts).
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  WebGPURenderer,
  type TextureNode,
  type ToneMapping,
} from "three/webgpu";
import {
  convertToTexture,
  dot,
  float,
  fog,
  fract,
  length,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  rangeFogFactor,
  renderOutput,
  hash,
  sample,
  screenCoordinate,
  screenUV,
  smoothstep,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao as gtao } from "three/addons/tsl/display/GTAONode.js";
import { BLOOM_THRESHOLD, type SceneBackend, type SceneHandle, type ScenePalette } from "@kb/scene";
import { backdropNode, type BackdropOptions } from "./backdrop";
import { disposeGraph } from "./dispose";
import { depthOfField, type StageFocus } from "./focus";
import { shoulder, shoulderGround } from "./tone";
import { bloomTexture, colorUniform, type TslNode } from "./tsl";
import { approachRate, approachShare, clampStep, type Timing } from "@kb/ui-sdk";

/** The device pixel ratio a stage never exceeds (P3). */
const MAX_PIXEL_RATIO = 2;

export type SceneToneMapping = "agx" | "aces" | "shoulder" | "none";

/** A picture of a stage's canvas: a PNG, and its size in pixels. */
interface StagePicture {
  readonly png: Blob;
  readonly width: number;
  readonly height: number;
}

/** three's curve for each kind; the shoulder is the post chain's own (`tone.ts`), so three applies none. */
const TONE_MAPPINGS: Record<SceneToneMapping, ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  shoulder: NoToneMapping,
  none: NoToneMapping,
};

/**
 * How a stage's camera projects: in perspective through a vertical field
 * of view (degrees), or orthographically, `height` world units from the
 * frame's bottom to its top, so a part's size never depends on its depth.
 * The camera is three's perspective camera either way (its type is the
 * stage's contract); an orthographic stage sets its projection matrix, and
 * draws its background with `screenFill`, which covers a frame of any shape.
 */
export type Projection =
  | { readonly kind: "perspective"; readonly fov: number }
  | { readonly kind: "orthographic"; readonly height: number };

export interface StageOptions {
  readonly projection: Projection;
  /** The camera's clip range, in world units; a study's default is 0.1–400. */
  readonly near?: number;
  readonly far?: number;
  readonly palette: ScenePalette;
  readonly timing: Timing;
  /** Whether motion is reduced when the stage is built (it can change later). */
  readonly reducedMotion: boolean;
  readonly bloom: { readonly strength: number; readonly radius: number };
  /** Build the ambient-occlusion pass (a study that shows contact shadows). */
  readonly ao?: boolean;
  /** Soft shadow maps (a study whose rig casts shadows). */
  readonly shadows?: boolean;
  /** How much of the frame's edge fades into the ground, 0–1 (radially; see `feather`). */
  readonly vignette?: number;
  /**
   * Fade into the ground along the frame's own sides instead, over these
   * shares of its width (each side) and height (top, bottom): a frame set
   * into a page, whose edges must vanish into it. A 0 leaves that edge
   * unfaded: a frame whose sides are the page region's own.
   */
  readonly feather?: { readonly sides: number; readonly top: number; readonly bottom: number };
  /**
   * Where the edges and the presence fade into the ground: in linear light
   * (the default), or in display values, as a CSS mask over the page blends.
   * A light page shows the difference: halfway to white in linear light
   * reads nearly white, so a high-key picture's fade washes it out.
   */
  readonly fadeSpace?: "linear" | "display";
  /** The tone curve the stage starts with (ACES by default). */
  readonly toneMapping?: SceneToneMapping;
  /** Depth of field (`focus.ts`): where the camera focuses, and how it loses focus either side. */
  readonly focus?: StageFocus;
  /**
   * A camera's artefacts, each 0 for none: see the post chain above. What is
   * not 0 here is built into the chain, and `setLens` retunes it; what is 0
   * here the chain does not have.
   */
  readonly lens?: StageLens;
  /** Read each frame's GPU time back where the backend can (`gpuMs`). */
  readonly gpuTiming?: boolean;
}

/** A camera's artefacts and how strong each is (0, none). */
export interface StageLens {
  /** Red and blue land apart, growing toward the edges. */
  readonly aberration: number;
  /** The bloom drawn out sideways. */
  readonly streak: number;
  /** Film grain over the art, as strong everywhere. */
  readonly grain: number;
  /** Film grain over the art that grows with its light: the hot parts speckle, the dark stay clean. */
  readonly sparkle?: number;
}

/**
 * One frame of a view: advance by `dt` seconds (clamped; 0 under reduced
 * motion), `elapsed` its clock. Returns whether something is still moving,
 * which is what keeps the animation loop running.
 */
type StageFrame = (dt: number, elapsed: number) => boolean;

/** Before a view is built, a frame has nothing to move. */
const still: StageFrame = () => false;

/** What the options decide, once, when the stage is built. */
interface StageBuild {
  readonly options: StageOptions;
  readonly shadows: boolean;
  readonly occluded: boolean;
}

/** The palette as uniforms (linear colour): what every view's shaders read. */
function paletteUniforms() {
  return {
    ground: colorUniform(),
    edge: colorUniform(),
    hue: colorUniform(),
    ink: colorUniform(),
    accent: colorUniform(),
  };
}
export type PaletteUniforms = ReturnType<typeof paletteUniforms>;
type PaletteKey = keyof PaletteUniforms;
const PALETTE_KEYS: readonly PaletteKey[] = ["ground", "edge", "hue", "ink", "accent"];

/**
 * How far in from one edge of the frame `from` is (0 at it), faded over
 * `share`: a side with no feather (0) is not faded at all, since a
 * smoothstep over no span is undefined.
 */
const side = (share: number, from: TslNode<"float">): TslNode<"float"> =>
  share > 0 ? smoothstep(0, share, from) : float(1);

/** How a frame's edges fade into the ground: 1 at the edge, 0 inside. */
function edgeFade(options: StageOptions, vignette: TslNode<"float">): TslNode<"float"> {
  const feather = options.feather;
  if (feather === undefined) {
    return smoothstep(0.45, 1.05, length(screenUV.sub(0.5)).mul(Math.SQRT2)).mul(vignette);
  }
  const x = screenUV.x;
  const y = screenUV.y;
  const across = side(feather.sides, x).mul(side(feather.sides, float(1).sub(x)));
  const down = side(feather.top, y).mul(side(feather.bottom, float(1).sub(y)));
  // Squared: the fade starts softly, so no line marks where it begins.
  const inside = across.mul(down);
  return float(1).sub(inside.mul(inside));
}

/** The depth of field over `picture`, the scene pass's, if the stage asks for one (`focus`). */
function focusOf(options: StageOptions, picture: TextureNode, scenePass: ReturnType<typeof pass>) {
  if (options.focus === undefined) return null;
  return depthOfField(
    picture,
    scenePass.getTextureNode("depth"),
    options.projection,
    [options.near ?? 0.1, options.far ?? 400],
    options.focus,
  );
}

/** A stage built without a lens: none of its artefacts. */
const NO_LENS: StageLens = { aberration: 0, streak: 0, grain: 0 };

/** The lens's strengths as uniforms, which `setLens` retunes. */
const lensKnobs = (lens: StageLens) => ({
  aberration: uniform(lens.aberration),
  streak: uniform(lens.streak),
  grain: uniform(lens.grain),
  sparkle: uniform(lens.sparkle ?? 0),
});

/** Whether a lens has grain at all, even or sparkling. */
const grained = (lens: StageLens): boolean => lens.grain > 0 || (lens.sparkle ?? 0) > 0;

/**
 * Film grain where the scene's art is, never on the page's ground: not beyond
 * the frame, and not on the ground inside it either, where grain clipped at
 * the page's white or black would shift its level and draw the frame's
 * rectangle. Even by `grain`, and growing with the art's light by `sparkle`.
 */
function filmGrain(
  display: TslNode<"vec3">,
  ground: TslNode<"vec3">,
  knobs: {
    readonly grainSeed: TslNode<"float">;
    readonly grain: TslNode<"float">;
    readonly sparkle: TslNode<"float">;
  },
): TslNode<"vec3"> {
  const pixel = screenCoordinate.xy.floor();
  const grain = hash(pixel.x.add(pixel.y.mul(8192)).add(knobs.grainSeed.mul(7919))).sub(0.5);
  const art = length(display.sub(ground));
  const light = dot(display, vec3(0.2126, 0.7152, 0.0722));
  const strength = knobs.grain.add(knobs.sparkle.mul(light));
  return vec3(grain, grain, grain)
    .mul(strength)
    .mul(smoothstep(0.004, 0.04, art));
}

/** The post chain, and the handles a view turns. */
function postChain(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  { options, occluded }: StageBuild,
  colors: PaletteUniforms,
) {
  const knobs = {
    dither: uniform(1),
    occlusion: uniform(occluded ? 1 : 0),
    vignette: uniform(options.vignette ?? 0.55),
    /** 1 while the shoulder is the tone curve (`tone.ts`), else 0. */
    shoulder: uniform(options.toneMapping === "shoulder" ? 1 : 0),
    /** How present the scene is over its ground, 0–1. */
    presence: uniform(1),
    /** Moves the grain each frame. */
    grainSeed: uniform(0),
    /** The lens's strengths, retuned by `setLens`. */
    ...lensKnobs(options.lens ?? NO_LENS),
  };
  // three r186's GTAO reads its centre depth with `gather()`, which WGSL has
  // no overload for on a multisampled depth texture, so under occlusion the
  // scene pass is single-sampled until three r187 (mrdoob/three.js#34609).
  // GAP [[01M416DT1SEWS5P3J28JT4R6YG]]
  const scenePass = pass(scene, camera, occluded ? { samples: 0 } : {});
  const color = scenePass.getTextureNode("output");
  let lit: ReturnType<typeof color.mul> | typeof color = color;
  let occlusionPass: ReturnType<typeof gtao> | null = null;
  if (occluded) {
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
    const normals = scenePass.getTextureNode("normal");
    occlusionPass = gtao(
      scenePass.getTextureNode("depth"),
      sample((uv) => unpackRGBToNormal(normals.sample(uv))),
      camera,
    );
    occlusionPass.resolutionScale = 0.5;
    const occlusion = occlusionPass.getTextureNode().sample(screenUV).r;
    lit = lit.mul(mix(float(1), occlusion, knobs.occlusion));
  }
  const focus = focusOf(options, lit === color ? color : convertToTexture(lit), scenePass);
  // The picture the lens reads: the scene, or the scene softened by depth.
  const picture = (uv: TslNode<"vec2">) => (focus === null ? color.sample(uv) : focus.sample(uv));
  if (focus !== null) lit = picture(screenUV);
  const glow = bloom(lit, options.bloom.strength, options.bloom.radius, BLOOM_THRESHOLD);
  // Which artefacts the chain has is decided once, from the lens it is built with.
  const lens = options.lens ?? NO_LENS;
  let composed: TslNode<"vec3"> = lit.rgb.add(glow.rgb);
  if (!occluded && (lens.aberration > 0 || lens.streak > 0)) {
    // Chromatic aberration: red and blue land a little apart, more toward the
    // edges, and most in the bloom, where the brightest highlights spread.
    const away = screenUV.sub(0.5);
    const shift = away.mul(length(away)).mul(knobs.aberration);
    const glowTexture = bloomTexture(glow);
    const at = (uv: TslNode<"vec2">) => picture(uv).rgb.add(glowTexture.sample(uv).rgb);
    const spread = shift.mul(3);
    const glowAt = (uv: TslNode<"vec2">) => glowTexture.sample(uv).rgb;
    const fringe = vec3(
      glowAt(screenUV.add(spread)).x.sub(glowAt(screenUV).x),
      0,
      glowAt(screenUV.sub(spread)).z.sub(glowAt(screenUV).z),
    );
    composed = vec3(at(screenUV.add(shift)).x, at(screenUV).y, at(screenUV.sub(shift)).z).add(
      fringe,
    );
    if (lens.streak > 0) {
      // The anamorphic streak: the bloom drawn out sideways, a little cool.
      let streak: TslNode<"vec3"> = vec3(0, 0, 0);
      let weight = 0;
      for (let i = 1; i <= 8; i++) {
        const w = Math.exp(-i / 3);
        const step = vec2(0.006 * i * i * 0.5, 0);
        streak = streak.add(
          glowAt(screenUV.add(step))
            .add(glowAt(screenUV.sub(step)))
            .mul(w),
        );
        weight += 2 * w;
      }
      composed = composed.add(streak.mul(knobs.streak.div(weight)).mul(vec3(0.92, 0.97, 1.1)));
    }
  }
  // How much of each pixel is the ground: the edges, and all of it as the scene's presence falls.
  const veil = float(1).sub(float(1).sub(edgeFade(options, knobs.vignette)).mul(knobs.presence));
  // What a scene paints for the page to show a colour: under the shoulder, its pre-image.
  const paint = (shown: TslNode<"vec3">) => mix(shown, shoulderGround(shown), knobs.shoulder);
  const ground = paint(colors.ground);
  // The shoulder comes before the fade: mixed after it, a sliver of veil over
  // the ground's pre-image (above 1 on a light page) would wash the frame grey.
  const toned = mix(composed, shoulder(composed), knobs.shoulder);
  const display =
    options.fadeSpace === "display"
      ? vec4(
          mix(renderOutput(vec4(toned, 1)).rgb, renderOutput(vec4(colors.ground, 1)).rgb, veil),
          1,
        )
      : renderOutput(vec4(mix(toned, colors.ground, veil), 1));
  // Interleaved gradient noise: a fixed, even half-step pattern per pixel.
  const noise = fract(
    float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))),
  );
  let shownColor: TslNode<"vec3"> = display.rgb.add(noise.sub(0.5).mul(knobs.dither.div(255)));
  if (grained(lens)) {
    shownColor = shownColor.add(
      filmGrain(display.rgb, renderOutput(vec4(colors.ground, 1)).rgb, knobs),
    );
  }
  const post = new RenderPipeline(renderer);
  post.outputColorTransform = false;
  post.outputNode = vec4(shownColor, 1);
  return { post, glow, occlusionPass, focus, knobs, ground, paint };
}

function backendOf(renderer: WebGPURenderer): SceneBackend {
  // Only three's WebGPU backend carries the flag; its WebGL2 fallback has none.
  return "isWebGPUBackend" in renderer.backend ? "WebGPU" : "WebGL2";
}

function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

/** The renderer, its canvas in the host, hidden until the reveal (P2). */
async function mountRenderer(
  host: HTMLElement,
  { shadows, options }: StageBuild,
): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  // Sized before its context is: the first frame is drawn at the host's size, never the canvas's default.
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
  await renderer.init();
  renderer.toneMapping = TONE_MAPPINGS[options.toneMapping ?? "aces"];
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }
  Object.assign(renderer.domElement.style, {
    display: "block",
    width: "100%",
    height: "100%",
    touchAction: "none",
    opacity: "0",
    transition: "opacity var(--motion-duration-reveal) var(--motion-settle)",
  });
  host.appendChild(renderer.domElement);
  return renderer;
}

/**
 * The frame loop and the palette it eases. The animation loop runs while the
 * view is visible, motion is not reduced, and the last frame (or the palette
 * ease) still moves; any change otherwise draws one frame on request.
 */
function frameLoop(
  renderer: WebGPURenderer,
  colors: PaletteUniforms,
  options: StageOptions,
  render: () => void,
) {
  const targets: Record<PaletteKey, Color> = {
    ground: new Color(),
    edge: new Color(),
    hue: new Color(),
    ink: new Color(),
    accent: new Color(),
  };
  const themeRate = approachRate(options.timing.theme);
  let frame: StageFrame = still;
  let visible = false;
  let reduced = options.reducedMotion;
  let looping = false;
  let moving = true;
  let easing = false;
  let pending = 0;
  let last = -1;
  let elapsed = 0;
  let frames = 0;
  const ease = (dt: number) => {
    if (!easing) return;
    const t = approachShare(themeRate, dt);
    let remaining = 0;
    for (const key of PALETTE_KEYS) {
      const value = colors[key].value;
      value.lerp(targets[key], t);
      remaining += Math.abs(value.r - targets[key].r) + Math.abs(value.b - targets[key].b);
    }
    easing = remaining > 1e-4;
  };
  const sync = () => {
    const wanted = visible && !reduced && (moving || easing);
    if (wanted === looping) return;
    looping = wanted;
    last = -1;
    void renderer.setAnimationLoop(wanted ? draw : null);
  };
  /** Who waits for the next frame to be drawn. */
  const waiting: (() => void)[] = [];
  function draw(now: number): void {
    // This is the frame a pending request asked for: it is not drawn twice.
    cancelAnimationFrame(pending);
    pending = 0;
    const dt = reduced || last < 0 ? 0 : clampStep((now - last) / 1000);
    last = now;
    elapsed += dt;
    ease(dt);
    frames++;
    moving = frame(dt, elapsed);
    render();
    sync();
    for (const resume of waiting.splice(0)) resume();
  }
  const invalidate = () => {
    moving = true;
    if (!visible) return;
    sync();
    if (looping || pending !== 0) return;
    pending = requestAnimationFrame((now) => {
      pending = 0;
      last = -1;
      draw(now);
    });
  };
  const setPalette = (palette: ScenePalette, animate: boolean) => {
    for (const key of PALETTE_KEYS) {
      targets[key].set(palette[key]);
      if (!animate) colors[key].value.copy(targets[key]);
    }
    easing = animate;
    invalidate();
  };
  return {
    draw,
    invalidate,
    /** Draw now, in this task, when the view is shown: a resized canvas is cleared, and must never be shown so. */
    redraw: () => {
      if (visible) draw(performance.now());
      else invalidate();
    },
    /**
     * A frame drawn from now: one is asked for, and `after` runs in the same
     * task, right after it is drawn — before it is shown, while the canvas
     * still holds it — and this answers what `after` did.
     */
    drawn: <T>(after: () => T) =>
      new Promise<T>((resolve) => {
        waiting.push(() => resolve(after()));
        invalidate();
      }),
    setFrame: (next: StageFrame) => {
      frame = next;
    },
    reduced: () => reduced,
    frames: () => frames,
    /** New theme colours: eased across while the view may move, set at once otherwise. */
    setPalette: (palette: ScenePalette) => setPalette(palette, visible && !reduced),
    setInitialPalette: (palette: ScenePalette) => setPalette(palette, false),
    setVisible: (next: boolean) => {
      visible = next;
      if (next) invalidate();
      else sync();
    },
    setReducedMotion: (next: boolean) => {
      reduced = next;
      invalidate();
    },
    stop: () => {
      visible = false;
      looping = false;
      if (pending !== 0) cancelAnimationFrame(pending);
      void renderer.setAnimationLoop(null);
    },
  };
}

/**
 * The next frame `canvas` draws, as a PNG: drawn, shown, then copied. A
 * view that wants a picture of something else sets its frame to draw that
 * until the picture is taken. `drawn` runs a step in the task that draws a
 * frame, right after it is drawn.
 */
async function pictureOf(
  canvas: HTMLCanvasElement,
  drawn: <T>(after: () => T) => Promise<T>,
): Promise<StagePicture> {
  // One frame to build what the new view draws, then the one copied — in the task that drew it,
  // since a WebGPU canvas lets go of a frame once it has been shown.
  await drawn(() => undefined);
  const bitmap = await drawn(() => createImageBitmap(canvas));
  const { width, height } = canvas;
  const copy = new OffscreenCanvas(width, height);
  copy.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
  const png = await copy.convertToBlob({ type: "image/png" });
  return { png, width, height };
}

/**
 * Each frame's GPU time on WebGPU (`gpuTiming`): from its submission to the
 * queue finishing it, so it counts what the GPU spent on it and any wait
 * for the GPU, which is the cost a backdrop must hold. One frame is timed
 * at a time; the reading is a frame behind.
 */
// GAP [[01M5STYVVX474T8WBT4FY341CM]] queue completion, not timestamp queries (unreliable on Metal)
function gpuTimer(renderer: WebGPURenderer, enabled: boolean) {
  const { backend } = renderer;
  const device = "device" in backend ? backend.device : undefined;
  const queue =
    enabled && typeof GPUDevice !== "undefined" && device instanceof GPUDevice
      ? device.queue
      : undefined;
  let ms: number | null = null;
  let timing = false;
  return {
    ms: () => ms,
    read: () => {
      if (queue === undefined || timing) return;
      timing = true;
      const start = performance.now();
      queue
        .onSubmittedWorkDone()
        .then(() => {
          ms = performance.now() - start;
          timing = false;
        })
        .catch(() => {
          ms = null;
          timing = false;
        });
    },
  };
}

/** The post chain's controls, as the stage hands them to its view. */
function postControls(
  renderer: WebGPURenderer,
  chain: ReturnType<typeof postChain>,
  invalidate: () => void,
) {
  return {
    bloomStrength: () => chain.glow.strength.value,
    /** Refocus a stage built with `focus` (a view whose scale changes moves its plane); else nothing. */
    setFocus: (focus: StageFocus) => {
      chain.focus?.set(focus);
      invalidate();
    },
    setBloom: (strength: number) => {
      chain.glow.strength.value = strength;
      invalidate();
    },
    /** Retunes the lens the stage was built with (`StageOptions.lens`); an artefact it was built without stays absent. */
    setLens: (lens: StageLens) => {
      chain.knobs.aberration.value = lens.aberration;
      chain.knobs.streak.value = lens.streak;
      chain.knobs.grain.value = lens.grain;
      chain.knobs.sparkle.value = lens.sparkle ?? 0;
      invalidate();
    },
    setToneMapping: (kind: SceneToneMapping) => {
      renderer.toneMapping = TONE_MAPPINGS[kind];
      chain.knobs.shoulder.value = kind === "shoulder" ? 1 : 0;
      chain.post.needsUpdate = true;
      invalidate();
    },
    /** How present the scene is over its ground, 0–1: at 0 the frame is the ground alone. */
    setPresence: (presence: number) => {
      chain.knobs.presence.value = Math.min(1, Math.max(0, presence));
      invalidate();
    },
    /**
     * The ground as the scene must paint it to show the palette's ground:
     * under the shoulder, its pre-image (`tone.ts`), so a scene that paints
     * it meets the page around the frame to the level.
     */
    ground: chain.ground,
    /**
     * What the scene must paint for the page to show `shown`: under the
     * shoulder its pre-image, otherwise itself. A picture composed in the
     * page's own terms (a light page's high-key sky, the ground times a
     * shade) passes through it, so the curve does not wash it to white.
     */
    paint: chain.paint,
  };
}

/** The camera's projection for a frame of `aspect` (`Projection`). */
function project(camera: PerspectiveCamera, projection: Projection, aspect: number) {
  camera.aspect = aspect;
  if (projection.kind === "perspective") {
    camera.updateProjectionMatrix();
    return;
  }
  const h = projection.height / 2;
  const w = h * aspect;
  camera.projectionMatrix.makeOrthographic(
    -w,
    w,
    h,
    -h,
    camera.near,
    camera.far,
    camera.coordinateSystem,
    camera.reversedDepth,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/** Sizes the canvas and the view to the host's (CSS pixels); false for a host with no size. */
function sizer(
  renderer: WebGPURenderer,
  camera: PerspectiveCamera,
  projection: Projection,
  chain: ReturnType<typeof postChain>,
) {
  return (width: number, height: number): boolean => {
    if (width <= 0 || height <= 0) return false;
    renderer.setPixelRatio(pixelRatio());
    chain.focus?.scale(renderer.getPixelRatio());
    renderer.setSize(width, height, false);
    project(camera, projection, width / height);
    return true;
  };
}

async function createStage(host: HTMLElement, options: StageOptions) {
  const shadows = options.shadows === true;
  const occluded = options.ao === true;
  const build: StageBuild = { options, shadows, occluded };
  const renderer = await mountRenderer(host, build);
  const scene = new Scene();
  const { projection } = options;
  const camera = new PerspectiveCamera(
    projection.kind === "perspective" ? projection.fov : 50,
    1,
    options.near ?? 0.1,
    options.far ?? 400,
  );
  const colors = paletteUniforms();
  const chain = postChain(renderer, scene, camera, build, colors);
  const timing = gpuTimer(renderer, options.gpuTiming === true);
  const loop = frameLoop(renderer, colors, options, () => {
    if (!loop.reduced()) chain.knobs.grainSeed.value = (chain.knobs.grainSeed.value + 1) % 251;
    chain.post.render();
    timing.read();
  });
  loop.setInitialPalette(options.palette);
  const { invalidate } = loop;
  const size = sizer(renderer, camera, projection, chain);

  return {
    scene,
    camera,
    renderer,
    colors,
    knobs: chain.knobs,
    backend: backendOf(renderer),
    /** Whether the rig may cast shadows on this stage. */
    shadows,
    /** Frames drawn so far (a render spec reads it). */
    frames: loop.frames,
    /** Whether motion is reduced right now. */
    reduced: loop.reduced,
    setFrame: loop.setFrame,
    setPalette: loop.setPalette,
    /** Something changed: draw, and keep drawing while the frame reports motion. */
    invalidate,
    ...postControls(renderer, chain, invalidate),
    /** The last frame's GPU time in ms, or null where the backend cannot tell (`gpuTiming`). */
    gpuMs: timing.ms,
    /**
     * The ground as a backdrop (`gpu/backdrop`): the focal point lighter, the
     * edges into `edge`, and whatever warmth, haze or rise the view asks for,
     * drifting on its `time` (seconds).
     */
    backdrop: (ground: BackdropOptions & { readonly time?: TslNode<"float"> } = {}) => {
      // The occlusion pass renders to two targets, and three's background
      // mesh writes only one: under occlusion the ground is a flat clear (the
      // same live colour), and the post chain's edge fade does the vignette.
      if (occluded) {
        scene.background = colors.ground.value;
        return;
      }
      scene.backgroundNode = backdropNode(colors, ground.time ?? float(0), ground);
    },
    /**
     * Atmospheric perspective (L3): distance fades into the ground. The range
     * is two uniforms, so a view whose depth changes (a camera that dollies)
     * moves it without rebuilding a shader, and how much of the fade applies
     * is a third (0: none), so a view can turn it off the same way.
     */
    atmosphere: (near: number, far: number) => {
      const range = { near: uniform(near), far: uniform(far), amount: uniform(1) };
      scene.fogNode = fog(colors.ground, rangeFogFactor(range.near, range.far).mul(range.amount));
      return range;
    },
    /** The next frame the view draws, as a PNG (`pictureOf`). */
    picture: () => pictureOf(renderer.domElement, loop.drawn),
    /** Compile every shader, draw once unseen, then fade the canvas in (P2). */
    reveal: () => {
      // Every scene compiles on the hidden first frame. A compile ahead of it
      // (`compileAsync`, the renderer's or the scene pass's) builds each
      // material a second time for another target, and three r186 caches a
      // layout function's code from its first build, so the second build
      // loses that function's uniforms and its pipeline is rejected.
      // GAP [[01M3A8QG4PEQK0A9N3KPQ3K98X]]
      loop.draw(performance.now());
      requestAnimationFrame(() => {
        renderer.domElement.style.opacity = "1";
      });
    },
    size,
    /** Draw now, in this task, when the view is shown (`frameLoop`'s `redraw`). */
    redraw: loop.redraw,
    /** The scene host's handle, answered by the stage (`@/scene/host`). */
    handle: {
      backend: backendOf(renderer),
      resize: (width: number, height: number) => {
        if (size(width, height)) loop.redraw();
      },
      setRunning: loop.setVisible,
      setReducedMotion: loop.setReducedMotion,
      dispose: () => {
        loop.stop();
        disposeGraph(scene);
        chain.occlusionPass?.dispose();
        chain.focus?.dispose();
        chain.glow.dispose();
        chain.post.dispose();
        void renderer.dispose();
        renderer.domElement.remove();
      },
    } satisfies SceneHandle,
  };
}

export type SceneStage = Awaited<ReturnType<typeof createStage>>;

/** What a view adds to its stage: its frame, and what the stage does not own. */
export interface SceneParts {
  readonly frame: StageFrame;
  /** After the stage has taken the new size. */
  readonly resize?: (width: number, height: number) => void;
  /** After the stage has taken the new setting. */
  readonly setReducedMotion?: (reduced: boolean) => void;
  /** Release what the stage's scene traversal does not reach (listeners, workers, textures). */
  readonly dispose?: () => void;
  /** What the view needs before its first frame is shown (an image it draws); the reveal waits for it. */
  readonly ready?: Promise<unknown>;
}

/**
 * Build a view on a new stage, lay it out at its host's size, wait for what
 * it needs (`ready`) and reveal it: one first frame, at its size, faded in
 * once. If the build or the reveal fails, the view's parts and the stage are given back before the error goes
 * on: nobody will ever hold a handle to them, so every failed open would
 * otherwise leak a GPU context. The handle is the stage's, extended by the
 * parts.
 */
export async function mountScene<P extends SceneParts>(
  host: HTMLElement,
  options: StageOptions,
  build: (stage: SceneStage) => P,
): Promise<{ readonly stage: SceneStage; readonly parts: P; readonly handle: SceneHandle }> {
  const stage = await createStage(host, options);
  let parts: P | null = null;
  try {
    parts = build(stage);
    stage.setFrame(parts.frame);
    if (stage.size(host.clientWidth, host.clientHeight)) {
      parts.resize?.(host.clientWidth, host.clientHeight);
    }
    await parts.ready;
    stage.reveal();
  } catch (error) {
    parts?.dispose?.();
    stage.handle.dispose();
    throw error;
  }
  const built = parts;
  const base = stage.handle;
  return {
    stage,
    parts: built,
    handle: {
      backend: base.backend,
      // The view is laid out at its new size before the frame that shows it.
      resize: (width, height) => {
        if (!stage.size(width, height)) return;
        built.resize?.(width, height);
        stage.redraw();
      },
      setRunning: base.setRunning,
      setReducedMotion: (reduced) => {
        base.setReducedMotion(reduced);
        built.setReducedMotion?.(reduced);
      },
      dispose: () => {
        built.dispose?.();
        base.dispose();
      },
    },
  };
}
