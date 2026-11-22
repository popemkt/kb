import type { Group, Material } from "three/webgpu";
import { assembly, type Parts, type XYZ } from "./fabrication";
import type { Finishes } from "./finishes";

/** A continuous copper winding, with real air between successive turns. */
function winding(p: Parts, at: XYZ, r: number, height: number, m: Material) {
  const turns = 9;
  const samples = turns * 14;
  const points: XYZ[] = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples,
      angle = t * turns * Math.PI * 2;
    return [at[0] + Math.cos(angle) * r, at[1] + t * height, at[2] + Math.sin(angle) * r];
  });
  p.tube(points, 0.019, m, samples);
}

function valve(parent: Group, x: number, scale: number, f: Finishes) {
  const jar = assembly(parent, (p) => {
    p.turned(
      [0, 0, 0],
      [
        [0.01, 0],
        [0.38, 0],
        [0.39, 0.065],
        [0.365, 0.1],
        [0.35, 0.15],
        [0.32, 0.16],
      ],
      f.dark,
    );
    for (let i = 0; i < 3; i++) p.drum([0, 0.13 + i * 0.055, 0], [0.344, 0.026, 0.344], f.gold);
    p.drum([0, 0.64, 0], [0.065, 0.96, 0.065], f.copper);
    winding(p, [0, 0.27, 0], 0.158, 0.53, f.gold);
    p.drum([0, 0.84, 0], [0.21, 0.055, 0.21], f.dark);
    for (const dx of [-0.155, 0.155]) {
      p.drum([dx, 0.68, 0.055], [0.016, 0.88, 0.016], f.paper);
      p.tube(
        [
          [dx, 0.9, 0.055],
          [dx * 0.82, 1.02, 0.055],
          [0, 1.1, 0.055],
        ],
        0.012,
        f.filament,
        12,
      );
    }
    p.oval([0, 1.1, 0.055], [0.048, 0.04, 0.045], f.tungsten);
    p.turned(
      [0, 0, 0],
      [
        [0.29, 0.17],
        [0.31, 0.27],
        [0.318, 0.76],
        [0.303, 1.05],
        [0.27, 1.16],
        [0.19, 1.235],
        [0.085, 1.265],
        [0.056, 1.29],
        [0.035, 1.34],
        [0.012, 1.355],
        [0, 1.36],
      ],
      f.glass,
    );
    p.drum([0, 1.29, 0], [0.067, 0.048, 0.067], f.copper);
  });
  jar.position.set(x, 1.75, -0.015);
  jar.scale.set(scale * 1.12, scale, scale * 1.12);
}

function meter(p: Parts, f: Finishes) {
  const front: XYZ = [Math.PI / 2, 0, 0];
  const cx = -0.42,
    cy = 1.09;
  p.drum([cx, cy, 0.465], [0.326, 0.07, 0.326], f.dark, front);
  p.drum([cx, cy, 0.508], [0.298, 0.028, 0.298], f.gold, front);
  p.drum([cx, cy, 0.531], [0.265, 0.03, 0.265], f.paper, front);
  for (let i = 0; i < 21; i++) {
    const a = (-0.14 + (i / 20) * 1.28) * Math.PI;
    p.box(
      [cx + 0.222 * Math.cos(a), cy + 0.222 * Math.sin(a), 0.554],
      [0.011, i % 4 === 0 ? 0.061 : 0.033, 0.012],
      f.dark,
      [0, 0, a - Math.PI / 2],
    );
  }
  p.drum([cx, cy, 0.574], [0.037, 0.044, 0.037], f.copper, front);
}

/** The cabinet is a casting over a bolted plinth. The handset hangs on the
 * side, with one return lead running all the way back to its socket. */
