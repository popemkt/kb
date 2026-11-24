/**
 * Loads the Blender-sculpted `ichiraku.glb` (18 stylized meshes spanning the
 * extended ultrawide Konoha streetscape with Cycles raytraced vertex Ambient
 * Occlusion baked into `COLOR_0`) and overlays the Blender-extracted interior
 * Grease-Pencil ink creases & cyan accent grooves (`ichiraku-creases.json`).
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  type Material,
} from "three/webgpu";
import { sin, vec3 } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import creasesData from "./ichiraku-creases.json";
import ichirakuGlbUrl from "./ichiraku.glb?url";
import {
  creaseLineMaterial,
  finalizeSceneColor,
  inkOutlineMaterial,
  painterlyCelMaterial,
  type CelOptions,
  type IchirakuUniforms,
} from "./shaders";
import type { IchirakuTextures } from "./textures";

interface CreaseJson {
  readonly ink: readonly number[];
  readonly cyan: readonly number[];
}

/** Hero mesh names that also get a selective dark BackSide inverted-hull silhouette outline. */
const HERO_OUTLINE_WIDTH: Readonly<Record<string, number>> = {
  ichiraku_wood: 0.016,
  ichiraku_dark_timber: 0.016,
  ichiraku_roof: 0.02,
  ichiraku_gamachan: 0.008,
  ichiraku_scarf: 0.01,
  bike_tires: 0.016,
  bike_mech: 0.014,
  bike_fairing: 0.016,
  bike_scrolls: 0.014,
  kiosk_teal: 0.02,
  kiosk_plum: 0.018,
  kiosk_cable: 0.012,
  konoha_pole: 0.018,
};

