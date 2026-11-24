/**
 * Daytime-only living Konoha atmosphere (strictly gated on `shared.dayLift` so
 * midnight dark mode remains untouched):
 * - Warm radiant afternoon sun disc, subtle rotating sunburst corona, and wider
 *   solar atmospheric glow peeking through the alley sky gap above Hokage Rock.
 * - 5 drifting diagonal volumetric god-rays slanting down across the alley,
 *   Ichiraku's roof eave, the Shinobi bike, and the post-shower puddles.
 * - 3 cozy Konoha sparrows perched directly on the overhead powerline (sampled
 *   from the exact CatmullRom curve so their feet rest flush on the wire!).
 * - 24 tumbling green-and-gold Konoha leaves drifting on the afternoon breeze
 *   and 36 shimmering golden dust motes dancing inside the sunbeams.
 */
import {
  type CatmullRomCurve3,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type Vector3,
} from "three/webgpu";
import { length, mix, smoothstep, uv, vec3 } from "three/tsl";
import { sunDiscMaterial, sunRayMaterial, type IchirakuUniforms } from "./shaders";

export interface DaytimeLifeHandle {
  readonly group: Group;
  readonly update: (elapsed: number, writePulse: number) => void;
}

interface PerchedSparrow {
  readonly root: Group;
  readonly head: Group;
  readonly baseY: number;
  readonly phase: number;
}

function createPerchedSparrow(
  bodyMat: MeshBasicNodeMaterial,
  bellyMat: MeshBasicNodeMaterial,
  pos: Vector3,
  facingY: number,
  phase: number,
): PerchedSparrow {
  const root = new Group();
  // Rest feet cleanly on top of the 0.014m-radius powerline!
  const baseY = pos.y + 0.014;
  root.position.set(pos.x, baseY, pos.z);
  root.rotation.y = facingY;

  const torso = new Mesh(new SphereGeometry(0.064, 8, 6), bodyMat);
  torso.scale.set(1.25, 0.96, 0.85);
  torso.position.set(0, 0.056, 0);
  const belly = new Mesh(new SphereGeometry(0.049, 8, 6), bellyMat);
  belly.position.set(0.018, 0.044, 0.018);
  const tail = new Mesh(new PlaneGeometry(0.095, 0.038), bodyMat);
  tail.position.set(-0.088, 0.03, 0);
  tail.rotation.z = -0.45;

  const head = new Group();
  head.position.set(0.052, 0.112, 0);
  const skull = new Mesh(new SphereGeometry(0.043, 8, 6), bodyMat);
  const beak = new Mesh(new PlaneGeometry(0.038, 0.016), bellyMat);
  beak.position.set(0.049, -0.004, 0);
  head.add(skull, beak);

  root.add(torso, belly, tail, head);
  root.renderOrder = 6;
  return { root, head, baseY, phase };
}

function addSunAndRays(group: Group, shared: IchirakuUniforms): void {
  // Afternoon sun physically BEHIND the 3D sculpted Hokage Mountain (z = -16.15 vs mountain z = -12.6, depthTest=true),
  // peeking cleanly above Hokage Mountain's pine-crowned right shoulder!
  const sunDisc = new Mesh(new PlaneGeometry(2.6, 2.6), sunDiscMaterial(shared, false));
  sunDisc.position.set(3.35, 7.62, -16.15);
  sunDisc.renderOrder = -1;

  const sunHalo = new Mesh(new PlaneGeometry(8.8, 6.2), sunDiscMaterial(shared, true));
  sunHalo.position.set(3.3, 7.35, -16.4);
  sunHalo.renderOrder = -2;
  group.add(sunHalo, sunDisc);

  // 5 diagonal volumetric sunbeams slanting down-left through the alley air FROM the sun over the ridge!
  const raySpecs = [
    { x: 1.55, y: 2.95, z: -3.2, w: 1.85, h: 6.4, rotZ: -0.44, phase: 0.4, strength: 0.24 },
    { x: -0.25, y: 2.75, z: -0.65, w: 1.75, h: 6.2, rotZ: -0.48, phase: 1.9, strength: 0.22 },
    { x: 2.55, y: 2.55, z: -0.8, w: 1.45, h: 5.8, rotZ: -0.42, phase: 3.3, strength: 0.22 },
    { x: -4.95, y: 2.95, z: -0.9, w: 1.85, h: 6.2, rotZ: -0.47, phase: 4.7, strength: 0.18 },
    { x: 4.85, y: 2.75, z: 0.2, w: 1.55, h: 5.4, rotZ: -0.43, phase: 5.6, strength: 0.16 },
  ];
  for (const r of raySpecs) {
    const beam = new Mesh(new PlaneGeometry(r.w, r.h), sunRayMaterial(shared, r.phase, r.strength));
    beam.position.set(r.x, r.y, r.z);
    beam.rotation.z = r.rotZ;
    beam.renderOrder = 7;
    group.add(beam);
  }
}

