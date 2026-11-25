/**
 * Minimalist aviation endurance HUD overlay for the Gliding backdrop (`gliding-scene.ts`):
 * - Left semicircular `F → E` radial tick arc (white upper range → warm aviation red reserve).
 * - Crisp vector fuel dispenser glyph nestled inside the left arc.
 * - Tapered pointer needle pivoting from the hub + miniature aircraft silhouette.
 * - Fine horizontal leader line ending cleanly over open water + live tabular `31:31:22` clock.
 */
import { texture, uniform, uv } from "three/tsl";
import {
  CanvasTexture,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from "three/webgpu";
import type { Grounds } from "../gpu/gpu-scene";

/** Reference endurance baseline: 31:31:22 (113,482 seconds). */
export const BASE_ENDURANCE_SECONDS = 31 * 3600 + 31 * 60 + 22;
/** Reference fuel level: ~87% full (needle angled cleanly just counter-clockwise of F). */
export const BASE_FUEL_FRACTION = 0.87;

const HUD_W = 1024;
const HUD_H = 512;
const HUD_ASPECT = HUD_W / HUD_H;
const HUD_Z = 2.45;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Format elapsed endurance seconds as `HH:MM:SS` with zero-padded two-digit fields. */
export function formatEnduranceClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Compute gentle endurance fuel fraction over long flight time.
 * Drops imperceptibly (~1% per 20 minutes) and never falls below reserve 14%.
 */
export function evaluateFuelFraction(elapsedSeconds: number): number {
  const safe = Math.max(0, elapsedSeconds);
  return Math.max(0.14, BASE_FUEL_FRACTION - safe * 0.000008);
}

interface HudDrawParams {
  readonly dark: boolean;
  readonly elapsedSeconds: number;
  readonly reducedMotion: boolean;
}

interface HudPalette {
  readonly ink: string;
  readonly inkSoft: string;
  readonly red: string;
  readonly redSoft: string;
  readonly halo: string;
}

function drawArcAndFuelIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  pal: HudPalette,
): void {
  const tickCount = 32;
  for (let i = 0; i <= tickCount; i++) {
    const t = i / tickCount;
    const ang = -Math.PI * 0.5 - t * Math.PI;
    const isMajor = i % 8 === 0;
    const isMid = i % 4 === 0;
    const isReserve = t >= 0.75;
    const len = isMajor ? 22 : isMid ? 15 : 10;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * (radius - len), cy + Math.sin(ang) * (radius - len));
    ctx.lineTo(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius);
    ctx.strokeStyle = isReserve ? pal.red : isMajor ? pal.ink : pal.inkSoft;
    ctx.lineWidth = isMajor ? 3.2 : 2.1;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, radius - 4, Math.PI * 0.5, Math.PI * 0.75, false);
  ctx.strokeStyle = pal.redSoft;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.font = '600 28px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pal.ink;
  ctx.fillText("F", cx + 10, cy - radius + 12);
  ctx.fillStyle = pal.red;
  ctx.fillText("E", cx + 10, cy + radius - 10);

  // Minimal vector fuel dispenser icon inside the 9 o'clock arc
  ctx.save();
  ctx.translate(cx - radius * 0.62, cy);
  ctx.fillStyle = pal.ink;
  ctx.strokeStyle = pal.ink;
  ctx.beginPath();
  ctx.roundRect(-14, -19, 24, 36, 3);
  ctx.fill();
  ctx.fillRect(-17, 16, 30, 4);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillRect(-10, -14, 16, 10);
  ctx.restore();
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(10, -8);
  ctx.lineTo(15, -8);
  ctx.lineTo(15, 8);
  ctx.arc(18.5, 8, 3.5, Math.PI, 0, true);
  ctx.lineTo(22, -10);
  ctx.lineTo(18, -16);
  ctx.stroke();
  ctx.restore();
}