/** Declarative midnight & sunny-Konoha PBR + cel material roles for every Blender `MAT_*` slot. */
const CEL_ROLES: Readonly<Record<string, Omit<CelOptions, "useVertexAo" | "map" | "mapScale">>> = {
  MAT_stall_wood: {
    base: 0x422b1e,
    shade: 0x120d1a,
    lit: 0x724c30,
    dayBase: 0x945c34,
    dayShade: 0x523936,
    dayLit: 0xc2824c,
    roughness: 0.62,
    clearcoat: 0.16,
    warmRim: 0.65,
    cyanRim: 0.22,
    lanternSpill: 0.78,
  },
  MAT_stall_dark: {
    base: 0x201618,
    shade: 0x0a0812,
    lit: 0x3e2a25,
    dayBase: 0x46322b,
    dayShade: 0x26222c,
    dayLit: 0x64493c,
    roughness: 0.68,
    clearcoat: 0.1,
    warmRim: 0.55,
    cyanRim: 0.2,
    lanternSpill: 0.45,
  },
  MAT_stall_tile: {
    base: 0x162027,
    shade: 0x080c14,
    lit: 0x2f4642,
    dayBase: 0x3d515f,
    dayShade: 0x233344,
    dayLit: 0x5d7686,
    roughness: 0.26,
    metalness: 0.1,
    clearcoat: 0.82,
    warmRim: 1.05,
    cyanRim: 0.36,
    lanternSpill: 0.22,
  },
  MAT_ceramic: {
    base: 0x9b8c6e,
    shade: 0x2e242c,
    lit: 0xd8c9a2,
    dayBase: 0xd6c8a8,
    dayShade: 0x867d76,
    dayLit: 0xf4ead0,
    roughness: 0.18,
    clearcoat: 0.95,
    lanternSpill: 0.72,
  },
  MAT_bike_tire: {
    base: 0x111920,
    shade: 0x05070d,
    lit: 0x223840,
    dayBase: 0x2c333c,
    dayShade: 0x181e28,
    dayLit: 0x46505c,
    roughness: 0.46,
    metalness: 0.04,
    clearcoat: 0.28,
    warmRim: 0.38,
    cyanRim: 0.92,
    lanternSpill: 0.14,
  },
  MAT_bike_slate: {
    base: 0x1d2530,
    shade: 0x090c14,
    lit: 0x3a485a,
    dayBase: 0x4c5868,
    dayShade: 0x2a3444,
    dayLit: 0x707e90,
    roughness: 0.28,
    metalness: 0.82,
    clearcoat: 0.35,
    warmRim: 0.55,
    cyanRim: 0.85,
    lanternSpill: 0.18,
  },
  MAT_bike_olive: {
    base: 0x3f5926,
    shade: 0x121d1d,
    lit: 0x6f943a,
    dayBase: 0x648834,
    dayShade: 0x314a2e,
    dayLit: 0x8eb84a,
    roughness: 0.28,
    metalness: 0.18,
    clearcoat: 0.88,
    warmRim: 0.9,
    cyanRim: 0.98,
    lanternSpill: 0.3,
  },
  MAT_scroll: {
    base: 0x9c9274,
    shade: 0x2e2830,
    lit: 0xd4c89e,
    dayBase: 0xd2c092,
    dayShade: 0x827462,
    dayLit: 0xf2e4be,
    roughness: 0.86,
    sheen: 0.4,
    warmRim: 0.72,
    cyanRim: 0.52,
    lanternSpill: 0.24,
  },
  MAT_naruto_orange: {
    base: 0xb84616,
    shade: 0x2c1114,
    lit: 0xe86e24,
    dayBase: 0xde5c1c,
    dayShade: 0x82301e,
    dayLit: 0xff8632,
    roughness: 0.84,
    sheen: 0.52,
    warmRim: 0.75,
    cyanRim: 0.22,
    lanternSpill: 0.65,
  },
  MAT_kiosk_teal: {
    base: 0x184248,
    shade: 0x08141e,
    lit: 0x31767a,
    dayBase: 0x347c82,
    dayShade: 0x1e4a58,
    dayLit: 0x56adb0,
    roughness: 0.28,
    metalness: 0.28,
    clearcoat: 0.82,
    warmRim: 0.72,
    cyanRim: 0.95,
    lanternSpill: 0.12,
  },
  MAT_kiosk_plum: {
    base: 0x3b224a,
    shade: 0x110a1c,
    lit: 0x663d7a,
    dayBase: 0x6c4684,
    dayShade: 0x3e2a56,
    dayLit: 0x9468ac,
    roughness: 0.28,
    metalness: 0.28,
    clearcoat: 0.82,
    warmRim: 0.68,
    cyanRim: 0.95,
    lanternSpill: 0.1,
  },
  MAT_cable: {
    base: 0x0e1018,
    shade: 0x05060a,
    lit: 0x222834,
    dayBase: 0x2b313a,
    dayShade: 0x161a24,
    dayLit: 0x424a56,
    roughness: 0.42,
    clearcoat: 0.3,
    warmRim: 0.45,
    cyanRim: 0.72,
    lanternSpill: 0.08,
  },
  MAT_konoha_plaster: {
    base: 0x2c302c,
    shade: 0x0c0f18,
    lit: 0x4d524a,
    dayBase: 0xd0c2a8,
    dayShade: 0x7e8a9c,
    dayLit: 0xede2ca,
    roughness: 0.92,
    warmRim: 0.42,
    cyanRim: 0.35,
    lanternSpill: 0.18,
  },
  MAT_hokage_rock: {
    base: 0x323b39,
    shade: 0x111820,
    lit: 0x5b6962,
    dayBase: 0xbba486,
    dayShade: 0x6c7484,
    dayLit: 0xe6cda6,
    roughness: 0.94,
    brushScale: 0.32,
    warmRim: 0.12,
    cyanRim: 0.08,
    lanternSpill: 0.0,
  },
  MAT_konoha_roof: {
    base: 0x151c24,
    shade: 0x080b12,
    lit: 0x2b3b3d,
    dayBase: 0x425666,
    dayShade: 0x253546,
    dayLit: 0x637c8e,
    roughness: 0.3,
    metalness: 0.08,
    clearcoat: 0.72,
    warmRim: 0.55,
    cyanRim: 0.32,
    lanternSpill: 0.08,
  },
  MAT_konoha_pipe: {
    base: 0x202932,
    shade: 0x0b0f18,
    lit: 0x3d5158,
    dayBase: 0x6c7a86,
    dayShade: 0x3d4b5a,
    dayLit: 0x96a6b2,
    roughness: 0.3,
    metalness: 0.78,
    clearcoat: 0.32,
    warmRim: 0.42,
    cyanRim: 0.78,
    lanternSpill: 0.08,
  },
  MAT_konoha_pole: {
    base: 0x221916,
    shade: 0x0a0912,
    lit: 0x403126,
    dayBase: 0x664938,
    dayShade: 0x3a2d2d,
    dayLit: 0x8e684e,
    roughness: 0.74,
    warmRim: 0.32,
    cyanRim: 0.16,
    lanternSpill: 0.14,
  },
  MAT_konoha_foliage: {
    base: 0x111f1b,
    shade: 0x060b0f,
    lit: 0x273e29,
    dayBase: 0x4c823a,
    dayShade: 0x264c3a,
    dayLit: 0x78b24e,
    roughness: 0.76,
    subsurface: 0.58,
    warmRim: 0.52,
    cyanRim: 0.25,
    lanternSpill: 0.08,
  },
};

