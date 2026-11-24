/**
 * Procedural hand-painted `CanvasTexture`s for the Ichiraku Konoha cyber-ramen
 * backdrop: gouache brushwork grain, evenly spaced `一楽` neon/enamel sign,
 * properly centered vertical `tategaki` signs (`ラーメン` with vertical ー,
 * `営業中`, `酒処`), 5 authentic Ichiraku *noren* panels (`一`, `楽`, `ラ`, `メ`, `ン`
 * + Uzumaki swirl stamps), red-and-black summoning scroll sealing kanji (`封`),
 * weathered Konoha Leaf Swirl shutter stencil, Konoha Mission Notice Board,
 * A-frame chalk menu board, `木ノ葉 CHAKRA 78%` charger HUD, dim vending
 * machine, and iconic Hokage Rock cliff silhouette.
 */
import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from "three/webgpu";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeCanvas(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d") };
}

function finalizeTexture(canvas: HTMLCanvasElement, repeat: boolean, srgb: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = srgb ? SRGBColorSpace : tex.colorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  if (repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  rect: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly r: number;
  },
): void {
  const { x, y, w, h, r } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillOval(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
}

/** Draw the iconic Konoha Hidden Leaf swirl emblem (`木ノ葉`) centered at (cx, cy). */
function drawKonohaLeaf(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Inner spiral
  ctx.beginPath();
  for (let i = 0; i <= 54; i++) {
    const t = (i / 54) * Math.PI * 4.0;
    const r = 4 + t * 4.4;
    const px = Math.cos(t - 0.6) * r;
    const py = Math.sin(t - 0.6) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // Pointed leaf tail sweeping right-upward & small triangular notch on the left
  ctx.beginPath();
  ctx.moveTo(46, -24);
  ctx.lineTo(86, -42);
  ctx.lineTo(54, 4);
  ctx.moveTo(-48, 22);
  ctx.lineTo(-74, 46);
  ctx.stroke();
  ctx.restore();
}

function paintBrushTexture(): CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  if (ctx !== null) {
    const rng = makeRng(4109);
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 420; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const w = 18 + rng() * 54;
      const h = 3 + rng() * 9;
      const shade = Math.round(92 + rng() * 76);
      const alpha = 0.08 + rng() * 0.16;
      const tilt = (rng() - 0.5) * 0.35;
      for (const ox of [-size, 0, size]) {
        ctx.save();
        ctx.translate(x + ox, y);
        ctx.rotate(tilt);
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha.toFixed(3)})`;
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.restore();
      }
    }
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 180; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const len = 10 + rng() * 26;
      const bright = rng() > 0.5 ? 205 : 64;
      ctx.strokeStyle = `rgba(${bright},${bright},${bright},0.14)`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (rng() - 0.5) * 4);
      ctx.stroke();
    }
  }
  return finalizeTexture(canvas, true, false);
}

function drawNeonRamenBowl(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(134, 134, 46, 0.08 * Math.PI, 0.92 * Math.PI);
  ctx.lineTo(88, 140);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(112, 184);
  ctx.lineTo(156, 184);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 3.1;
    const r = 4 + t * 2.7;
    const px = 132 + Math.cos(t - 0.8) * r;
    const py = 114 + Math.sin(t - 0.8) * r * 0.72;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(146, 86);
  ctx.lineTo(202, 64);
  ctx.moveTo(150, 96);
  ctx.lineTo(206, 80);
  ctx.stroke();
  ctx.restore();
}

function paintRoofSignTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  if (ctx !== null) {
    ctx.fillStyle = "#161d14";
    ctx.fillRect(0, 0, 512, 256);
    const drawArtwork = (color: string, width: number, blur: number) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = "#c8e838";
      ctx.shadowBlur = blur;
      traceRoundedRect(ctx, { x: 24, y: 24, w: 464, h: 208, r: 18 });
      ctx.stroke();
      drawNeonRamenBowl(ctx);
      ctx.font = "900 118px 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("一楽", 346, 132);
      ctx.restore();
    };
    drawArtwork("#8eb828", 15, 22);
    drawArtwork("#d8f058", 8, 9);
    drawArtwork("#eef7a6", 3, 2);
  }
  return finalizeTexture(canvas, false, true);
}

function paintRoofSignDayTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  if (ctx !== null) {
    // Traditional daytime Konoha sunlit lacquered cream signboard with cedar border!
    const bg = ctx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, "#f6ebd0");
    bg.addColorStop(1, "#e2d0a8");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = "#3f281c";
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, 494, 238);
    ctx.strokeStyle = "#b53624";
    ctx.lineWidth = 6;
    traceRoundedRect(ctx, { x: 26, y: 26, w: 460, h: 204, r: 14 });
    ctx.stroke();

    // Vermilion painted ramen bowl emblem + sumi-ink calligraphy `一楽`
    ctx.strokeStyle = "#b53624";
    ctx.lineWidth = 9;
    drawNeonRamenBowl(ctx);

    ctx.fillStyle = "#1c1512";
    ctx.font = "900 120px 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("一楽", 346, 134);
  }
  return finalizeTexture(canvas, false, true);
}

/** Sunlit anime Konoha afternoon sky with cerulean gradient, warm solar glow, and cumulus clouds! */
function paintDaySkyTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 384);
  if (ctx !== null) {
    const grad = ctx.createLinearGradient(0, 0, 0, 384);
    grad.addColorStop(0, "#2f7dd4");
    grad.addColorStop(0.5, "#74b4ec");
    grad.addColorStop(0.84, "#cce4f8");
    grad.addColorStop(1, "#f6eed8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 384);

    // Warm golden solar sky glow sitting behind Hokage Mountain's sloping right shoulder!
    const sunGlow = ctx.createRadialGradient(602, 134, 14, 602, 134, 300);
    sunGlow.addColorStop(0, "rgba(255,250,218,0.88)");
    sunGlow.addColorStop(0.35, "rgba(255,232,166,0.46)");
    sunGlow.addColorStop(1, "rgba(255,216,144,0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(280, 0, 680, 384);

    // Soft painted Ghibli/Konoha afternoon cumulus cloud puffs
    const clouds: readonly (readonly [number, number, number, number, string])[] = [
      [180, 175, 130, 42, "rgba(255,252,244,0.88)"],
      [250, 152, 92, 48, "rgba(255,252,244,0.92)"],
      [485, 156, 104, 34, "rgba(255,250,236,0.82)"],
      [660, 146, 98, 32, "rgba(255,250,238,0.84)"],
      [815, 168, 128, 44, "rgba(255,252,244,0.86)"],
      [882, 146, 84, 40, "rgba(255,252,244,0.9)"],
    ];
    for (const [cx, cy, rx, ry, col] of clouds) {
      ctx.fillStyle = col;
      fillOval(ctx, cx, cy, rx, ry);
    }
  }
  return finalizeTexture(canvas, false, true);
}

/**
 * Properly centered Japanese vertical signage (`tategaki`):
 * - Symmetrically distributes N characters around vertical center `h / 2` with
 *   balanced top/bottom padding.
 * - Renders prolonged sound mark `ー` vertically (`90°` rotated) as real Japanese signs do!
 */
function paintVerticalSignTexture(
  chars: readonly string[],
  bgTop: string,
  bgBot: string,
  ink: string,
): CanvasTexture {
  const w = 144;
  const h = 360;
  const { canvas, ctx } = makeCanvas(w, h);
  if (ctx !== null) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, bgTop);
    grad.addColorStop(1, bgBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = ink;

    const count = Math.max(1, chars.length);
    const fontSize = count <= 2 ? 84 : count === 3 ? 68 : 58;
    const innerSpan = h - 92;
    const pitch = count === 1 ? 0 : innerSpan / count;
    const startY = h * 0.5 - (count - 1) * pitch * 0.5;

    ctx.font = `900 ${fontSize}px 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chars.forEach((ch, idx) => {
      const cy = startY + idx * pitch;
      ctx.save();
      ctx.translate(w * 0.5, cy);
      if (ch === "ー") {
        // Vertical prolonged-vowel bar in authentic Japanese tategaki typography!
        ctx.rotate(Math.PI * 0.5);
      }
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
  }
  return finalizeTexture(canvas, false, true);
}

/**
 * Authentic Ichiraku Ramen *noren* panel: warm woven linen with bold hand-brushed
 * character (`一`, `楽`, `ラ`, `メ`, `ン`) + classic red Uzumaki naruto-swirl stamp!
 */
function paintNorenPanelTexture(char: string, seed: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  if (ctx !== null) {
    const rng = makeRng(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#eee1c4");
    grad.addColorStop(0.68, "#d9c49d");
    grad.addColorStop(1, "#9a8263");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(92,66,42,${(0.03 + rng() * 0.055).toFixed(3)})`;
      ctx.fillRect(rng() * 256, 0, 2 + rng() * 4, 256);
    }
    // Top bamboo-rod sleeve
    ctx.fillStyle = "#563e2d";
    ctx.fillRect(0, 0, 256, 20);
    // Thin woven side seams
    ctx.strokeStyle = "rgba(46,28,22,0.42)";
    ctx.lineWidth = 4;
    ctx.strokeRect(7, 22, 242, 226);

    // Classic crimson Ichiraku calligraphy character centered cleanly in upper 2/3
    ctx.fillStyle = "#7e251a";
    ctx.font = "900 116px 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char, 128, 114);

    // Iconic red Uzumaki naruto-fishcake spiral seal stamped neatly below the kanji!
    ctx.strokeStyle = "rgba(148,46,32,0.78)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= 42; i++) {
      const t = (i / 42) * Math.PI * 4.4;
      const r = 2 + t * 1.9;
      const px = 128 + Math.cos(t) * r;
      const py = 204 + Math.sin(t) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  return finalizeTexture(canvas, false, true);
}

/** Summoning scroll parchment wrap with bold red-and-black ninja sealing kanji (`封`) & bands. */
function paintScrollWrapTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  if (ctx !== null) {
    ctx.fillStyle = "#dfd2aa";
    ctx.fillRect(0, 0, 256, 256);
    // Bold crimson sealing border bands
    ctx.fillStyle = "#a8241c";
    ctx.fillRect(0, 14, 256, 26);
    ctx.fillRect(0, 216, 256, 26);
    ctx.strokeStyle = "#161210";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 48);
    ctx.lineTo(256, 48);
    ctx.moveTo(0, 208);
    ctx.lineTo(256, 208);
    ctx.stroke();
    // Bold black sealing circle + `封` ("Seal") kanji
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(128, 128, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#161210";
    ctx.font = "900 84px 'Noto Sans JP', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("封", 128, 130);
  }
  return finalizeTexture(canvas, true, true);
}

/** Subtle weathered Konoha Leaf Swirl (`木ノ葉`) stencil painted onto the closed shutter. */
function paintShutterCrestTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  if (ctx !== null) {
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(148,162,138,0.34)";
    ctx.lineWidth = 10;
    drawKonohaLeaf(ctx, 128, 128, 1.05);
  }
  return finalizeTexture(canvas, false, true);
}

/** Konoha village wooden mission notice board (`木ノ葉任務` + `火` / `D-RANK` pinned flyers). */
function paintNoticeBoardTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 192);
  if (ctx !== null) {
    ctx.fillStyle = "#2d2119";
    ctx.fillRect(0, 0, 256, 192);
    ctx.strokeStyle = "#19120e";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 182);

    // Pinned paper notice 1 (cream Konoha mission flyer)
    ctx.fillStyle = "#cfc3a2";
    ctx.fillRect(22, 24, 68, 92);
    ctx.fillStyle = "#8a281d";
    ctx.font = "900 28px 'Noto Sans JP', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("火", 56, 54);
    ctx.fillStyle = "#2a241e";
    ctx.fillRect(32, 78, 48, 5);
    ctx.fillRect(32, 90, 40, 5);
    ctx.fillRect(32, 102, 44, 5);

    // Pinned paper notice 2 (pale yellow `D-RANK` village notice)
    ctx.fillStyle = "#d8ca8c";
    ctx.fillRect(102, 32, 64, 82);
    ctx.fillStyle = "#231e18";
    ctx.font = "800 18px monospace";
    ctx.fillText("D-RANK", 134, 56);
    ctx.fillRect(112, 72, 44, 5);
    ctx.fillRect(112, 84, 38, 5);
    ctx.fillRect(112, 96, 42, 5);

    // Pinned paper notice 3 (tall paper ofuda charm / Konoha swirl flyer)
    ctx.fillStyle = "#d6c8a8";
    ctx.fillRect(178, 22, 54, 118);
    ctx.strokeStyle = "#7a2a20";
    ctx.lineWidth = 3;
    drawKonohaLeaf(ctx, 205, 64, 0.24);
    ctx.fillStyle = "#2b221c";
    ctx.fillRect(188, 96, 34, 5);
    ctx.fillRect(188, 108, 28, 5);
    ctx.fillRect(188, 120, 32, 5);

    // Lower pinned red coupon flyer
    ctx.fillStyle = "#b85c3c";
    ctx.fillRect(34, 128, 122, 42);
    ctx.fillStyle = "#f2e6c4";
    ctx.font = "800 18px 'Noto Sans JP', sans-serif";
    ctx.fillText("一楽 割引券", 95, 150);
  }
  return finalizeTexture(canvas, false, true);
}

function paintKitchenInteriorTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  if (ctx !== null) {
    const grad = ctx.createRadialGradient(256, 152, 18, 256, 136, 275);
    grad.addColorStop(0, "#ffdb7c");
    grad.addColorStop(0.38, "#db7c22");
    grad.addColorStop(0.75, "#783111");
    grad.addColorStop(1, "#220f0b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "rgba(38,14,10,0.84)";
    ctx.fillRect(20, 88, 472, 14);
    ctx.fillRect(20, 160, 472, 16);
    for (let i = 0; i < 6; i++) {
      const bx = 54 + i * 74;
      ctx.beginPath();
      ctx.arc(bx, 84, 18, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(bx - 12, 128, 22, 32);
    }
    ctx.fillStyle = "rgba(255,204,125,0.58)";
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(310 + i * 38, 20, 25, 56);
    }
    const boil = ctx.createRadialGradient(236, 232, 8, 236, 232, 95);
    boil.addColorStop(0, "rgba(255,228,155,0.72)");
    boil.addColorStop(1, "rgba(255,150,45,0)");
    ctx.fillStyle = boil;
    ctx.fillRect(110, 128, 250, 128);
  }
  return finalizeTexture(canvas, false, true);
}

function paintKonohaPlasterTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  if (ctx !== null) {
    const rng = makeRng(3317);
    ctx.fillStyle = "#3c3b36";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 240; i++) {
      const shade = Math.round(44 + rng() * 32);
      ctx.fillStyle = `rgba(${shade},${shade - 2},${shade - 8},0.28)`;
      ctx.fillRect(rng() * 256, rng() * 256, 12 + rng() * 34, 8 + rng() * 24);
    }
    for (let i = 0; i < 65; i++) {
      ctx.fillStyle = "rgba(10,12,18,0.3)";
      ctx.fillRect(rng() * 256, 0, 2 + rng() * 3, 256);
    }
    ctx.fillStyle = "#171316";
    ctx.fillRect(0, 0, 16, 256);
    ctx.fillRect(240, 0, 16, 256);
    ctx.fillRect(0, 120, 256, 14);
    ctx.fillRect(0, 238, 256, 18);
  }
  return finalizeTexture(canvas, true, true);
}

/** Properly spaced, cleanly centered wooden A-frame chalk menu board. */
function paintMenuBoardTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 360);
  if (ctx !== null) {
    ctx.fillStyle = "#191c1b";
    ctx.fillRect(0, 0, 256, 360);
    ctx.strokeStyle = "#4d3826";
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, 240, 344);

    ctx.fillStyle = "#ece2c4";
    ctx.font = "800 32px 'Noto Sans JP', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("一楽 献立", 128, 62);

    ctx.strokeStyle = "rgba(236,226,196,0.48)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(34, 94);
    ctx.lineTo(222, 94);
    ctx.stroke();

    const rows = [
      { name: "味噌豚骨", price: "650", y: 142, color: "#ece2c4" },
      { name: "特製叉焼", price: "780", y: 196, color: "#ece2c4" },
      { name: "醤油拉麺", price: "600", y: 250, color: "#ece2c4" },
      { name: "替玉・大盛", price: "+100", y: 304, color: "#e89c52" },
    ];
    ctx.font = "700 24px 'Noto Sans JP', sans-serif";
    for (const r of rows) {
      ctx.fillStyle = r.color;
      ctx.textAlign = "left";
      ctx.fillText(r.name, 34, r.y);
      ctx.textAlign = "right";
      ctx.fillText(r.price, 222, r.y);
    }
  }
  return finalizeTexture(canvas, false, true);
}

/** Cleanly spaced Konoha Chakra-Charger HUD screen (`木ノ葉 78%`) with generous bezel-safe padding. */
function paintChargeScreenTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(288, 144);
  if (ctx !== null) {
    ctx.fillStyle = "#081920";
    ctx.fillRect(0, 0, 288, 144);
    ctx.strokeStyle = "#4cd8e6";
    ctx.lineWidth = 5;
    traceRoundedRect(ctx, { x: 18, y: 16, w: 252, h: 112, r: 10 });
    ctx.stroke();

    // Konoha Hidden Leaf emblem centered cleanly inside the safe margin
    ctx.strokeStyle = "#7cf2ff";
    ctx.lineWidth = 7;
    drawKonohaLeaf(ctx, 68, 72, 0.34);

    // Evenly aligned label + 5 segmented charge bars cleanly inside x = 114..254
    ctx.fillStyle = "#92f6ff";
    ctx.font = "800 22px 'Noto Sans JP', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("木ノ葉 78%", 114, 49);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < 4 ? "#4ce8f5" : "#183e46";
      ctx.fillRect(114 + i * 28, 74, 21, 32);
    }
  }
  return finalizeTexture(canvas, false, true);
}

function paintVendingTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(192, 256);
  if (ctx !== null) {
    ctx.fillStyle = "#162028";
    ctx.fillRect(0, 0, 192, 256);
    const winGrad = ctx.createLinearGradient(0, 18, 0, 146);
    winGrad.addColorStop(0, "#7ab8c4");
    winGrad.addColorStop(1, "#3b6572");
    ctx.fillStyle = winGrad;
    ctx.fillRect(16, 18, 160, 126);
    const rowColors = ["#c45646", "#58967c", "#d6a44c", "#4d7aa8"];
    for (let r = 0; r < 3; r++) {
      ctx.fillStyle = "#1d272e";
      ctx.fillRect(16, 52 + r * 38, 160, 5);
      for (let c = 0; c < 6; c++) {
        ctx.fillStyle = rowColors[(r + c) % rowColors.length] ?? "#58967c";
        ctx.fillRect(24 + c * 24, 28 + r * 38, 14, 22);
      }
    }
    ctx.fillStyle = "#0c1116";
    ctx.fillRect(22, 184, 148, 48);
  }
  return finalizeTexture(canvas, false, true);
}

export interface IchirakuTextures {
  readonly brush: CanvasTexture;
  readonly roofSign: CanvasTexture;
  readonly roofSignDay: CanvasTexture;
  readonly daySky: CanvasTexture;
  readonly poleLantern: CanvasTexture;
  readonly alleyOpen: CanvasTexture;
  readonly alleyBar: CanvasTexture;
  readonly norenPanels: readonly CanvasTexture[];
  readonly scrollWrap: CanvasTexture;
  readonly shutterCrest: CanvasTexture;
  readonly noticeBoard: CanvasTexture;
  readonly kitchenInterior: CanvasTexture;
  readonly konohaPlaster: CanvasTexture;
  readonly menuBoard: CanvasTexture;
  readonly chargeScreen: CanvasTexture;
  readonly vendingFace: CanvasTexture;
  dispose(): void;
}

export function createIchirakuTextures(): IchirakuTextures {
  const brush = paintBrushTexture();
  const roofSign = paintRoofSignTexture();
  const roofSignDay = paintRoofSignDayTexture();
  const daySky = paintDaySkyTexture();
  const poleLantern = paintVerticalSignTexture(
    ["ラ", "ー", "メ", "ン"],
    "#e5ee86",
    "#b8cb54",
    "#1a1714",
  );
  const alleyOpen = paintVerticalSignTexture(["営", "業", "中"], "#e07030", "#a63e18", "#180d0a");
  const alleyBar = paintVerticalSignTexture(["酒", "処"], "#42bcc8", "#207282", "#0b1a20");
  // Authentic 5-panel Ichiraku Ramen noren reading `一` `楽` `ラ` `メ` `ン`!
  const norenChars = ["一", "楽", "ラ", "メ", "ン"] as const;
  const norenPanels = norenChars.map((ch, idx) => paintNorenPanelTexture(ch, 8821 + idx * 173));
  const scrollWrap = paintScrollWrapTexture();
  const shutterCrest = paintShutterCrestTexture();
  const noticeBoard = paintNoticeBoardTexture();
  const kitchenInterior = paintKitchenInteriorTexture();
  const konohaPlaster = paintKonohaPlasterTexture();
  const menuBoard = paintMenuBoardTexture();
  const chargeScreen = paintChargeScreenTexture();
  const vendingFace = paintVendingTexture();
  const all = [
    brush,
    roofSign,
    roofSignDay,
    daySky,
    poleLantern,
    alleyOpen,
    alleyBar,
    ...norenPanels,
    scrollWrap,
    shutterCrest,
    noticeBoard,
    kitchenInterior,
    konohaPlaster,
    menuBoard,
    chargeScreen,
    vendingFace,
  ];
  return {
    brush,
    roofSign,
    roofSignDay,
    daySky,
    poleLantern,
    alleyOpen,
    alleyBar,
    norenPanels,
    scrollWrap,
    shutterCrest,
    noticeBoard,
    kitchenInterior,
    konohaPlaster,
    menuBoard,
    chargeScreen,
    vendingFace,
    dispose: () => {
      for (const tex of all) tex.dispose();
    },
  };
}
