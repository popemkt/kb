/**
 * Dynamic, animated & emissive overlays layered onto the Blender-sculpted
 * `ichiraku.glb` diorama:
 * - Restrained `一楽` neon/enamel sign, shop-side `ラーメン` lantern, A-frame
 *   chalk menu board, real Japanese back-alley signs (`営業中`, `酒処`),
 *   Konoha chakra-charge HUD, and dim far-left vending machine.
 * - 5 individually sagged & fluttering spiral *noren* curtains, 3 varied warm
 *   *chochin* lanterns, 6 rising broth steam plumes, eave drip beads, and 2
 *   tiny lantern-lit cat eyes sheltering under the counter.
 * - Physically clamped smoky lavender hoses on the aquarium charger, 5 swimming
 *   dark fish silhouettes, rising bubbles, low drifting back-alley ground mist,
 *   powerlines anchored cleanly to the edge-framing utility poles, and Hokage
 *   Rock cliff silhouette.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three/webgpu";
import { abs, float, length, mix, sin, smoothstep, texture, uv, vec3 } from "three/tsl";
import { buildDaytimeLife } from "./daytime-life";
import {
  finalizeSceneColor,
  fresnelGlassMaterial,
  groundMistMaterial,
  norenClothMaterial,
  steamWispMaterial,
  type IchirakuUniforms,
} from "./shaders";
import type { IchirakuTextures } from "./textures";

export interface LiveElementsHandle {
  readonly group: Group;
  readonly update: (elapsed: number, writePulse: number, navFlicker: number) => void;
}

function radialGlowCard(
  shared: IchirakuUniforms,
  w: number,
  h: number,
  hex: number,
  strength: number,
): Mesh {
  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  mat.side = DoubleSide;
  const col = new Color(hex);
  const d = length(uv().sub(0.5)).mul(2.0);
  const falloff = smoothstep(1.0, 0.0, d);
  mat.colorNode = vec3(col.r, col.g, col.b);
  mat.opacityNode = falloff
    .mul(falloff)
    .mul(strength)
    .mul(shared.neonAmount)
    .mul(mix(float(1.0), float(0.08), shared.dayLift));
  return new Mesh(new PlaneGeometry(w, h), mat);
}

function buildChochinLantern(shared: IchirakuUniforms, brightness: number): Group {
  const lantern = new Group();
  const bodyMat = new MeshBasicNodeMaterial();
  const y = uv().y;
  const ribs = smoothstep(0.08, 0.28, abs(sin(y.mul(22.0))));
  const coreCol = mix(vec3(0.95, 0.28, 0.05), vec3(1.0, 0.72, 0.24), smoothstep(0.05, 0.85, y));
  // Daytime lanterns read as warm sunlit paper (unlit, zero halo); night lanterns glow fiery orange!
  const nightBody = coreCol
    .mul(ribs.mul(0.42).add(0.58))
    .mul(float(brightness).add(shared.writePulse.mul(0.32)).mul(1.05));
  const dayBody = mix(
    vec3(0.76, 0.28, 0.14),
    vec3(0.92, 0.56, 0.28),
    smoothstep(0.05, 0.85, y),
  ).mul(ribs.mul(0.28).add(0.72));
  bodyMat.colorNode = finalizeSceneColor(shared, nightBody, dayBody);

  const capMat = new MeshBasicNodeMaterial();
  capMat.colorNode = vec3(0.07, 0.05, 0.08);
  const body = new Mesh(new SphereGeometry(0.18, 14, 12), bodyMat);
  body.scale.set(0.84, 1.32, 0.84);
  const topCap = new Mesh(new CylinderGeometry(0.1, 0.12, 0.055, 10), capMat);
  topCap.position.y = 0.23;
  const botCap = new Mesh(new CylinderGeometry(0.11, 0.09, 0.055, 10), capMat);
  botCap.position.y = -0.23;
  const cord = new Mesh(new CylinderGeometry(0.009, 0.009, 0.16, 6), capMat);
  cord.position.y = 0.31;
  const halo = radialGlowCard(shared, 1.05, 1.25, 0xff6e24, 0.2 * brightness);
  halo.position.z = -0.06;
  lantern.add(body, topCap, botCap, cord, halo);
  return lantern;
}

function addIchirakuCounterDetails(
  group: Group,
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): (elapsed: number) => void {
  // Chalk menu board face mounted cleanly parallel & 1.5cm proud of the wooden A-frame from top to bottom!
  const menuMat = new MeshBasicNodeMaterial();
  const menuTex = texture(textures.menuBoard, uv()).rgb;
  menuMat.colorNode = finalizeSceneColor(shared, menuTex.mul(0.76), menuTex.mul(0.95));
  const menuFace = new Mesh(new PlaneGeometry(0.46, 0.74), menuMat);
  menuFace.rotation.order = "YXZ";
  menuFace.rotation.set(-0.14, 0.34, 0);
  menuFace.position.set(-2.104, 0.415, 1.064);
  group.add(menuFace);

  // Cute eyes on Naruto's green Gama-chan frog coin purse resting on the counter!
  const gamaEyeMat = new MeshBasicNodeMaterial();
  gamaEyeMat.colorNode = finalizeSceneColor(shared, vec3(0.92, 0.92, 0.88), vec3(0.92, 0.92, 0.88));
  for (const gx of [0.15, 0.21]) {
    const ge = new Mesh(new SphereGeometry(0.011, 6, 6), gamaEyeMat);
    ge.position.set(gx, 1.155, 0.685);
    group.add(ge);
  }

  // Two tiny warm lantern-lit eyes on the curled alley cat sheltering dry under the counter!
  const eyeMat = new MeshBasicNodeMaterial();
  eyeMat.colorNode = vec3(1.0, 0.82, 0.35).mul(mix(float(1.0), float(0.4), shared.dayLift));
  for (const ex of [-0.025, 0.025]) {
    const eye = new Mesh(new SphereGeometry(0.012, 6, 6), eyeMat);
    eye.position.set(0.46 + ex, 0.23, 0.99);
    group.add(eye);
  }

  // Animated water droplets dripping steadily off the curved *kawara* roof eave!
  const dripCount = 18;
  const dripMat = new MeshBasicNodeMaterial();
  dripMat.transparent = true;
  dripMat.depthWrite = false;
  dripMat.colorNode = mix(vec3(0.75, 0.86, 0.64), vec3(0.72, 0.78, 0.84), shared.dayLift);
  dripMat.opacityNode = float(0.42)
    .mul(shared.rainAmount.clamp(0, 1.5))
    .mul(mix(float(1.0), float(0.0), shared.dayLift));
  const drips = new InstancedMesh(new PlaneGeometry(0.014, 0.14), dripMat, dripCount);
  group.add(drips);
  const dummy = new Object3D();
  const updateDrips = (elapsed: number) => {
    for (let i = 0; i < dripCount; i++) {
      const seed = i * 0.618;
      const t = (((elapsed * (0.72 + (i % 4) * 0.14) + seed) % 1) + 1) % 1;
      const x = -2.05 + (i / (dripCount - 1)) * 4.1;
      const y = 2.46 - t * t * 2.42;
      dummy.position.set(x, y, 1.32);
      dummy.scale.set(1, 0.5 + t * 0.9, 1);
      dummy.updateMatrix();
      drips.setMatrixAt(i, dummy.matrix);
    }
    drips.instanceMatrix.needsUpdate = true;
  };
  updateDrips(4.2);
  return updateDrips;
}

function buildIchirakuOverlays(
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): {
  readonly group: Group;
  readonly lanterns: readonly { readonly mesh: Group; readonly phase: number }[];
  readonly updateDrips: (elapsed: number) => void;
} {
  const group = new Group();
  group.position.set(-1.55, 0, -1.75);
  group.rotation.y = 0.24;

  // Warm golden Ichiraku kitchen interior (the single primary warm hero in both dark & light mode).
  const kitchenMat = new MeshBasicNodeMaterial();
  const kitchenTex = texture(textures.kitchenInterior, uv()).rgb;
  kitchenMat.colorNode = finalizeSceneColor(
    shared,
    kitchenTex.mul(float(1.12).add(shared.writePulse.mul(0.32))),
    kitchenTex.mul(0.86),
  );
  const kitchen = new Mesh(new PlaneGeometry(3.26, 1.34), kitchenMat);
  kitchen.position.set(0, 1.63, -0.71);
  group.add(kitchen);

  // 5 individually sagged & fluttering authentic Ichiraku *noren* curtains (`一` `楽` `ラ` `メ` `ン`).
  const norenSag = [0.014, 0.026, 0.018, 0.031, 0.02];
  for (let i = 0; i < 5; i++) {
    const tex = textures.norenPanels[i] ?? textures.norenPanels[0];
    if (tex === undefined) continue;
    const mat = norenClothMaterial(shared, tex, i * 1.17, norenSag[i] ?? 0.02);
    const cloth = new Mesh(new PlaneGeometry(0.57, 0.74, 4, 8), mat);
    cloth.position.set(-1.26 + i * 0.63, 1.79, 0.79);
    group.add(cloth);
  }

  // 2 classic flanking *chochin* lanterns on the left & right posts, keeping all 5 `一 楽 ラ メ ン` noren unobstructed!
  const lanternSpecs = [
    { x: -1.68, b: 1.02, phase: 0.2 },
    { x: 1.68, b: 0.94, phase: 2.6 },
  ];
  const lanterns = lanternSpecs.map((spec) => {
    const l = buildChochinLantern(shared, spec.b);
    l.position.set(spec.x, 1.86, 0.92);
    group.add(l);
    return { mesh: l, phase: spec.phase };
  });

  // 6 drifting warm-lit broth steam plumes curling out from behind the *noren* & steaming bowl!
  for (let i = 0; i < 6; i++) {
    const wisp = new Mesh(
      new PlaneGeometry(0.48 + (i % 3) * 0.14, 0.92 + (i % 2) * 0.22),
      steamWispMaterial(shared, i * 0.78),
    );
    wisp.position.set(-0.98 + i * 0.42, 1.56 + (i % 2) * 0.14, 0.56 + (i % 2) * 0.12);
    group.add(wisp);
  }

  // `一楽` rooftop sign: restrained chartreuse neon at midnight, sunlit ivory-and-crimson Konoha wooden board by day!
  const signMat = new MeshBasicNodeMaterial();
  const signTex = texture(textures.roofSign, uv()).rgb;
  const signDayTex = texture(textures.roofSignDay, uv()).rgb;
  const flicker = float(1.0).sub(shared.navFlicker.mul(0.2));
  const nightSign = signTex
    .mul(float(1.06).add(shared.writePulse.mul(0.28)))
    .mul(flicker)
    .mul(shared.neonAmount);
  const daySign = signDayTex.mul(0.95);
  signMat.colorNode = finalizeSceneColor(shared, nightSign, daySign);
  const signMesh = new Mesh(new PlaneGeometry(2.58, 1.14), signMat);
  signMesh.position.set(0.18, 3.48, 0.31);
  const signHalo = radialGlowCard(shared, 4.4, 2.35, 0xc8e83c, 0.18);
  signHalo.position.set(0.18, 3.48, -0.04);
  group.add(signMesh, signHalo);

  const updateDrips = addIchirakuCounterDetails(group, shared, textures);
  return { group, lanterns, updateDrips };
}

function buildKoshiWindow(
  shared: IchirakuUniforms,
  w: number,
  h: number,
  slats: number,
  warmth: number,
): Group {
  const win = new Group();
  const shojiMat = new MeshBasicNodeMaterial();
  const nightShoji = vec3(0.9 * warmth, 0.58 * warmth, 0.25 * warmth).mul(shared.neonAmount);
  const dayShoji = vec3(0.84, 0.8, 0.72);
  shojiMat.colorNode = finalizeSceneColor(shared, nightShoji, dayShoji);
  win.add(new Mesh(new PlaneGeometry(w, h), shojiMat));

  const slatMat = new MeshBasicNodeMaterial();
  slatMat.colorNode = finalizeSceneColor(shared, vec3(0.07, 0.055, 0.065), vec3(0.32, 0.22, 0.18));
  const topBar = new Mesh(new BoxGeometry(w + 0.14, 0.08, 0.08), slatMat);
  topBar.position.set(0, h * 0.5 + 0.03, 0.03);
  const botBar = new Mesh(new BoxGeometry(w + 0.14, 0.08, 0.08), slatMat);
  botBar.position.set(0, -h * 0.5 - 0.03, 0.03);
  const midBar = new Mesh(new BoxGeometry(w + 0.04, 0.045, 0.06), slatMat);
  midBar.position.set(0, 0, 0.03);
  win.add(topBar, botBar, midBar);

  for (let i = 0; i <= slats; i++) {
    const sx = -w * 0.5 + (i / slats) * w;
    const bar = new Mesh(new BoxGeometry(0.034, h + 0.06, 0.055), slatMat);
    bar.position.set(sx, 0, 0.03);
    win.add(bar);
  }
  return win;
}

function addSkyAndMist(group: Group, shared: IchirakuUniforms, textures: IchirakuTextures): void {
  const mistSpecs = [
    { x: 1.8, y: 0.95, z: -5.4, w: 5.8, h: 2.1, phase: 0.0 },
    { x: 6.5, y: 1.05, z: -4.2, w: 4.4, h: 2.0, phase: 2.3 },
  ];
  for (const m of mistSpecs) {
    const plane = new Mesh(new PlaneGeometry(m.w, m.h), groundMistMaterial(shared, m.phase));
    plane.position.set(m.x, m.y, m.z);
    group.add(plane);
  }

  // Sunny Konoha cerulean-and-cumulus daytime sky backdrop physically BEHIND the 3D sculpted Hokage Mountain!
  const daySkyMat = new MeshBasicNodeMaterial();
  daySkyMat.transparent = true;
  daySkyMat.depthWrite = false;
  const skyTex = texture(textures.daySky, uv()).rgb;
  const skySideFade = smoothstep(0.0, 0.16, uv().x).mul(smoothstep(1.0, 0.84, uv().x));
  daySkyMat.colorNode = shared.paint(skyTex);
  daySkyMat.opacityNode = shared.dayLift.mul(skySideFade).mul(0.98);
  const daySkyCard = new Mesh(new PlaneGeometry(42, 16), daySkyMat);
  daySkyCard.position.set(0.8, 6.2, -16.8);
  daySkyCard.renderOrder = -3;
  group.add(daySkyCard);
}

/** Canonical overhead powerline spans — shared with `daytime-life.ts` so perched sparrows sit flush on the wire. */
const WIRE_SPANS: readonly (readonly [Vector3, Vector3, Vector3])[] = [
  [new Vector3(-9.85, 4.95, 1.45), new Vector3(-0.6, 3.98, -0.3), new Vector3(8.25, 4.95, 1.65)],
  [new Vector3(-9.55, 4.72, 1.45), new Vector3(0.2, 3.74, -0.9), new Vector3(7.95, 4.72, 1.65)],
  [new Vector3(-9.85, 4.95, 1.45), new Vector3(-4.2, 4.25, -2.5), new Vector3(2.8, 4.45, -5.4)],
  [new Vector3(8.25, 4.95, 1.65), new Vector3(4.6, 4.22, -2.2), new Vector3(1.2, 4.12, -6.2)],
];

