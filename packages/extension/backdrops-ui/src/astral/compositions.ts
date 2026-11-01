/**
 * Astral's compositions as data (`astral.ts` says what a part is): each
 * returns the parts of its instrument, composed anew from the load's
 * variation, within what its picture allows. Movement, Orrery and
 * Armillary are made for a dark page, Planisphere for a light one; each is
 * drawn in either look (`astral-shader.ts`).
 */
import { TAU } from "../scene/math";
import type { Variation } from "../scene/seed";
import {
  TICK_PERIOD,
  meshed,
  type ArmShape,
  type AstralVariant,
  type Constellation,
  type Drive,
  type GroupShape,
  type Mechanism,
  type Metal,
  type Part,
  type StarShape,
  type StarTone,
  type Train,
  type Vec3,
  type WheelShape,
} from "./astral";

const wheel = (
  radius: number,
  metal: Metal,
  rest: Partial<Omit<WheelShape, "kind" | "radius" | "metal">> = {},
): WheelShape => ({
  kind: "wheel",
  radius,
  inner: 0,
  teeth: 0,
  spokes: 0,
  thickness: 0.04,
  metal,
  engravings: [],
  ...rest,
});

const star = (
  size: number,
  tone: StarTone,
  rest: Partial<Omit<StarShape, "kind" | "size" | "tone">> = {},
): StarShape => ({ kind: "star", size, tone, across: 0.6, angle: 0, ...rest });

const arm = (
  length: number,
  width: number,
  metal: Metal,
  rest: Partial<Omit<ArmShape, "kind" | "length" | "width" | "metal">> = {},
): ArmShape => ({ kind: "arm", length, width, metal, tail: 0, thickness: 0.016, ...rest });

const tick = (ratio: number, every = 1, train: Train = "main"): Drive => ({
  kind: "tick",
  train,
  ratio,
  every,
});

const GROUP: GroupShape = { kind: "group" };

const polar = (r: number, angle: number, z = 0): Vec3 => [
  r * Math.cos(angle),
  r * Math.sin(angle),
  z,
];

/**
 * Constellation figures, a unit across with y up: each star x y and its
 * long spike, and the links between them. The net is Movement's concept
 * picture's own.
 */