function buildRoleMaterials(
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): Readonly<Record<string, MeshBasicNodeMaterial>> {
  const cyanEmit = new MeshBasicNodeMaterial();
  const pulse = sin(shared.time.mul(3.0)).mul(0.1).add(1.0).add(shared.writePulse.mul(0.75));
  const nightGlow = vec3(0.32, 1.15, 1.38).mul(pulse).mul(shared.neonAmount);
  const dayGlow = vec3(0.24, 0.54, 0.62);
  cyanEmit.colorNode = finalizeSceneColor(shared, nightGlow, dayGlow);

  const roles: Record<string, MeshBasicNodeMaterial> = { MAT_cyan_emit: cyanEmit };
  for (const [key, opts] of Object.entries(CEL_ROLES)) {
    roles[key] = painterlyCelMaterial(shared, {
      ...opts,
      useVertexAo: true,
      ...(key === "MAT_konoha_plaster" ? { map: textures.konohaPlaster, mapScale: 0.42 } : {}),
      ...(key === "MAT_scroll" ? { map: textures.scrollWrap, mapScale: 1.15 } : {}),
    });
  }
  return roles;
}

function buildCreaseLines(shared: IchirakuUniforms): Group {
  const group = new Group();
  const data = creasesData as CreaseJson;
  if (data.ink.length >= 6) {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(data.ink, 3));
    const mat = creaseLineMaterial(shared, { hex: 0x0c0814, baseOpacity: 0.72 });
    const lines = new LineSegments(geo, mat);
    lines.renderOrder = 5;
    group.add(lines);
  }
  if (data.cyan.length >= 6) {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(data.cyan, 3));
    const mat = creaseLineMaterial(shared, { hex: 0x48dce8, baseOpacity: 0.58, glow: 1.05 });
    const lines = new LineSegments(geo, mat);
    lines.renderOrder = 6;
    group.add(lines);
  }
  return group;
}

function materialNameOf(material: Material | Material[]): string {
  const first = Array.isArray(material) ? material[0] : material;
  return first?.name ?? "";
}

export interface BlenderStageHandle {
  readonly ready: Promise<void>;
  readonly dispose: () => void;
}

function disposeObjectTree(root: Group): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineSegments) {
      geometries.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) materials.add(m);
      } else {
        materials.add(obj.material);
      }
    }
  });
  for (const geo of geometries) geo.dispose();
  for (const mat of materials) mat.dispose();
}

export function loadBlenderStage(
  parent: Group,
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): BlenderStageHandle {
  const roles = buildRoleMaterials(shared, textures);
  const creases = buildCreaseLines(shared);
  parent.add(creases);

  const controller = new AbortController();
  const { signal } = controller;
  const isAborted = (): boolean => signal.aborted;
  const loader = new GLTFLoader();
  const ready = (async () => {
    try {
      const response = await fetch(ichirakuGlbUrl, { signal });
      if (!response.ok || isAborted()) return;
      const buffer = await response.arrayBuffer();
      if (isAborted()) return;
      const gltf = await loader.parseAsync(buffer, "");
      const root = gltf.scene;
      if (isAborted()) {
        disposeObjectTree(root);
        return;
      }
      const toOutline: { readonly mesh: Mesh; readonly width: number }[] = [];
      root.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        const roleKey = materialNameOf(obj.material);
        const replacement = roles[roleKey];
        if (replacement !== undefined) {
          const old = obj.material;
          obj.material = replacement;
          if (Array.isArray(old)) {
            for (const m of old) m.dispose();
          } else {
            old.dispose();
          }
        }
        const outlineWidth = HERO_OUTLINE_WIDTH[obj.name];
        if (outlineWidth !== undefined) {
          toOutline.push({ mesh: obj, width: outlineWidth });
        }
      });
      for (const { mesh, width } of toOutline) {
        const hull = new Mesh(mesh.geometry, inkOutlineMaterial(shared, width));
        hull.renderOrder = -1;
        mesh.add(hull);
      }
      parent.add(root);
    } catch {
      // In non-browser contract tests (`happy-dom`), relative Vite `?url` assets cannot be fetched.
    }
  })();

  return {
    ready,
    dispose: () => {
      controller.abort();
      disposeObjectTree(parent);
      for (const mat of Object.values(roles)) mat.dispose();
    },
  };
}