function buildAlleyOverlays(
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): { readonly group: Group; readonly frontWire: CatmullRomCurve3 } {
  const group = new Group();

  // Relocated `ラーメン` lantern cleanly outside Ichiraku's tiled roof eave (zero clipping!).
  const poleSignMat = new MeshBasicNodeMaterial();
  const poleTex = texture(textures.poleLantern, uv()).rgb;
  poleSignMat.colorNode = finalizeSceneColor(
    shared,
    poleTex.mul(1.02).mul(shared.neonAmount),
    poleTex.mul(0.92),
  );
  const poleSignFace = new Mesh(new PlaneGeometry(0.36, 0.86), poleSignMat);
  poleSignFace.position.set(-4.22, 2.68, -1.05);
  const poleHalo = radialGlowCard(shared, 1.5, 1.85, 0xd0e848, 0.14);
  poleHalo.position.set(-4.22, 2.68, -1.18);
  group.add(poleSignFace, poleHalo);

  // Subtle dim Japanese drink vending machine tucked cleanly against House 3's left facade.
  const vendMat = new MeshBasicNodeMaterial();
  const vendTex = texture(textures.vendingFace, uv()).rgb;
  vendMat.colorNode = finalizeSceneColor(
    shared,
    vendTex.mul(0.55).mul(shared.neonAmount),
    vendTex.mul(0.9),
  );
  const vendFace = new Mesh(new PlaneGeometry(0.94, 1.58), vendMat);
  vendFace.position.set(-8.45, 1.12, -1.57);
  const vendHalo = radialGlowCard(shared, 1.85, 2.0, 0x56a8b8, 0.09);
  vendHalo.position.set(-8.45, 1.15, -1.5);
  group.add(vendFace, vendHalo);

  // Subtle weathered Konoha Leaf Swirl (`木ノ葉`) stencil painted on the closed left shop shutter!
  const crestMat = new MeshBasicNodeMaterial();
  crestMat.transparent = true;
  crestMat.depthWrite = false;
  const crestTex = texture(textures.shutterCrest, uv());
  crestMat.colorNode = finalizeSceneColor(shared, crestTex.rgb.mul(0.85), vec3(0.22, 0.34, 0.26));
  crestMat.opacityNode = crestTex.a.mul(mix(float(0.65), float(0.62), shared.dayLift));
  const crestCard = new Mesh(new PlaneGeometry(1.45, 1.45), crestMat);
  crestCard.position.set(-5.5, 1.38, -2.14);
  group.add(crestCard);

  // Konoha village mission notice board centered cleanly between pillar (-7.82) and shutter (-6.82)!
  const noticeMat = new MeshBasicNodeMaterial();
  const noticeTex = texture(textures.noticeBoard, uv()).rgb;
  noticeMat.colorNode = finalizeSceneColor(shared, noticeTex.mul(0.58), noticeTex.mul(0.94));
  const noticeFace = new Mesh(new PlaneGeometry(0.78, 0.58), noticeMat);
  noticeFace.position.set(-7.3, 1.56, -2.12);
  group.add(noticeFace);

  // Quiet dim upstairs *koshi* window on the right corner house + hokora candle!
  const koshiHolder = new Group();
  koshiHolder.position.set(5.35, 0, -3.25);
  koshiHolder.rotation.y = -0.1;
  const rightFrontWin = buildKoshiWindow(shared, 1.32, 0.86, 8, 0.34);
  rightFrontWin.position.set(0.05, 3.82, 1.72);
  koshiHolder.add(rightFrontWin);
  group.add(koshiHolder);

  // Tiny dim candle glint tucked inside the roadside *hokora* shrine beside House 4.
  const candleMat = new MeshBasicNodeMaterial();
  candleMat.colorNode = vec3(1.0, 0.68, 0.25).mul(sin(shared.time.mul(6.2)).mul(0.15).add(0.85));
  const candle = new Mesh(new SphereGeometry(0.03, 8, 6), candleMat);
  candle.position.set(7.62, 1.12, -1.04);
  group.add(candle);

  // Real painted Japanese back-alley signs (`営業中` staggered cleanly in the alley gap & `酒処` above it!).
  const openMat = new MeshBasicNodeMaterial();
  const openTex = texture(textures.alleyOpen, uv()).rgb;
  openMat.colorNode = finalizeSceneColor(
    shared,
    openTex.mul(0.95).mul(shared.neonAmount),
    openTex.mul(0.92),
  );
  const openSign = new Mesh(new PlaneGeometry(0.36, 0.96), openMat);
  openSign.position.set(2.15, 2.02, -5.65);

  const barMat = new MeshBasicNodeMaterial();
  const barTex = texture(textures.alleyBar, uv()).rgb;
  barMat.colorNode = finalizeSceneColor(
    shared,
    barTex.mul(0.88).mul(shared.neonAmount),
    barTex.mul(0.92),
  );
  const barSign = new Mesh(new PlaneGeometry(0.34, 0.92), barMat);
  barSign.position.set(2.62, 2.88, -4.2);
  group.add(openSign, barSign);

  // Properly anchored catenary powerlines spanning between our far-left & far-right poles and alley roofs!
  const wireMat = new MeshBasicNodeMaterial();
  wireMat.colorNode = finalizeSceneColor(shared, vec3(0.06, 0.07, 0.09), vec3(0.22, 0.25, 0.3));
  const curves = WIRE_SPANS.map(([p0, p1, p2]) => new CatmullRomCurve3([p0, p1, p2]));
  for (const curve of curves) {
    group.add(new Mesh(new TubeGeometry(curve, 26, 0.014, 5, false), wireMat));
  }

  addSkyAndMist(group, shared, textures);
  const frontWire =
    curves[0] ??
    new CatmullRomCurve3([
      new Vector3(-9.85, 4.95, 1.45),
      new Vector3(-0.6, 3.98, -0.3),
      new Vector3(8.25, 4.95, 1.65),
    ]);
  return { group, frontWire };
}