const FIGURES = {
  net: {
    stars: [
      [-0.5, 0.12, 0.057],
      [-0.185, 0.25, 0.039],
      [0.13, 0.093, 0.074],
      [0.391, 0.207, 0.035],
      [0.5, -0.12, 0.048],
      [0.174, -0.25, 0.033],
      [-0.152, -0.196, 0.043],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 2],
    ],
  },
  dipper: {
    stars: [
      [-0.5, 0.16, 0.04],
      [-0.3, 0.2, 0.035],
      [-0.12, 0.13, 0.05],
      [0.04, 0.06, 0.04],
      [0.08, -0.15, 0.05],
      [0.45, -0.2, 0.065],
      [0.5, 0.04, 0.045],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
  },
  swan: {
    stars: [
      [0, 0.3, 0.065],
      [0, 0.08, 0.045],
      [-0.04, -0.12, 0.035],
      [0.02, -0.32, 0.05],
      [-0.42, 0.16, 0.04],
      [0.4, -0.02, 0.045],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [4, 1],
      [1, 5],
    ],
  },
  crown: {
    stars: [
      [-0.5, 0.12, 0.045],
      [-0.25, -0.1, 0.04],
      [0, 0.06, 0.065],
      [0.24, -0.12, 0.04],
      [0.5, 0.14, 0.05],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
} as const satisfies Record<string, Constellation>;

/**
 * A figure in the sky, centred `at` from the hero and `span` across (the
 * instrument's units), facing either way by the load's variation.
 */
function skyConstellation(
  vary: Variation,
  variant: AstralVariant,
  figure: Constellation,
  at: readonly [number, number],
  span: number,
): Constellation {
  const facing = vary.sign(`${variant}.constellation`);
  return {
    stars: figure.stars.map(
      ([x, y, size]): Vec3 => [at[0] + facing * x * span, at[1] + y * span, size * span],
    ),
    links: figure.links,
  };
}

/**
 * A far train, deep behind the instrument and lost in its haze: three
 * wheels that rest, and now and then engage and turn a while.
 */
function farTrain(vary: Variation, at: Vec3): Part[] {
  const a = { at, radius: 0.62, teeth: 64, spin: vary.phase("far.spin") };
  const b = meshed(a, 1, { radius: 0.28, teeth: 29 }, vary.range("far.b", 0.2, 1.1));
  const c = meshed(
    { at: b.at, radius: 0.28, teeth: 29, spin: b.spin },
    b.ratio,
    { radius: 0.4, teeth: 41 },
    vary.range("far.c", 1.9, 2.7),
  );
  const far = (radius: number, teeth: number, spokes: number) =>
    wheel(radius, "champagne", { teeth, spokes, inner: 0, thickness: 0.05 });
  return [
    {
      shape: far(a.radius, a.teeth, 5),
      at: a.at,
      spin: a.spin,
      drive: tick(1, 1, "far"),
    },
    { shape: far(0.28, 29, 4), at: b.at, spin: b.spin, drive: tick(b.ratio, 1, "far") },
    { shape: far(0.4, 41, 5), at: c.at, spin: c.spin, drive: tick(c.ratio, 1, "far") },
  ];
}

/** The dial: an engraved plate, its rings and scale, twelve star indices. */
function dial(vary: Variation): Part {
  const rings = vary.pick("movement.rings", [1, 2, 3] as const);
  const dialRings = Array.from({ length: rings }, (_, i) => 0.74 - i * (0.3 / rings));
  return {
    shape: wheel(1, "plate", {
      thickness: 0.05,
      engravings: [
        {
          kind: "guilloche",
          from: 0.12,
          to: 0.62,
          lines: 10,
          petals: vary.pick("movement.petals", [72, 96, 120] as const),
        },
        { kind: "scale", from: 0.89, to: 0.98, ticks: 240, major: 5 },
        { kind: "rings", radii: [0.98, 0.96, 0.89, 0.85, ...dialRings] },
      ],
    }),
    at: [0, 0, 0],
    children: Array.from({ length: 12 }, (_, i): Part => {
      const t = Math.PI / 2 - (i * TAU) / 12;
      const big = i % 3 === 0;
      return {
        shape: star(big ? 0.07 : 0.04, "champagne", { angle: t - Math.PI / 2, across: 0.45 }),
        at: polar(0.8, t, 0.03),
      };
    }),
  };
}

/** The ecliptic: an eccentric ring with its own fine scale, turning back by quarter ticks. */
function ecliptic(vary: Variation): Part {
  return {
    shape: wheel(0.555, "champagne", {
      inner: 0.51,
      thickness: 0.018,
      engravings: [{ kind: "scale", from: 0.52, to: 0.55, ticks: 144, major: 12 }],
    }),
    at: polar(
      vary.range("movement.ecc", 0.13, 0.2),
      vary.range("movement.eccAngle", 0.5, 1.4),
      0.04,
    ),
    drive: tick(-0.25, 4),
  };
}

/** The rete: open-work pointers carrying star tips, jumping every fourth tick. */
function rete(vary: Variation): Part {
  const pointers = vary.pick("movement.pointers", [5, 6, 7, 8] as const);
  const draw = vary.stream("movement.rete");
  const children: Part[] = [
    { shape: wheel(0.3, "champagne", { inner: 0.27, thickness: 0.02 }), at: [0, 0, 0] },
  ];
  const iceAt = draw.int(0, pointers - 1);
  for (let i = 0; i < pointers; i++) {
    const a = (i / pointers) * TAU + draw.range(-0.25, 0.25);
    const r = draw.range(0.52, 0.76);
    children.push({
      shape: arm(r - 0.27, 0.008, "champagne", { thickness: 0.012 }),
      at: polar(0.27, a, 0),
      spin: a,
      children: [
        {
          shape: star(draw.range(0.05, 0.085), i === iceAt ? "ice" : "champagne", { across: 0.55 }),
          at: [r - 0.27, 0, 0.01],
        },
      ],
    });
  }
  return {
    shape: GROUP,
    at: [0, 0, 0.07],
    spin: vary.phase("movement.reteSpin"),
    drive: tick(1, 4),
    children,
  };
}

/** A sub-dial with its own hand, ticking every tick. */
function subDial(vary: Variation): Part {
  return {
    shape: wheel(0.195, "plate", {
      thickness: 0.03,
      engravings: [
        { kind: "scale", from: 0.15, to: 0.185, ticks: 60, major: 5 },
        { kind: "rings", radii: [0.19, 0.12] },
      ],
    }),
    at: polar(0.7, vary.range("movement.sub", -1.35, -0.75), 0.06),
    children: [
      {
        shape: arm(0.16, 0.012, "silver", { tail: 0.04 }),
        at: [0, 0, 0.025],
        spin: vary.phase("movement.subHand"),
        drive: tick(-1),
      },
      { shape: star(0.03, "champagne"), at: [0, 0, 0.04] },
    ],
  };
}

/** The train behind: a great crown wheel low left, a wheel meshing above it, a third deeper. */
function crownTrain(vary: Variation): Part[] {
  const teeth = vary.pick("movement.crown", [120, 140, 150] as const);
  const radius = 1.15;
  const crown = {
    at: polar(
      vary.range("movement.crownR", 1.25, 1.45),
      vary.range("movement.crownA", 3.25, 3.55),
      -0.45,
    ),
    radius,
    teeth,
    spin: vary.phase("movement.crownSpin"),
  };
  const ratio = 0.25;
  const second = { radius: (radius * 48) / teeth, teeth: 48 };
  const two = meshed(crown, ratio, second, vary.range("movement.two", 0.45, 0.85));
  const third = { radius: (radius * 36) / teeth, teeth: 36 };
  const three = meshed(crown, ratio, third, vary.range("movement.three", 3.3, 3.8));
  return [
    {
      shape: wheel(radius, "champagne", {
        teeth,
        spokes: 5,
        thickness: 0.05,
        engravings: [{ kind: "cotes" }],
      }),
      at: crown.at,
      spin: crown.spin,
      drive: tick(ratio),
      children: [{ shape: star(0.06, "ice"), at: [0, 0, 0.05] }],
    },
    {
      shape: wheel(second.radius, "champagne", { teeth: 48, spokes: 5, thickness: 0.05 }),
      at: two.at,
      spin: two.spin,
      drive: tick(two.ratio),
      children: [{ shape: star(0.05, "ice"), at: [0, 0, 0.05] }],
    },
    {
      shape: wheel(third.radius, "champagne", { teeth: 36, spokes: 4, thickness: 0.05 }),
      at: [three.at[0], three.at[1], -0.32],
      spin: three.spin,
      drive: tick(three.ratio),
    },
  ];
}

/** The balance and its hairspring, swinging a little slower than two ticks, so they drift in and out of phase. */
function balance(vary: Variation): Part {
  const swing = TICK_PERIOD * 2 * vary.range("movement.beat", 1.04, 1.09);
  return {
    shape: GROUP,
    at: [vary.range("movement.balX", -1.2, -0.95), vary.range("movement.balY", 0.75, 0.92), 0.1],
    children: [
      {
        shape: wheel(0.4, "silver", { spokes: 3, thickness: 0.035 }),
        at: [0, 0, 0],
        drive: { kind: "swing", amplitude: 1.1, period: swing },
      },
      {
        shape: wheel(0.3, "plate", {
          thickness: 0.012,
          engravings: [{ kind: "spiral", from: 0.05, to: 0.28, coils: 9 }],
        }),
        at: [0, 0, -0.01],
        drive: { kind: "swing", amplitude: 0.35, period: swing },
      },
      { shape: star(0.08, "ice"), at: [0, 0, 0.06] },
    ],
  };
}

/** #1 Movement: an astrolabe dial before a great crown wheel and its train, a balance swinging above. */
function movement(vary: Variation): Mechanism {
  return {
    variant: "movement",
    unit: 0.33,
    panel: { x: 0.26, y: 0.38, scale: 0.58 },
    wide: { x: 0.52, y: 0.42, scale: 1 },
    lean: [0.05, -0.08, 0],
    drift: { yaw: 0.03, pitch: 0.015, period: 70 },
    arc: { at: [-2.1, -8.5], radius: 9.45 },
    constellation: skyConstellation(vary, "movement", FIGURES.net, [-3.27, 0.62], 1.45),
    // The dial in focus; the train behind it soft, the deepest wheel softest.
    focus: { at: 0.06, depth: 0.1, falloff: 0.3, radius: 5 },
    parts: [
      ...crownTrain(vary),
      ...farTrain(vary, [
        vary.range("movement.farX", 1.9, 2.5),
        vary.range("movement.farY", 0, 0.4),
        -1.6,
      ]),
      dial(vary),
      ecliptic(vary),
      rete(vary),
      subDial(vary),
      balance(vary),
      { shape: wheel(0.06, "champagne", { thickness: 0.06 }), at: [0, 0, 0.09] },
      { shape: star(1.15, "ivory", { hub: true, across: 0.66 }), at: [0, 0, 0.14] },
    ],
  };
}

/** #2 Orrery: silver on black, tilted orbits, planets as stars on rods round a column. */
function orrery(vary: Variation): Mechanism {
  const count = vary.pick("orrery.planets", [4, 5] as const);
  const draw = vary.stream("orrery.orbits");
  const radii: number[] = [];
  let r = draw.range(0.36, 0.48);
  for (let i = 0; i < count; i++) {
    radii.push(r);
    r += draw.range(0.28, 0.42);
  }
  const ice = draw.int(1, count - 1);
  const orbits: Part[] = [];
  radii.forEach((radius, i) => {
    const scaled = i % 2 === 1;
    orbits.push({
      // An orbit is a wire, every other one with a scale standing out of it.
      shape: scaled
        ? wheel(radius * 1.02, "silver", {
            inner: radius - 0.002,
            thickness: 0.003,
            engravings: [{ kind: "scale", from: radius, to: radius * 1.02, ticks: 180, major: 10 }],
          })
        : wheel(radius + 0.002, "silver", { inner: radius - 0.002, thickness: 0.003 }),
      at: [0, 0, 0],
    });
    // Kepler, nearly: the inner ones step further each tick.
    const ratio = (0.9 * (radii[0] ?? radius) ** 1.5) / radius ** 1.5;
    const size = draw.range(0.16, 0.24) * (i === count - 1 ? 1.3 : 1);
    const collar = -0.06 - i * 0.05;
    orbits.push({
      shape: GROUP,
      at: [0, 0, collar],
      spin: draw.range(0, TAU),
      drive: tick(ratio),
      children: [
        { shape: wheel(0.045, "silver", { inner: 0.02, thickness: 0.03 }), at: [0, 0, 0] },
        { shape: arm(radius, 0.011, "silver", { tail: 0.16, thickness: 0.01 }), at: [0, 0, 0] },
        { shape: wheel(0.035, "silver", { thickness: 0.03 }), at: [-0.16, 0, 0] },
        {
          shape: { kind: "rod", length: -collar, radius: 0.005, metal: "silver" },
          at: [radius, 0, 0],
          tilt: [Math.PI / 2, 0, 0],
        },
        {
          shape: wheel(size * 0.32, "silver", { inner: size * 0.28, thickness: 0.006 }),
          at: [radius, 0, -collar],
        },
        {
          shape: star(size, i === ice ? "ice" : "ivory", { across: 0.6 }),
          at: [radius, 0, -collar],
        },
      ],
    });
  });
  const plane: Part = {
    shape: GROUP,
    at: [0, 0, 0],
    // The orbital plane seen a little from above, leaning.
    tilt: [-Math.PI / 2 + vary.range("orrery.view", 0.27, 0.36), 0, 0],
    children: [...orbits],
  };
  // The drive stands a little behind the orbits' plane: dimmer and finer, as the concept's.
  const drive = {
    at: [0, -1, -0.5] as Vec3,
    radius: 0.3,
    teeth: 40,
    spin: vary.phase("orrery.drive"),
  };
  const pinion = meshed(
    drive,
    1.5,
    { radius: 0.15, teeth: 20 },
    vary.range("orrery.pinion", -0.4, 0.3),
  );
  const collarRadius = (radii[0] ?? 0.4) * 0.34;
  return {
    variant: "orrery",
    unit: 0.27,
    panel: { x: 0.24, y: 0.42, scale: 0.55 },
    wide: { x: 0.54, y: 0.44, scale: 1 },
    lean: [0, 0, vary.range("orrery.lean", -0.18, -0.08)],
    drift: { yaw: 0.06, pitch: 0.02, period: 90 },
    sky: { night: [0.0018, 0.0024, 0.0045], glow: [0.03, 0.034, 0.046] },
    constellation: skyConstellation(vary, "orrery", FIGURES.dipper, [-3.9, 0.81], 1.85),
    parts: [
      {
        shape: { kind: "rod", length: 1, radius: 0.016, metal: "silver" },
        at: [0, -1, 0],
      },
      {
        shape: wheel(drive.radius, "silver", { teeth: drive.teeth, spokes: 5, thickness: 0.04 }),
        at: drive.at,
        spin: drive.spin,
        drive: tick(1.5),
      },
      {
        shape: wheel(0.15, "silver", { teeth: 20, spokes: 0, thickness: 0.04 }),
        at: pinion.at,
        spin: pinion.spin,
        drive: tick(pinion.ratio),
      },
      plane,
      // A fine graduated collar about the sun, square to the eye.
      {
        shape: wheel(collarRadius, "silver", {
          inner: collarRadius - 0.003,
          thickness: 0.003,
          engravings: [
            { kind: "scale", from: collarRadius * 0.9, to: collarRadius, ticks: 72, major: 6 },
          ],
        }),
        at: [0, 0, 0.01],
      },
      { shape: star(0.58, "ivory", { hub: true, across: 0.7 }), at: [0, 0, 0.02] },
    ],
  };
}

/** #3 Planisphere: a star plate, its rim a great wheel, engraved in ink and gilt on paper. */
function planisphere(vary: Variation): Mechanism {
  const plateTeeth = 180;
  const plate = { at: [0, 0, 0] as Vec3, radius: 1, teeth: plateTeeth, spin: 0 };
  const plateRatio = 1 / 6;
  const pinion = meshed(
    plate,
    plateRatio,
    { radius: 0.255, teeth: 46 },
    // High at the plate's left, as the concept's.
    vary.range("planisphere.pinion", 2.5, 2.85),
  );
  const sky = vary.stream("planisphere.constellations");
  const constellation = (centre: readonly [number, number], n: number): Part[] => {
    const points: Vec3[] = [];
    let a = sky.range(0, TAU);
    let p: [number, number] = [centre[0], centre[1]];
    for (let i = 0; i < n; i++) {
      points.push([p[0], p[1], 0.03]);
      a += sky.range(-1.1, 1.1);
      const step = sky.range(0.1, 0.16);
      p = [p[0] + step * Math.cos(a), p[1] + step * Math.sin(a)];
      const out = Math.hypot(p[0], p[1]);
      if (out > 0.62) p = [(p[0] * 0.62) / out, (p[1] * 0.62) / out];
    }
    const links: Part[] = [];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1] ?? [0, 0];
      const [x1, y1] = points[i] ?? [0, 0];
      links.push({
        shape: arm(Math.hypot(x1 - x0, y1 - y0), 0.003, "plate", { thickness: 0.004 }),
        at: [x0, y0, 0.026],
        spin: Math.atan2(y1 - y0, x1 - x0),
      });
    }
    return [
      ...links,
      ...points.map(
        (at, i): Part => ({
          shape: star([0.13, 0.08, 0.1, 0.07, 0.09, 0.07][i % 6] ?? 0.07, "gilt", { across: 0.55 }),
          at,
        }),
      ),
    ];
  };
  const first = vary.range("planisphere.c1", 0, TAU);
  const plateChildren: Part[] = [
    ...constellation([0.32 * Math.cos(first), 0.32 * Math.sin(first)], sky.int(5, 7)),
    ...constellation([0.36 * Math.cos(first + 2.6), 0.36 * Math.sin(first + 2.6)], sky.int(4, 6)),
    ...Array.from({ length: 24 }, (_, i): Part => {
      const t = Math.PI / 2 - (i * TAU) / 24;
      return {
        shape: star(i % 6 === 0 ? 0.07 : 0.036, "ink", { angle: t - Math.PI / 2, across: 0.4 }),
        at: polar(0.76, t, 0.03),
      };
    }),
  ];
  const alidade = vary.range("planisphere.alidade", -0.6, 0.2);
  return {
    variant: "planisphere",
    unit: 0.31,
    panel: { x: 0.26, y: 0.44, scale: 0.6 },
    wide: { x: 0.52, y: 0.53, scale: 1 },
    lean: [0.12, -0.1, 0],
    drift: { yaw: 0.02, pitch: 0.012, period: 80 },
    arc: { at: [-1.83, 6.04], radius: 6.38 },
    constellation: skyConstellation(vary, "planisphere", FIGURES.crown, [-3.3, 1.0], 1.6),
    parts: [
      {
        shape: wheel(0.255, "champagne", { teeth: 46, spokes: 6, thickness: 0.04 }),
        at: [pinion.at[0], pinion.at[1], -0.04],
        spin: pinion.spin,
        drive: tick(pinion.ratio),
      },
      {
        shape: wheel(1, "plate", {
          teeth: plateTeeth,
          thickness: 0.05,
          engravings: [
            { kind: "scale", from: 0.85, to: 0.9, ticks: 360, major: 5 },
            { kind: "rings", radii: [0.915, 0.9, 0.85, 0.81, 0.72] },
            { kind: "chart", radius: 0.72 },
          ],
        }),
        at: plate.at,
        spin: vary.phase("planisphere.plate"),
        drive: tick(plateRatio),
        children: plateChildren,
      },
      {
        shape: arm(1.13, 0.03, "champagne", { tail: 1.13, thickness: 0.02 }),
        at: [0, 0, 0.08],
        spin: alidade,
        drive: tick(1.4, 7),
        children: [
          { shape: wheel(0.04, "champagne", { thickness: 0.06 }), at: [1.06, 0, 0] },
          { shape: wheel(0.04, "champagne", { thickness: 0.06 }), at: [-1.06, 0, 0] },
        ],
      },
      { shape: wheel(0.075, "blued", { inner: 0.058, thickness: 0.02 }), at: [0, 0, 0.1] },
      { shape: star(0.53, "gilt", { hub: true, across: 0.66 }), at: [0, 0, 0.14] },
    ],
  };
}

