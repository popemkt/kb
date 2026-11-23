import { CatmullRomCurve3, Vector3, type Group } from "three/webgpu";
import { assembly, type Parts, type XYZ } from "./fabrication";
import type { Finishes } from "./finishes";
import { seededRng } from "../scene/rng";

/** The sign is bent fluorescent tubing stood off the fascia. Coordinates are
 * the centreline of each tube, including the counters of D and E. */
function tideSign(p: Parts, f: Finishes) {
  const strokes: number[][][] = [
    [
      [0, 1],
      [0.69, 1],
    ],
    [
      [0.345, 1],
      [0.345, 0],
    ],
    [
      [0.89, 1],
      [1.16, 1],
    ],
    [
      [1.025, 1],
      [1.025, 0],
    ],
    [
      [0.89, 0],
      [1.16, 0],
    ],
    [
      [1.43, 0],
      [1.43, 1],
    ],
    [
      [1.44, 1],
      [1.79, 0.98],
      [2.05, 0.72],
      [2.05, 0.26],
      [1.8, 0.02],
      [1.46, 0],
    ],
    [
      [2.9, 1],
      [2.33, 1],
    ],
    [
      [2.33, 1],
      [2.33, 0],
    ],
    [
      [2.33, 0.52],
      [2.82, 0.52],
    ],
    [
      [2.33, 0],
      [2.9, 0],
    ],
  ];
  for (const stroke of strokes) {
    const path: XYZ[] = stroke.map(([x = 0, y = 0]) => [-4.2 + x * 0.67, 2.53 + y * 0.57, -2.15]);
    p.tube(path, 0.03, f.sign, Math.max(3, path.length * 3));
  }
}

export const EAVE_LAMPS = [-4.87, -1.91] as const;

function station(p: Parts, f: Finishes) {
  p.box([-3.35, 0.12, -3], [4.68, 0.24, 2.0], f.stone);
  p.box([-3.35, 1.49, -3.8], [4.38, 2.58, 1.15], f.bricks);
  p.box([-3.35, 2.38, -3.12], [4.7, 0.16, 1.62], f.roofing, [0.105, 0, 0]);
  p.box([-3.35, 2.81, -2.29], [3.88, 0.88, 0.17], f.green);
  p.box([-3.35, 2.43, -2.27], [4.05, 0.065, 0.29], f.gold);
  tideSign(p, f);
  // A warm practical beneath the eave puts a thin highlight on the wet fascia.
  for (const x of EAVE_LAMPS) {
    p.casting([x, 2.27, -2.52], [0.56, 0.082, 0.19], 0.025, f.dark);
    p.casting([x, 2.235, -2.48], [0.45, 0.042, 0.115], 0.015, f.workLight);
  }
  for (let i = 0; i < 4; i++) {
    const x = -4.96 + i * 1.06;
    p.box([x, 1.32, -3.15], [0.91, 1.55, 0.12], f.dark);
    p.box([x, 1.35, -3.07], [0.78, 1.35, 0.055], i === 1 ? f.farWindow : f.litPane);
    // Bottles, hanging notices and a tide chart break the shop light into silhouettes.
    if (i !== 1) {
      for (let j = 0; j < 6; j++) {
        const bx = x - 0.31 + j * 0.115,
          h = 0.09 + ((i + j * 3) % 4) * 0.048;
        p.box([bx, 0.93 + h / 2, -2.992], [0.08, h, 0.045], j % 3 === 0 ? f.copper : f.green);
        p.box([bx, 0.93 + h + 0.017, -2.992], [0.04, 0.039, 0.033], f.dark);
      }
      p.box([x, 0.917, -2.986], [0.79, 0.032, 0.058], f.dark);
      p.box([x - 0.19, 1.52, -2.982], [0.22, 0.27, 0.018], i === 0 ? f.red : f.paper, [0, 0, 0.05]);
      for (let j = 0; j < 4; j++)
        p.box(
          [x - 0.2, 1.58 - j * 0.048, -2.968],
          [j % 2 === 0 ? 0.13 : 0.09, 0.015, 0.01],
          f.dark,
        );
    } else {
      p.box([x, 0.86, -2.981], [0.72, 0.29, 0.024], f.green);
      // An anglepoise lamp at the keeper’s desk silhouettes against its own light.
      p.oval([x + 0.18, 1.025, -2.94], [0.115, 0.025, 0.06], f.dark);
      p.tube(
        [
          [x + 0.18, 1.025, -2.94],
          [x + 0.27, 1.26, -2.94],
          [x + 0.085, 1.43, -2.94],
        ],
        0.021,
        f.dark,
      );
      p.turned(
        [x + 0.075, 1.34, -2.95],
        [
          [0.135, 0],
          [0.13, 0.025],
          [0.055, 0.1],
          [0.027, 0.108],
        ],
        f.green,
      );
      p.oval([x + 0.075, 1.335, -2.94], [0.105, 0.021, 0.055], f.farWindow);
    }
    p.box([x, 1.4, -3.02], [0.024, 1.37, 0.021], f.green);
    p.box([x, 1.67, -3.01], [0.8, 0.035, 0.026], f.green);
    for (let j = 0; j < 3; j++) p.box([x, 1.91 - j * 0.069, -2.995], [0.83, 0.022, 0.035], f.gold);
  }
  for (const x of [-5.37, -1.28]) p.box([x, 1.25, -2.44], [0.083, 2.5, 0.085], f.green);
  for (const y of [0.46, 0.65, 0.76]) p.box([-3.73, y, -2.51], [1.5, 0.056, 0.15], f.dark);
  for (const x of [-4.31, -3.15]) p.box([x, 0.22, -2.51], [0.066, 0.45, 0.096], f.green);
}