function buildWireSparrows(
  group: Group,
  shared: IchirakuUniforms,
  frontWire: CatmullRomCurve3,
): readonly PerchedSparrow[] {
  const bodyMat = new MeshBasicNodeMaterial();
  bodyMat.transparent = true;
  bodyMat.depthWrite = false;
  bodyMat.side = DoubleSide;
  bodyMat.colorNode = shared.paint(vec3(0.14, 0.17, 0.24));
  bodyMat.opacityNode = shared.dayLift.mul(0.96);

  const bellyMat = new MeshBasicNodeMaterial();
  bellyMat.transparent = true;
  bellyMat.depthWrite = false;
  bellyMat.side = DoubleSide;
  bellyMat.colorNode = shared.paint(vec3(0.78, 0.7, 0.56));
  bellyMat.opacityNode = shared.dayLift.mul(0.96);

  // Sample exact points along the live catenary wire so every sparrow perches cleanly with zero floating!
  const perchSpecs = [
    { t: 0.485, facingY: 0.22, phase: 0.4 },
    { t: 0.505, facingY: -2.88, phase: 2.3 },
    { t: 0.625, facingY: -2.65, phase: 4.1 },
  ];
  const sparrows = perchSpecs.map((spec) =>
    createPerchedSparrow(bodyMat, bellyMat, frontWire.getPoint(spec.t), spec.facingY, spec.phase),
  );
  for (const sp of sparrows) group.add(sp.root);
  return sparrows;
}

function buildLeavesAndMotes(
  group: Group,
  shared: IchirakuUniforms,
): (elapsed: number, writePulse: number) => void {
  const leafCount = 24;
  const leafMat = new MeshBasicNodeMaterial();
  leafMat.transparent = true;
  leafMat.depthWrite = false;
  leafMat.side = DoubleSide;
  const leafShape = smoothstep(
    0.48,
    0.14,
    length(
      uv()
        .sub(0.5)
        .mul(vec3(1.0, 1.55, 1.0).xy),
    ),
  );
  const leafCol = mix(vec3(0.32, 0.62, 0.24), vec3(0.76, 0.84, 0.34), uv().y);
  leafMat.colorNode = shared.paint(leafCol);
  leafMat.opacityNode = leafShape.mul(shared.dayLift).mul(0.88);
  const leaves = new InstancedMesh(new PlaneGeometry(0.15, 0.09), leafMat, leafCount);
  leaves.renderOrder = 6;
  group.add(leaves);

  const moteCount = 36;
  const moteMat = new MeshBasicNodeMaterial();
  moteMat.transparent = true;
  moteMat.depthWrite = false;
  moteMat.side = DoubleSide;
  const moteGlow = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
  moteMat.colorNode = shared.paint(vec3(1.0, 0.96, 0.78));
  moteMat.opacityNode = moteGlow.mul(moteGlow).mul(shared.dayLift).mul(0.72);
  const motes = new InstancedMesh(new PlaneGeometry(0.058, 0.058), moteMat, moteCount);
  motes.renderOrder = 8;
  group.add(motes);

  const dummy = new Object3D();
  const update = (elapsed: number, writePulse: number) => {
    const breeze = 1 + writePulse * 1.45;
    for (let i = 0; i < leafCount; i++) {
      const seed = i * 1.618;
      const cycle = (((elapsed * (0.068 + (i % 4) * 0.014) * breeze + seed) % 1) + 1) % 1;
      const x = 6.2 - cycle * 13.8 + Math.sin(elapsed * 1.1 + seed * 3) * 0.45;
      const y = 5.1 - cycle * 4.2 + Math.cos(elapsed * 1.6 + seed * 2) * 0.28;
      const z = -2.6 + ((i * 37) % 10) * 0.52;
      dummy.position.set(x, y, z);
      dummy.rotation.set(
        elapsed * 1.8 + seed,
        elapsed * 2.3 + seed * 2,
        elapsed * 1.4 + Math.sin(elapsed + seed),
      );
      dummy.scale.setScalar(0.75 + (i % 3) * 0.28);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < moteCount; i++) {
      const seed = i * 2.17;
      const x = -5.6 + ((i * 41) % 23) * 0.52 + Math.sin(elapsed * 0.36 + seed) * 0.42;
      const y = 0.75 + ((i * 29) % 15) * 0.28 + Math.cos(elapsed * 0.45 + seed * 1.3) * 0.22;
      const z = -3.4 + ((i * 19) % 11) * 0.52;
      const twinkle = 0.55 + 0.45 * Math.sin(elapsed * 2.1 + seed * 4.0);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(twinkle);
      dummy.updateMatrix();
      motes.setMatrixAt(i, dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;
  };
  update(4.2, 0);
  return update;
}

export function buildDaytimeLife(
  shared: IchirakuUniforms,
  frontWire: CatmullRomCurve3,
): DaytimeLifeHandle {
  const group = new Group();
  addSunAndRays(group, shared);
  const sparrows = buildWireSparrows(group, shared, frontWire);
  const updateParticles = buildLeavesAndMotes(group, shared);

  const update = (elapsed: number, writePulse: number) => {
    const active = shared.dayLift.value > 0.01;
    group.visible = active;
    if (!active) return;

    for (const sp of sparrows) {
      const hop = Math.max(0, Math.sin(elapsed * 1.9 + sp.phase) - 0.82) * 0.22;
      sp.root.position.y = sp.baseY + hop;
      sp.head.rotation.y = Math.sin(elapsed * 2.4 + sp.phase * 2) * 0.45;
      sp.head.rotation.z = Math.cos(elapsed * 1.6 + sp.phase) * 0.16;
    }

    updateParticles(elapsed, writePulse);
  };
  update(4.2, 0);

  return { group, update };
}