function cabinet(p: Parts, f: Finishes) {
  p.casting([0, 0.16, 0], [1.66, 0.19, 1.12], 0.065, f.stone);
  p.casting([0, 0.27, 0], [1.49, 0.095, 0.94], 0.036, f.dark);
  p.casting([0, 0.97, 0], [1.56, 1.38, 0.84], 0.12, f.violet);
  p.casting([0, 1.68, 0], [1.72, 0.14, 0.99], 0.055, f.dark);
  p.casting([0, 1.755, 0], [1.62, 0.064, 0.93], 0.028, f.green);
  p.casting([0.39, 1.02, 0.435], [0.58, 1.02, 0.08], 0.032, f.green);
  for (let i = 0; i < 7; i++)
    p.box([0.39, 1.42 - i * 0.062, 0.493], [0.43, 0.025, 0.07], f.dark, [-0.27, 0, 0]);
  for (const x of [-0.68, 0.68])
    for (const y of [0.42, 1.5]) {
      p.drum([x, y, 0.431], [0.039, 0.043, 0.039], f.gold, [Math.PI / 2, 0, 0]);
      p.box([x, y, 0.455], [0.045, 0.008, 0.009], f.dark, [0, 0, -0.46]);
    }
  meter(p, f);
  // The glass acknowledgement lamp is dark until the watch station replies.
  p.drum([-0.15, 1.46, 0.442], [0.07, 0.048, 0.07], f.gold, [Math.PI / 2, 0, 0]);
  p.oval([-0.15, 1.46, 0.469], [0.052, 0.052, 0.033], f.pilot);
  // Enamel number plate, with the two channels stamped into the metal.
  p.casting([-0.415, 0.6, 0.438], [0.47, 0.205, 0.027], 0.014, f.dark);
  const strokes: [number, number][][] = [
    [
      [0, 0.11],
      [0.015, 0.134],
      [0.084, 0.134],
      [0.1, 0.11],
      [0.1, 0.022],
      [0.086, 0],
      [0.016, 0],
      [0, 0.022],
      [0, 0.11],
    ],
    [
      [0.15, 0.134],
      [0.247, 0.134],
      [0.177, 0],
    ],
  ];
  for (const path of strokes)
    p.tube(
      path.map(([x, y]) => [-0.545 + x, 0.535 + y, 0.461]),
      0.011,
      f.paper,
      24,
    );
  for (const x of [-0.61, -0.224])
    p.drum([x, 0.6, 0.462], [0.014, 0.012, 0.014], f.copper, [Math.PI / 2, 0, 0]);
  // Rain runs down the shutter below its brass brow.
  p.box([0.39, 1.48, 0.5], [0.56, 0.036, 0.114], f.gold, [-0.18, 0, 0]);
  p.box([0.39, 0.91, 0.494], [0.38, 0.079, 0.023], f.paper);
  for (let i = 0; i < 9; i++)
    p.box([0.235 + i * 0.031, 0.915, 0.51], [i % 3 === 0 ? 0.018 : 0.007, 0.036, 0.008], f.dark);
  for (const z of [0.555, 0.67]) p.box([0.11, 1.056, z], [0.081, 0.07, 0.025], f.copper);
  for (const x of [0.26, 0.53]) {
    p.drum([x, 0.72, 0.52], [0.114, 0.094, 0.114], f.dark, [Math.PI / 2, 0, 0]);
    p.drum([x, 0.72, 0.58], [0.069, 0.047, 0.069], f.copper, [Math.PI / 2, 0, 0]);
  }
  p.tube(
    [
      [0.53, 0.72, 0.6],
      [0.66, 0.42, 0.77],
      [0.92, 0.29, 0.64],
      [1.03, 0.58, 0.33],
      [0.98, 1.22, 0.04],
    ],
    0.046,
    f.dark,
  );
  p.tube(
    [
      [0.93, 1.27, 0.04],
      [1.01, 1.42, 0.04],
      [0.99, 1.57, 0.04],
      [0.91, 1.67, 0.04],
    ],
    0.083,
    f.bakelite,
  );
  for (const y of [1.27, 1.68]) p.oval([0.89, y, 0.04], [0.145, 0.09, 0.14], f.bakelite);
  // A steel conduit climbs the back and takes the line out of the cabinet.
  p.tube(
    [
      [-0.78, 0.45, -0.11],
      [-1.01, 0.48, -0.12],
      [-1.04, 1.46, -0.17],
      [-0.92, 1.66, -0.21],
    ],
    0.069,
    f.copper,
  );
  for (const y of [0.64, 1.28]) p.drum([-1.04, y, -0.15], [0.085, 0.05, 0.085], f.gold);
}

export function buildSwitchboard(parent: Group, f: Finishes) {
  const bank = assembly(parent, (p) => cabinet(p, f));
  bank.position.set(1.46, 0.025, 0.12);
  bank.rotation.y = -0.35;
  valve(bank, -0.42, 0.9, f);
  valve(bank, 0.35, 0.66, f);
  const lever = assembly(bank, (p) => {
    p.box([0, 0.18, 0], [0.048, 0.37, 0.048], f.gold);
    p.oval([0, 0.38, 0], [0.085, 0.061, 0.07], f.ceramic);
  });
  lever.position.set(0.26, 0.72, 0.61);
  const needle = assembly(bank, (p) => p.box([0, 0.097, 0], [0.014, 0.196, 0.012], f.dark));
  needle.position.set(-0.42, 1.09, 0.561);
  return { bank, lever, needle };
}