/** The armillary's drive: a pinion at the meridian's foot, a follower off to its left. */
function meridianDrive(
  vary: Variation,
  meridian: {
    readonly at: Vec3;
    readonly radius: number;
    readonly teeth: number;
    readonly spin: number;
  },
): Part[] {
  const pinion = meshed(
    meridian,
    0.5,
    { radius: 0.33, teeth: 46 },
    vary.range("armillary.pinion", -1.5, -1.3),
  );
  const follower = meshed(
    { at: pinion.at, radius: 0.33, teeth: 46, spin: pinion.spin },
    pinion.ratio,
    { radius: 0.15, teeth: 21 },
    vary.range("armillary.follower", 3.2, 3.6),
  );
  return [
    {
      shape: wheel(0.33, "champagne", { teeth: 46, spokes: 5, thickness: 0.04 }),
      at: pinion.at,
      spin: pinion.spin,
      drive: tick(pinion.ratio),
    },
    {
      shape: wheel(0.15, "champagne", { teeth: 21, spokes: 4, thickness: 0.04 }),
      at: follower.at,
      spin: follower.spin,
      drive: tick(follower.ratio),
    },
  ];
}

/** #4 Armillary: great graduated rings seen obliquely, a toothed meridian, an ecliptic of stars. */
function armillary(vary: Variation): Mechanism {
  const obliquity = (23.5 * Math.PI) / 180;
  const band = (radius: number, width: number, rest: Partial<WheelShape> = {}) =>
    wheel(radius, "silver", { inner: radius - width, thickness: 0.008, ...rest });
  const parallels: readonly [readonly number[], ...(readonly number[])[]] = [
    [23.5, -23.5, 66.5, -66.5],
    [23.5, -23.5],
    [30, -30, 60, -60],
  ];
  const latitudes = vary.pick("armillary.parallels", parallels);
  const stars = vary.stream("armillary.stars");
  const count = stars.int(5, 8);
  const eclipticStars: Part[] = Array.from({ length: count }, (_, i) => {
    const t = (i / count) * TAU + stars.range(-0.3, 0.3);
    return {
      shape: star(stars.range(0.05, 0.08), i === 2 ? "ice" : "champagne", { across: 0.55 }),
      at: polar(0.88, t, 0.02),
    };
  });
  const meridian = { at: [0, 0, 0] as Vec3, radius: 1, teeth: 140, spin: 0 };
  const equatorial: Part = {
    shape: GROUP,
    at: [0, 0, 0],
    tilt: [Math.PI / 2 - obliquity, 0, 0],
    children: [
      {
        shape: band(0.97, 0.057, {
          engravings: [{ kind: "scale", from: 0.913, to: 0.97, ticks: 240, major: 10 }],
        }),
        at: [0, 0, 0],
      },
      ...latitudes.map((lat): Part => {
        const phi = (lat * Math.PI) / 180;
        const radius = 0.97 * Math.cos(phi);
        return {
          shape: band(radius, 0.022, {
            engravings: [
              { kind: "scale", from: radius - 0.022, to: radius, ticks: 120, major: 10 },
            ],
          }),
          at: [0, 0, 0.97 * Math.sin(phi)],
        };
      }),
      {
        shape: GROUP,
        at: [0, 0, 0],
        tilt: [obliquity + 0.1, 0, 0],
        children: [
          {
            shape: band(0.93, 0.1, {
              engravings: [
                { kind: "scale", from: 0.83, to: 0.93, ticks: 360, major: 30 },
                { kind: "rings", radii: [0.9, 0.86] },
              ],
            }),
            at: [0, 0, 0],
            drive: tick(0.35),
            children: eclipticStars,
          },
        ],
      },
      {
        shape: { kind: "rod", length: 2.36, radius: 0.008, metal: "silver" },
        at: [0, 0, -1.18],
        tilt: [Math.PI / 2, 0, 0],
      },
      { shape: star(0.12, "champagne"), at: [0, 0, 1.18] },
      { shape: star(0.12, "champagne"), at: [0, 0, -1.18] },
    ],
  };
  return {
    variant: "armillary",
    unit: 0.31,
    panel: { x: 0.24, y: 0.44, scale: 0.55 },
    wide: { x: 0.5, y: 0.47, scale: 1 },
    lean: [vary.range("armillary.elev", 0.26, 0.36), vary.range("armillary.az", -1, -0.85), 0],
    drift: { yaw: 0.18, pitch: 0.05, period: 75 },
    sky: { night: [0.0035, 0.008, 0.024], glow: [0.028, 0.048, 0.1] },
    constellation: skyConstellation(vary, "armillary", FIGURES.swan, [-3.4, 0.8], 1.4),
    // The hub in focus; the rings' near and far halves soft, as they leave it.
    focus: { at: 0, depth: 0.2, falloff: 0.8, radius: 1.6 },
    parts: [
      {
        shape: band(1.06, 0.088, {
          engravings: [{ kind: "scale", from: 0.972, to: 1.06, ticks: 360, major: 10 }],
        }),
        at: [0, 0, 0],
        tilt: [Math.PI / 2, 0, 0],
      },
      {
        shape: band(1, 0.066, {
          teeth: meridian.teeth,
          engravings: [{ kind: "scale", from: 0.934, to: 1, ticks: 180, major: 10 }],
        }),
        at: meridian.at,
        drive: tick(0.5),
      },
      ...meridianDrive(vary, meridian),
      equatorial,
      { shape: star(0.73, "ivory", { hub: true, across: 0.62 }), at: [0, 0, 0] },
    ],
  };
}

const COMPOSITIONS: Readonly<Record<AstralVariant, (vary: Variation) => Mechanism>> = {
  movement,
  orrery,
  planisphere,
  armillary,
};

/** The composition `variant` composed for this load (`vary`). */
export const compose = (variant: AstralVariant, vary: Variation): Mechanism =>
  COMPOSITIONS[variant](vary);