function buildBikeOverlays(shared: IchirakuUniforms): Group {
  const bike = new Group();
  bike.position.set(1.52, 0, -0.32);
  bike.rotation.set(0, 3.74, -0.1);
  bike.scale.setScalar(1.12);

  // Subtle parked headlamp lens glint (NO hard-edged cyan triangle polygon!).
  const lensHalo = radialGlowCard(shared, 0.65, 0.45, 0x4ef6ff, 0.16);
  lensHalo.position.set(0.92, 1.07, 0);
  lensHalo.rotation.y = Math.PI * 0.5;
  bike.add(lensHalo);

  // Fluttering orange Konoha cloth tag tied to the left handlebar.
  const ribbonMat = new MeshBasicNodeMaterial();
  ribbonMat.side = DoubleSide;
  const flap = sin(shared.time.mul(4.5).add(uv().y.mul(4.0)))
    .mul(0.032)
    .mul(float(1.0).sub(uv().y));
  ribbonMat.positionNode = vec3(flap, 0, flap.mul(0.6));
  ribbonMat.colorNode = vec3(0.92, 0.34, 0.08).mul(mix(float(0.88), float(0.75), shared.dayLift));
  const ribbon = new Mesh(new PlaneGeometry(0.055, 0.24, 1, 6), ribbonMat);
  ribbon.position.set(0.42, 1.08, -0.38);
  bike.add(ribbon);

  return bike;
}