interface HudDial {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

function drawNeedleAndLeader(
  ctx: CanvasRenderingContext2D,
  dial: HudDial,
  params: HudDrawParams,
  pal: HudPalette,
): void {
  const { cx, cy, radius } = dial;
  const fuel = evaluateFuelFraction(params.reducedMotion ? 0 : params.elapsedSeconds);
  const needleAng = -Math.PI * 0.5 - (1 - fuel) * Math.PI;
  const needleLen = radius * 0.72;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(needleAng);
  ctx.fillStyle = pal.ink;
  ctx.beginPath();
  ctx.moveTo(-12, -3.5);
  ctx.lineTo(needleLen, -1.1);
  ctx.lineTo(needleLen, 1.1);
  ctx.lineTo(-12, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const ax = cx + 48;
  ctx.save();
  ctx.translate(ax, cy);
  ctx.fillStyle = pal.ink;
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(9, -4);
  ctx.lineTo(-4, -24);
  ctx.lineTo(-10, -24);
  ctx.lineTo(-4, -4.5);
  ctx.lineTo(-17, -4);
  ctx.lineTo(-24, -12);
  ctx.lineTo(-27, -12);
  ctx.lineTo(-22, -2);
  ctx.lineTo(-22, 2);
  ctx.lineTo(-27, 12);
  ctx.lineTo(-24, 12);
  ctx.lineTo(-17, 4);
  ctx.lineTo(-4, 4.5);
  ctx.lineTo(-10, 24);
  ctx.lineTo(-4, 24);
  ctx.lineTo(9, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const lineStart = ax + 34;
  const lineEnd = 748;
  ctx.beginPath();
  ctx.moveTo(lineStart, cy);
  ctx.lineTo(lineEnd, cy);
  ctx.strokeStyle = pal.inkSoft;
  ctx.lineWidth = 2.0;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(lineEnd, cy, 2.3, 0, Math.PI * 2);
  ctx.fillStyle = pal.inkSoft;
  ctx.fill();

  const clockText = formatEnduranceClock(
    BASE_ENDURANCE_SECONDS + (params.reducedMotion ? 0 : params.elapsedSeconds),
  );
  ctx.font = '500 24px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = pal.ink;
  ctx.fillText(clockText, (lineStart + lineEnd) * 0.5, cy - 26);
}

function drawHud(ctx: CanvasRenderingContext2D, params: HudDrawParams): void {
  ctx.clearRect(0, 0, HUD_W, HUD_H);
  // Keep the crisp white aviation-instrument + red-reserve HUD aesthetic in both Dark and Light modes.
  const pal: HudPalette = {
    ink: "rgba(255, 255, 255, 0.98)",
    inkSoft: "rgba(255, 255, 255, 0.86)",
    red: "rgba(236, 74, 62, 0.98)",
    redSoft: "rgba(236, 74, 62, 0.4)",
    halo: params.dark ? "rgba(2, 22, 40, 0.62)" : "rgba(4, 34, 54, 0.92)",
  };

  ctx.save();
  ctx.shadowColor = pal.halo;
  ctx.shadowBlur = params.dark ? 8 : 7;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  // In Light mode, paint an extra soft dark-teal under-halo pass so pure white ticks & timer pop cleanly.
  if (!params.dark) {
    drawArcAndFuelIcon(ctx, 304, 256, 172, pal);
    drawNeedleAndLeader(ctx, { cx: 304, cy: 256, radius: 172 }, params, pal);
  }
  drawArcAndFuelIcon(ctx, 304, 256, 172, pal);
  drawNeedleAndLeader(ctx, { cx: 304, cy: 256, radius: 172 }, params, pal);
  ctx.restore();
}

function createHudCanvas(): {
  readonly texture: Texture;
  readonly redraw: (params: HudDrawParams) => void;
} {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = HUD_W;
    canvas.height = HUD_H;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawHud(ctx, { dark: true, elapsedSeconds: 0, reducedMotion: true });
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return {
        texture: tex,
        redraw: (params) => {
          drawHud(ctx, params);
          tex.needsUpdate = true;
        },
      };
    }
  }
  const fallback = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, RGBAFormat);
  fallback.needsUpdate = true;
  return { texture: fallback, redraw: () => undefined };
}

