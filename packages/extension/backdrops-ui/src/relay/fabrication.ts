import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type XYZ = [number, number, number];
const origin: XYZ = [0, 0, 0];
const unit: XYZ = [1, 1, 1];

/** Fabricate a rigid assembly in its own coordinates. All pieces of a finish
 * share a draw call. Moving parts get their own assembly and hinge. */
export function assembly(parent: Group, draw: (parts: ReturnType<typeof stock>) => void) {
  const group = new Group();
  const batches = new Map<Material, BufferGeometry[]>();
  const parts = stock(batches);
  draw(parts);
  for (const [finish, pieces] of batches) {
    const geometry = mergeGeometries(pieces);
    group.add(new Mesh(geometry, finish));
    for (const piece of pieces) piece.dispose();
  }
  parent.add(group);
  return group;
}

function stock(batches: Map<Material, BufferGeometry[]>) {
  function piece(
    geometry: BufferGeometry,
    material: Material,
    at: XYZ,
    size: XYZ = unit,
    angles: XYZ = origin,
  ) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...at),
        new Quaternion().setFromEuler(new Euler(...angles)),
        new Vector3(...size),
      ),
    );
    const batch = batches.get(material);
    if (batch) batch.push(flat);
    else batches.set(material, [flat]);
  }
  return {
    box(at: XYZ, size: XYZ, m: Material, angles: XYZ = origin) {
      piece(new BoxGeometry(), m, at, size, angles);
    },
    casting(at: XYZ, size: XYZ, r: number, m: Material) {
      piece(new RoundedBoxGeometry(...size, 2, r), m, at);
    },
    drum(at: XYZ, size: XYZ, m: Material, angles: XYZ = origin) {
      piece(new CylinderGeometry(1, 1, 1, 32), m, at, size, angles);
    },
    oval(at: XYZ, size: XYZ, m: Material) {
      piece(new SphereGeometry(1, 32, 20), m, at, size);
    },
    turned(at: XYZ, profile: readonly [number, number][], m: Material) {
      piece(
        new LatheGeometry(
          profile.map(([r, y]) => new Vector2(r, y)),
          56,
        ),
        m,
        at,
      );
    },
    tube(points: XYZ[], radius: number, m: Material, segments = 28) {
      const path = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
      piece(new TubeGeometry(path, segments, radius, 8, false), m, origin);
    },
  };
}
export type Parts = ReturnType<typeof stock>;