function buildFishMesh(mat: MeshBasicNodeMaterial): Group {
  const fish = new Group();
  const body = new Mesh(new SphereGeometry(0.052, 10, 8), mat);
  body.scale.set(1.65, 0.72, 0.45);
  const tail = new Mesh(new PlaneGeometry(0.075, 0.068), mat);
  tail.position.set(-0.095, 0, 0);
  fish.add(body, tail);
  return fish;
}

function addAquariumGlassAndHoses(
  kiosk: Group,
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): void {
  // Recessed glowing Konoha Chakra-Charger HUD screen on pedestal console!
  const panelMat = new MeshBasicNodeMaterial();
  const hudTex = texture(textures.chargeScreen, uv()).rgb;
  panelMat.colorNode = finalizeSceneColor(
    shared,
    hudTex.mul(float(1.05).add(shared.writePulse.mul(0.38))).mul(shared.neonAmount),
    hudTex.mul(0.68),
  );
  const panel = new Mesh(new PlaneGeometry(0.44, 0.22), panelMat);
  panel.position.set(-0.3, 0.68, 0.648);
  panel.rotation.x = -0.28;
  kiosk.add(panel);

  // Layer 1: Restrained aqua coolant liquid + gentle meniscus (no blown white glare!).
  const liquidMat = new MeshBasicNodeMaterial();
  liquidMat.transparent = true;
  liquidMat.depthWrite = false;
  liquidMat.colorNode = mix(vec3(0.03, 0.16, 0.24), vec3(0.14, 0.68, 0.82), uv().y)
    .mul(float(1.0).add(shared.writePulse.mul(0.28)))
    .mul(mix(shared.neonAmount, float(0.45), shared.dayLift));
  liquidMat.opacityNode = float(0.44);
  const liquidCyl = new Mesh(new CylinderGeometry(0.47, 0.47, 1.14, 24), liquidMat);
  liquidCyl.position.y = 1.68;
  liquidCyl.renderOrder = 1;

  const meniscusMat = new MeshBasicNodeMaterial();
  meniscusMat.colorNode = vec3(0.34, 1.05, 1.18).mul(
    mix(shared.neonAmount, float(0.5), shared.dayLift),
  );
  const meniscus = new Mesh(new CylinderGeometry(0.47, 0.47, 0.03, 24), meniscusMat);
  meniscus.position.y = 2.25;
  meniscus.renderOrder = 2;
  kiosk.add(liquidCyl, meniscus);

  // Layer 3: Softened Fresnel glass dome + PHYSICALLY CLAMPED smoky lavender coolant hoses!
  const glassMat = fresnelGlassMaterial(shared, { tint: 0x22a6b8, rim: 0x6ce2ec });
  const glassCyl = new Mesh(new CylinderGeometry(0.52, 0.52, 1.28, 28, 1, true), glassMat);
  glassCyl.position.y = 1.75;
  glassCyl.renderOrder = 4;
  const glassDome = new Mesh(
    new SphereGeometry(0.52, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
    glassMat,
  );
  glassDome.position.y = 2.38;
  glassDome.renderOrder = 4;
  kiosk.add(glassCyl, glassDome);

  // Every hose endpoint locks cleanly into the exact bolted plum socket flanges sculpted in Blender!
  const hoseMat = fresnelGlassMaterial(shared, { tint: 0x5c54b8, rim: 0x9c94dc, isTube: true });
  const hoseCurves = [
    new CatmullRomCurve3([
      new Vector3(-0.42, 1.08, 0.36),
      new Vector3(-0.78, 1.04, 0.56),
      new Vector3(-0.76, 0.78, 0.62),
      new Vector3(-0.44, 0.72, 0.48),
    ]),
    new CatmullRomCurve3([
      new Vector3(0.28, 1.08, 0.48),
      new Vector3(0.08, 0.96, 0.78),
      new Vector3(0.26, 0.72, 0.74),
      new Vector3(0.32, 0.64, 0.48),
    ]),
    new CatmullRomCurve3([
      new Vector3(0.14, 2.9, 0.0),
      new Vector3(0.56, 2.86, -0.14),
      new Vector3(0.74, 1.92, -0.32),
      new Vector3(0.48, 0.78, -0.26),
    ]),
  ];
  for (const curve of hoseCurves) {
    kiosk.add(new Mesh(new TubeGeometry(curve, 24, 0.056, 10, false), hoseMat));
  }

  const tankHalo = radialGlowCard(shared, 2.35, 2.55, 0x26c6da, 0.14);
  tankHalo.position.set(0, 1.85, -0.28);
  kiosk.add(tankHalo);
}

function buildAquariumLive(
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): {
  readonly group: Group;
  readonly updateLife: (elapsed: number, writePulse: number) => void;
} {
  const kiosk = new Group();
  kiosk.position.set(3.42, 0, 1.05);
  kiosk.rotation.y = -0.45;
  addAquariumGlassAndHoses(kiosk, shared, textures);

  const fishMat = new MeshBasicNodeMaterial();
  fishMat.colorNode = vec3(0.015, 0.04, 0.075);
  const fishSpecs = [
    { y: 1.48, r: 0.24, speed: 0.72, phase: 0.2, scale: 1.38 },
    { y: 1.72, r: 0.28, speed: -0.58, phase: 1.8, scale: 1.55 },
    { y: 1.94, r: 0.22, speed: 0.85, phase: 3.1, scale: 1.2 },
    { y: 1.58, r: 0.18, speed: -0.95, phase: 4.4, scale: 1.08 },
    { y: 2.08, r: 0.25, speed: 0.64, phase: 5.5, scale: 1.3 },
  ];
  const fishMeshes = fishSpecs.map((spec) => {
    const m = buildFishMesh(fishMat);
    m.scale.setScalar(spec.scale);
    m.renderOrder = 3;
    kiosk.add(m);
    return m;
  });

  const bubbleCount = 20;
  const bubbleMat = new MeshBasicNodeMaterial();
  bubbleMat.colorNode = vec3(0.62, 1.25, 1.4).mul(
    mix(shared.neonAmount, float(0.55), shared.dayLift),
  );
  const bubbles = new InstancedMesh(new SphereGeometry(0.019, 8, 6), bubbleMat, bubbleCount);
  bubbles.renderOrder = 3;
  kiosk.add(bubbles);

  const dummy = new Object3D();
  const updateLife = (elapsed: number, writePulse: number) => {
    const speedBoost = 1 + writePulse * 1.35;
    fishSpecs.forEach((spec, idx) => {
      const fish = fishMeshes[idx];
      if (fish === undefined) return;
      const angle = elapsed * spec.speed * speedBoost + spec.phase;
      fish.position.set(
        Math.cos(angle) * spec.r,
        spec.y + Math.sin(elapsed * 1.8 + spec.phase) * 0.045,
        Math.sin(angle) * spec.r * 0.78,
      );
      fish.rotation.y = Math.atan2(-Math.cos(angle) * spec.speed, -Math.sin(angle) * spec.speed);
    });
    for (let i = 0; i < bubbleCount; i++) {
      const seed = i * 1.37;
      const rise = (((elapsed * (0.28 + (i % 5) * 0.07) * speedBoost + seed) % 1) + 1) % 1;
      const r = 0.08 + ((i * 29) % 10) * 0.032;
      const a = seed * 3.1 + elapsed * 0.55;
      dummy.position.set(Math.cos(a) * r, 1.15 + rise * 1.1, Math.sin(a) * r);
      dummy.scale.setScalar((0.55 + (i % 4) * 0.25) * (1 - rise * 0.3));
      dummy.updateMatrix();
      bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;
  };
  updateLife(4.2, 0);
  return { group: kiosk, updateLife };
}

export function buildLiveElements(
  shared: IchirakuUniforms,
  textures: IchirakuTextures,
): LiveElementsHandle {
  const group = new Group();
  const stall = buildIchirakuOverlays(shared, textures);
  const alley = buildAlleyOverlays(shared, textures);
  const bike = buildBikeOverlays(shared);
  const aquarium = buildAquariumLive(shared, textures);
  const daytime = buildDaytimeLife(shared, alley.frontWire);
  group.add(stall.group, alley.group, bike, aquarium.group, daytime.group);

  return {
    group,
    update: (elapsed: number, writePulse: number, navFlicker: number) => {
      const swayBoost = 1 + writePulse * 2.2 + navFlicker * 1.5;
      for (const l of stall.lanterns) {
        l.mesh.rotation.z = Math.sin(elapsed * 1.65 + l.phase) * 0.042 * swayBoost;
        l.mesh.rotation.x = Math.cos(elapsed * 1.2 + l.phase) * 0.022 * swayBoost;
      }
      stall.updateDrips(elapsed);
      aquarium.updateLife(elapsed, writePulse);
      daytime.update(elapsed, writePulse);
    },
  };
}