export interface EnduranceHud {
  readonly group: Group;
  readonly setLook: (opts: { readonly dark: boolean }) => void;
  readonly setLayout: (opts: {
    readonly anchorX: number;
    readonly anchorY: number;
    readonly scale: number;
    readonly isStudio: boolean;
    readonly width: number;
    readonly height: number;
    readonly fovDeg: number;
    readonly cameraZ: number;
  }) => void;
  readonly update: (opts: {
    readonly time: number;
    readonly dollyX: number;
    readonly dollyY: number;
    readonly reducedMotion: boolean;
  }) => void;
  readonly dispose: () => void;
}

export function createEnduranceHud(grounds: Grounds): EnduranceHud {
  const hud = createHudCanvas();
  const geo = new PlaneGeometry(HUD_ASPECT, 1);
  const opacityU = uniform(0.92);
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const texSample = texture(hud.texture, uv());
  mat.colorNode = grounds.paint(texSample.rgb);
  mat.opacityNode = texSample.a.mul(opacityU);

  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 20;
  const group = new Group();
  group.add(mesh);

  let dark = true;
  let lastSecond = -1;
  let lastDark = true;
  let lastReduced = true;
  let layout = {
    anchorX: 0.25,
    anchorY: 0,
    scale: 1,
    isStudio: true,
    width: 1280,
    height: 720,
    hudWorldPerHeight: 5.5,
  };

  const applyPos = (dollyX: number, dollyY: number) => {
    const hudHeight = (layout.isStudio ? 0.31 : 0.3) * layout.scale * layout.hudWorldPerHeight;
    const offsetX = (layout.isStudio ? -0.45 : -0.4) * layout.scale;
    const offsetY = (layout.isStudio ? -0.02 : -0.01) * layout.scale;
    const hx = (layout.anchorX + offsetX - dollyX * 0.28) * layout.hudWorldPerHeight;
    const hy = (layout.anchorY + offsetY - dollyY * 0.28) * layout.hudWorldPerHeight;
    group.position.set(hx, hy, HUD_Z);
    group.scale.setScalar(hudHeight);

    const narrowFade = layout.isStudio
      ? 0.94
      : layout.width >= 900
        ? 0.78
        : layout.width >= 640
          ? 0.48
          : 0.0;
    opacityU.value = narrowFade;
    group.visible = narrowFade > 0.02;
  };

  applyPos(0, 0);

  return {
    group,
    setLook: ({ dark: nextDark }) => {
      dark = nextDark;
      if (dark !== lastDark) {
        lastDark = dark;
        hud.redraw({ dark, elapsedSeconds: Math.max(0, lastSecond), reducedMotion: lastReduced });
      }
    },
    setLayout: ({ anchorX, anchorY, scale, isStudio, width, height, fovDeg, cameraZ }) => {
      const tanHalf = Math.tan(((fovDeg * Math.PI) / 180) * 0.5);
      layout = {
        anchorX,
        anchorY,
        scale,
        isStudio,
        width,
        height,
        hudWorldPerHeight: 2 * (cameraZ - HUD_Z) * tanHalf,
      };
      applyPos(0, 0);
    },
    update: ({ time, dollyX, dollyY, reducedMotion }) => {
      const sec = reducedMotion ? 0 : Math.floor(Math.max(0, time));
      if (sec !== lastSecond || dark !== lastDark || reducedMotion !== lastReduced) {
        lastSecond = sec;
        lastDark = dark;
        lastReduced = reducedMotion;
        hud.redraw({ dark, elapsedSeconds: sec, reducedMotion });
      }
      applyPos(dollyX, dollyY);
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      hud.texture.dispose();
    },
  };
}
