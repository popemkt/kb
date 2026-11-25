/**
 * Procedural Signed Distance Field (SDF) monospace font atlas for projecting
 * crisp shader code onto 3D surfaces with zero external network dependencies.
 *
 * Printable ASCII (32..126) is rasterised once onto a 16×6 grid and converted
 * to an exact Euclidean SDF using Felzenszwalb & Huttenlocher's linear-time
 * 1D squared-distance transform (horizontal then vertical). In the fragment
 * shader, one bilinear lookup plus `fwidth` screen-space AA yields razor-sharp
 * typography at any curvature or DPR.
 */
import { DataTexture, LinearFilter, NearestFilter, RGBAFormat } from "three/webgpu";
import { CODE_BUFFER_LEN, PRISM_CODE_TEXT, encodeCodeLine } from "./prism-ribbon";

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 6;
const CELL = 64;
/** Distance field spread in atlas texels (half-range either side of edge 0.5). */
const SDF_SPREAD = 6;
const FIRST_CHAR = 32;
const LAST_CHAR = 126;
const INF = 1e20;

/**
 * Exact 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher, 2012).
 * Given `f[0..n-1]`, writes `d[q] = min_p ((q - p)^2 + f[p])` into `out`.
 */
function edt1d(
  f: Float32Array,
  out: Float32Array,
  v: Int32Array,
  z: Float32Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] ?? 0;
    let s = 0;
    while (k >= 0) {
      const vk = v[k] ?? 0;
      const fvk = f[vk] ?? 0;
      s = (fq + q * q - (fvk + vk * vk)) / (2 * (q - vk));
      if (s <= (z[k] ?? -INF)) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? INF) < q) k++;
    const vk = v[k] ?? 0;
    const dx = q - vk;
    out[q] = dx * dx + (f[vk] ?? 0);
  }
}

/**
 * Compute a 2D signed distance field from a binary/antialiased coverage mask
 * (`mask` in `[0, 1]`, size `width * height`), returning normalized `[0, 1]`
 * SDF values where `0.5` is the glyph boundary and `> 0.5` is inside.
 */
export function computeSdfField(
  mask: Float32Array,
  width: number,
  height: number,
  spread: number,
): Uint8Array {
  const total = width * height;
  const maxDim = Math.max(width, height);
  const f = new Float32Array(maxDim);
  const d = new Float32Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float32Array(maxDim + 1);

  const transform = (insidePass: boolean): Float32Array => {
    const grid = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const a = mask[i] ?? 0;
      const on = insidePass ? a >= 0.5 : a < 0.5;
      grid[i] = on ? 0 : INF;
    }
    // Columns
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) f[y] = grid[y * width + x] ?? INF;
      edt1d(f, d, v, z, height);
      for (let y = 0; y < height; y++) grid[y * width + x] = d[y] ?? INF;
    }
    // Rows
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) f[x] = grid[row + x] ?? INF;
      edt1d(f, d, v, z, width);
      for (let x = 0; x < width; x++) grid[row + x] = Math.sqrt(d[x] ?? 0);
    }
    return grid;
  };

  // Distance to outside (for interior pixels) minus distance to inside (for exterior pixels)
  const distOutside = transform(false);
  const distInside = transform(true);
  const out = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const sd = (distOutside[i] ?? 0) - (distInside[i] ?? 0);
    const norm = Math.max(0, Math.min(1, 0.5 + sd / (2 * spread)));
    const byte = Math.round(norm * 255);
    out[i * 4] = byte;
    out[i * 4 + 1] = byte;
    out[i * 4 + 2] = byte;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Rasterise printable ASCII 32..126 into a 16×6 SDF atlas on a 2D canvas. */
function rasteriseAtlasPixels(): {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
} {
  const width = ATLAS_COLS * CELL;
  const height = ATLAS_ROWS * CELL;
  const mask = new Float32Array(width * height);

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : typeof document !== "undefined"
        ? Object.assign(document.createElement("canvas"), { width, height })
        : null;
  const ctx = canvas?.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(CELL * 0.78)}px ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace`;
    for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
      const idx = code - FIRST_CHAR;
      const col = idx % ATLAS_COLS;
      const row = Math.floor(idx / ATLAS_COLS);
      const cx = (col + 0.5) * CELL;
      const cy = (row + 0.52) * CELL;
      ctx.fillText(String.fromCharCode(code), cx, cy);
    }
    const pixels = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < mask.length; i++) {
      mask[i] = (pixels[i * 4 + 3] ?? 0) / 255;
    }
    return { data: computeSdfField(mask, width, height, SDF_SPREAD), width, height };
  }

  // Headless test DOM without 2D canvas support: neutral empty SDF (0 = outside).
  return { data: new Uint8Array(width * height * 4), width, height };
}

export interface SdfFontResources {
  readonly atlas: DataTexture;
  readonly code: DataTexture;
  readonly codeLength: number;
  readonly dispose: () => void;
}

/** Create GPU textures for the procedural monospace SDF atlas and projected shader code line. */
export function createSdfFontResources(text: string = PRISM_CODE_TEXT): SdfFontResources {
  const { data, width, height } = rasteriseAtlasPixels();
  const atlas = new DataTexture(data, width, height, RGBAFormat);
  atlas.minFilter = LinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.generateMipmaps = false;
  atlas.flipY = false;
  atlas.needsUpdate = true;

  const encoded = encodeCodeLine(text);
  const code = new DataTexture(encoded.data, CODE_BUFFER_LEN, 1, RGBAFormat);
  code.minFilter = NearestFilter;
  code.magFilter = NearestFilter;
  code.generateMipmaps = false;
  code.flipY = false;
  code.needsUpdate = true;

  return {
    atlas,
    code,
    codeLength: encoded.length,
    dispose: () => {
      atlas.dispose();
      code.dispose();
    },
  };
}