function powerLines(p: Parts, f: Finishes) {
  for (const x of [-5.95, 0.08, 5.9]) {
    p.drum([x, 2.05, -4.65], [0.072, 4.1, 0.072], f.dark);
    p.box([x, 3.75, -4.65], [1.04, 0.09, 0.1], f.green);
    for (const dx of [-0.38, 0, 0.38]) {
      for (const y of [3.85, 3.92, 3.99])
        p.drum([x + dx, y, -4.65], [0.071, 0.035, 0.071], f.ceramic);
    }
  }
  for (const dx of [-0.38, 0, 0.38]) {
    p.tube(
      [
        [-8 + dx, 4.18, -4.6],
        [-5.95 + dx, 4, -4.65],
        [-3 + dx, 3.39, -4.55],
        [0.08 + dx, 4, -4.65],
      ],
      0.014,
      f.dark,
      34,
    );
    p.tube(
      [
        [0.08 + dx, 4, -4.65],
        [2.7 + dx, 3.49, -4.53],
        [5.9 + dx, 4, -4.65],
      ],
      0.014,
      f.dark,
      28,
    );
  }
}

function quay(p: Parts, f: Finishes) {
  // Receding curb with chipped yellow safety stripes and a tide ladder.
  p.box([2.05, 0.025, -0.14], [3.25, 0.12, 1.56], f.stone);
  for (let i = 0; i < 11; i++)
    p.box([0.6 + i * 0.29, 0.096, 0.563], [0.16, 0.012, 0.13], f.gold, [0, 0.36, 0]);
  for (const x of [0.47, 3.61]) {
    p.turned(
      [x, 0, -0.86],
      [
        [0.13, 0],
        [0.11, 0.06],
        [0.072, 0.09],
        [0.067, 0.52],
        [0.09, 0.56],
        [0.091, 0.62],
        [0.03, 0.65],
      ],
      f.green,
    );
  }
  p.tube(
    [
      [0.47, 0.54, -0.86],
      [1.36, 0.3, -0.9],
      [2.44, 0.28, -0.9],
      [3.61, 0.54, -0.86],
    ],
    0.022,
    f.dark,
  );
  p.tube(
    [
      [2.24, 1.59, -0.15],
      [2.71, 0.98, -0.11],
      [3.09, 0.91, -0.12],
      [3.52, 1.23, -0.1],
      [3.84, 2.24, 0.04],
    ],
    0.04,
    f.dark,
  );
  const profile: [number, number][] = [
    [0.24, 0],
    [0.22, 0.06],
    [0.17, 0.085],
    [0.13, 0.24],
    [0.16, 0.35],
    [0.22, 0.38],
    [0.22, 0.44],
    [0.15, 0.466],
  ];
  p.box([-2.62, -0.085, -0.19], [3.47, 0.18, 1.17], f.stone, [0, -0.35, 0]);
  for (let i = 0; i < 5; i++)
    p.box(
      [-3.76 + i * 0.48, 0.006, -0.606 + i * 0.175],
      [0.016, 0.003, 1.15],
      f.dark,
      [0, -0.35, 0],
    );
  p.turned([-1.18, -0.03, 0.22], profile, f.green);
  p.turned([-2.02, -0.03, -0.46], profile, f.green);
  mooringLine(p, f);
}
function mooringLine(p: Parts, f: Finishes) {
  const path = new CatmullRomCurve3([
    new Vector3(-1.18, 0.27, 0.23),
    new Vector3(-1.49, 0.06, 0.14),
    new Vector3(-1.86, 0.085, -0.24),
    new Vector3(-2.02, 0.3, -0.46),
  ]);
  const segments = 64;
  const axes = path.computeFrenetFrames(segments, false);
  for (let strand = 0; strand < 3; strand++) {
    const points: XYZ[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments,
        angle = 2 * Math.PI * (6 * t + strand / 3);
      const at = path.getPointAt(t);
      const n = axes.normals[i],
        b = axes.binormals[i];
      if (n && b)
        at.addScaledVector(n, 0.021 * Math.cos(angle)).addScaledVector(b, 0.021 * Math.sin(angle));
      points.push([at.x, at.y, at.z]);
    }
    p.tube(points, 0.024, f.hemp, segments);
  }
}

function skyline(p: Parts, f: Finishes) {
  const rng = seededRng(93);
  for (let i = 0; i < 20; i++) {
    const x = i * 1.12 - 11,
      h = rng.range(0.91, 2.6),
      w = rng.range(0.74, 1.3),
      z = rng.range(-10, -8);
    p.box([x, h / 2, z], [w, h, 1.05], f.slate);
    p.box([x - 0.2 * w, h + 0.14 * w, z], [w * 0.65, 0.105, 1.15], f.dark, [0, 0, 0.5]);
    p.box([x + 0.21 * w, h + 0.14 * w, z], [w * 0.64, 0.105, 1.15], f.dark, [0, 0, -0.5]);
    for (const dx of [-0.21, 0.21]) {
      if (rng.chance(0.66)) p.box([x + dx, h * 0.65, z + 0.54], [0.14, 0.23, 0.022], f.paper);
    }
  }
  p.drum([-0.87, 3.12, -9.4], [0.4, 0.75, 0.4], f.copper);
  for (const x of [-1.12, -0.62]) p.box([x, 1.36, -9.33], [0.06, 2.75, 0.075], f.dark);
}

export function buildHarbour(parent: Group, f: Finishes) {
  assembly(parent, (p) => {
    station(p, f);
    powerLines(p, f);
    quay(p, f);
    skyline(p, f);
  });
}
