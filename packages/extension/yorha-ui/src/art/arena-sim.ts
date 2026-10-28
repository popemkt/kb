/**
 * The Arena's play (ART-DIRECTION.md → YoRHa → Arena): a calm bullet hell on
 * a flat field, worked out apart from any drawing so it can be stepped and
 * tested without a GPU. The field is `u` across and `v` deep; the scene
 * (`arena-scene.ts`) lays it on the floor or stands it up as a wall.
 *
 * A white ship wanders the left of the field, its pod trailing it, and
 * fires a slow pellet now and then; three machines on the right loose
 * patterns of orbs at it — orange ones, which a pellet breaks, and purple
 * ones, which it does not. The pointer, where it is over the field, draws
 * the orbs in and turns them about it. What the owner does is an impulse,
 * never a restart: each write (a keystroke's included) nudges the pod, at
 * most one nudge every `NUDGE_GAP` seconds, nudges in between merging into
 * the next; the pod's charge rises with them and decays by itself, and while
 * it is charged the pod looses orbs along one turning spiral that carries on
 * from wherever it was. Nothing is ever reset: the play and its clock live as
 * long as the scene. Everything moves slowly: the play sits behind a page's
 * title, so it is never a game to watch.
 */

/** The field's half extents, and how high its far edge stands when it is a wall. */
export const FIELD = { halfWidth: 11, halfDepth: 2.4, lift: 3 } as const;

/** What a bullet is: an orb a pellet breaks, one it does not, or the ship's pellet. */
const ORANGE = 0;
const PURPLE = 1;
const PELLET = 2;
type Kind = typeof ORANGE | typeof PURPLE | typeof PELLET;

/** A place on the field. */
export interface FieldPoint {
  readonly u: number;
  readonly v: number;
}

/** How many bullets the field holds at once; a pattern past it is cut short. */
export const CAPACITY = 240;
/** Seconds an orb lives, and a pellet. */
const ORB_LIFE = 18;
const PELLET_LIFE = 5;
/** Seconds an orb takes to grow in, and to shrink away at the end of its life. */
const GROW = 0.4;
const FADE = 1;
/** Orb radii, in field units. */
const RADIUS: Readonly<Record<Kind, number>> = { [ORANGE]: 0.16, [PURPLE]: 0.19, [PELLET]: 0.07 };
/** The pointer's reach, its pull and its turn (units/s²), and the fastest an orb is let go. */
const REACH = 3.2;
const PULL = 1.3;
const SWIRL = 0.9;
const MAX_SPEED = 1.6;
/** How close a pellet comes to an orange orb to break it. */
const HIT = 0.28;
/** Seconds between the ship's pellets. */
const PELLET_EVERY = 1.3;
/** The fewest seconds between two nudges the pod takes; nudges in between merge. */
export const NUDGE_GAP = 0.16;
/** How fast the pod's charge decays (seconds to fall to 1/e), and the orbs a second it looses when full. */
const CHARGE_DECAY = 1.2;
const CHARGE_RATE = 8;
/** The turn between the pod's orbs: the golden angle, so its spiral never repeats a lane. */
const POD_TURN = Math.PI * (3 - Math.sqrt(5));

interface Machine {
  readonly home: FieldPoint;
  u: number;
  v: number;
  readonly phase: number;
  /** Seconds until its next pattern. */
  wait: number;
  /** The pattern it is loosing now: shots left, the angle of the next, and seconds to it. */
  burst: { left: number; angle: number; next: number };
  /** Which pattern comes next. */
  turn: number;
}

/** A small seeded generator (mulberry32), so a seed always plays the same. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ArenaPlay {
  /** The bullets, one slot each up to `count`: place, velocity, age, life and kind. */
  readonly u = new Float32Array(CAPACITY);
  readonly v = new Float32Array(CAPACITY);
  private readonly du = new Float32Array(CAPACITY);
  private readonly dv = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  readonly kind = new Uint8Array(CAPACITY);
  count = 0;
  /** Seconds played. */
  time = 0;
  readonly ship = { u: -4.8, v: 0, du: 0, dv: 0 };
  readonly pod = { u: -5.8, v: -0.8 };
  readonly machines: readonly Machine[];
  private pelletWait = PELLET_EVERY;
  /** The pod's charge (0–1), the nudge waiting to land, when the last one landed, and its spiral. */
  charge = 0;
  private pending = 0;
  private nudgedAt = Number.NEGATIVE_INFINITY;
  private due = 0;
  private podAngle = 0;
  private podShots = 0;
  private readonly random: () => number;

  constructor(seed: number) {
    this.random = seeded(seed);
    const homes: readonly FieldPoint[] = [
      { u: 2.4, v: -1.1 },
      { u: 5.1, v: 0.9 },
      { u: 7.5, v: -0.4 },
    ];
    this.machines = homes.map((home, i) => ({
      home,
      u: home.u,
      v: home.v,
      phase: this.random() * Math.PI * 2,
      wait: 1 + i * 1.8 + this.random() * 2,
      burst: { left: 0, angle: 0, next: 0 },
      turn: i,
    }));
  }

  /** Play `seconds` in steps of `step`: how a scene arrives mid-play, never on an empty field. */
  advance(seconds: number, step = 1 / 30): void {
    for (let t = 0; t < seconds; t += step) this.step(step, null);
  }

  /** Advance by `dt` seconds; `pointer` is where the pointer is over the field, if it is. */
  step(dt: number, pointer: FieldPoint | null): void {
    if (dt <= 0) return;
    this.time += dt;
    this.moveShip(dt);
    this.movePod(dt);
    this.chargePod(dt);
    for (const machine of this.machines) this.moveMachine(machine, dt);
    this.moveBullets(dt, pointer);
    this.breakOrbs();
    this.sweep();
  }

  /**
   * The owner did something worth `strength` (0–1): it lands on the pod's
   * charge at the next step at least `NUDGE_GAP` after the last one landed,
   * the strongest of the nudges in between taken for all of them.
   */
  nudge(strength: number): void {
    this.pending = Math.max(this.pending, Math.min(1, Math.max(0, strength)));
  }

  /** How large bullet `i` is drawn now: its radius as it grows in and shrinks away. */
  radius(i: number): number {
    const kind = this.kind[i];
    const full =
      kind === PELLET ? RADIUS[PELLET] : kind === PURPLE ? RADIUS[PURPLE] : RADIUS[ORANGE];
    const grown = Math.min(1, (this.age[i] ?? 0) / GROW);
    const kept = Math.min(1, Math.max(0, this.left(i) / FADE));
    return full * grown * kept;
  }

  /** Seconds bullet `i` has left to live. */
  private left(i: number): number {
    return (this.life[i] ?? 0) - (this.age[i] ?? 0);
  }

  /** Whether bullets `a` and `b` are within `reach` of each other. */
  private within(a: number, b: number, reach: number): boolean {
    const du = (this.u[a] ?? 0) - (this.u[b] ?? 0);
    const dv = (this.v[a] ?? 0) - (this.v[b] ?? 0);
    return du * du + dv * dv <= reach * reach;
  }

  private moveShip(dt: number): void {
    const t = this.time;
    const ship = this.ship;
    // A slow wander over the left of the field, pushed off the orbs nearest it.
    let tu = -4.8 + 1.6 * Math.sin(t * 0.11) + 0.6 * Math.sin(t * 0.29 + 2);
    let tv = 1.6 * Math.sin(t * 0.17 + 1);
    for (let i = 0; i < this.count; i++) {
      if (this.kind[i] === PELLET) continue;
      const ou = ship.u - (this.u[i] ?? 0);
      const ov = ship.v - (this.v[i] ?? 0);
      const d2 = ou * ou + ov * ov;
      if (d2 > 1.2 || d2 < 1e-6) continue;
      const push = (1.2 - d2) * 1.5;
      tu += (ou / Math.sqrt(d2)) * push;
      tv += (ov / Math.sqrt(d2)) * push;
    }
    tv = Math.max(-FIELD.halfDepth + 0.3, Math.min(FIELD.halfDepth - 0.3, tv));
    const k = 1 - Math.exp(-dt * 1.2);
    const nu = ship.u + (tu - ship.u) * k;
    const nv = ship.v + (tv - ship.v) * k;
    ship.du = (nu - ship.u) / dt;
    ship.dv = (nv - ship.v) / dt;
    ship.u = nu;
    ship.v = nv;
    this.pelletWait -= dt;
    if (this.pelletWait <= 0) {
      this.pelletWait += PELLET_EVERY;
      this.emit(ship.u + 0.5, ship.v, 0, 2.4, PELLET);
    }
  }

  private movePod(dt: number): void {
    const k = 1 - Math.exp(-dt * 1.5);
    this.pod.u += (this.ship.u - 1 - this.pod.u) * k;
    this.pod.v += (this.ship.v - 0.8 - this.pod.v) * k;
  }

  /** Land a waiting nudge, let the charge decay, and loose what it holds along the spiral. */
  private chargePod(dt: number): void {
    if (this.pending > 0 && this.time - this.nudgedAt >= NUDGE_GAP) {
      this.charge = Math.min(1, this.charge + this.pending);
      this.pending = 0;
      this.nudgedAt = this.time;
    }
    this.charge *= Math.exp(-dt / CHARGE_DECAY);
    this.due += this.charge * CHARGE_RATE * dt;
    while (this.due >= 1) {
      this.due -= 1;
      this.podAngle += POD_TURN;
      this.podShots += 1;
      const kind = this.podShots % 3 === 0 ? PURPLE : ORANGE;
      this.emit(this.pod.u, this.pod.v, this.podAngle, kind === PURPLE ? 0.6 : 0.85, kind);
    }
  }

  private moveMachine(machine: Machine, dt: number): void {
    const t = this.time + machine.phase * 10;
    machine.u = machine.home.u + 0.6 * Math.sin(t * 0.13);
    machine.v = machine.home.v + 0.7 * Math.sin(t * 0.09 + machine.phase);
    const burst = machine.burst;
    if (burst.left > 0) {
      burst.next -= dt;
      if (burst.next > 0) return;
      burst.next += 0.25;
      burst.left -= 1;
      burst.angle += 0.55;
      this.emit(machine.u, machine.v, burst.angle, 0.6, burst.left % 2 === 0 ? ORANGE : PURPLE);
      return;
    }
    machine.wait -= dt;
    if (machine.wait > 0) return;
    machine.wait = 5 + this.random() * 3;
    const pattern = machine.turn % 3;
    machine.turn += 1;
    const aim = Math.atan2(this.ship.v - machine.v, this.ship.u - machine.u);
    if (pattern === 0) {
      // A ring of purple, evenly spaced.
      const turn = this.random() * Math.PI;
      for (let i = 0; i < 12; i++) {
        this.emit(machine.u, machine.v, turn + (i / 12) * Math.PI * 2, 0.5, PURPLE);
      }
    } else if (pattern === 1) {
      // A fan of orange at the ship.
      for (let i = -2; i <= 2; i++) this.emit(machine.u, machine.v, aim + i * 0.17, 0.75, ORANGE);
    } else {
      // A spiral, one orb at a time.
      machine.burst = { left: 10, angle: aim, next: 0 };
    }
  }

  private moveBullets(dt: number, pointer: FieldPoint | null): void {
    for (let i = 0; i < this.count; i++) {
      this.age[i] = (this.age[i] ?? 0) + dt;
      let du = this.du[i] ?? 0;
      let dv = this.dv[i] ?? 0;
      const u = this.u[i] ?? 0;
      const v = this.v[i] ?? 0;
      if (pointer !== null && this.kind[i] !== PELLET) {
        const ou = pointer.u - u;
        const ov = pointer.v - v;
        const d = Math.hypot(ou, ov);
        if (d < REACH && d > 1e-4) {
          const near = (1 - d / REACH) ** 2;
          // Drawn in, but not into a point: inside a little ring they only turn about it.
          const pull = d < 0.45 ? 0 : PULL * near;
          du += ((ou / d) * pull - (ov / d) * SWIRL * near) * dt;
          dv += ((ov / d) * pull + (ou / d) * SWIRL * near) * dt;
          const speed = Math.hypot(du, dv);
          if (speed > MAX_SPEED) {
            du *= MAX_SPEED / speed;
            dv *= MAX_SPEED / speed;
          }
        }
      }
      this.du[i] = du;
      this.dv[i] = dv;
      this.u[i] = u + du * dt;
      this.v[i] = v + dv * dt;
    }
  }

  /** A pellet that meets an orange orb breaks it, and is spent. */
  private breakOrbs(): void {
    for (let p = 0; p < this.count; p++) {
      if (this.kind[p] !== PELLET || this.left(p) <= 0) continue;
      const o = this.orangeNear(p);
      if (o < 0) continue;
      // Both shrink away from here rather than vanish.
      this.life[o] = (this.age[o] ?? 0) + FADE * 0.5;
      this.life[p] = this.age[p] ?? 0;
      this.du[o] = (this.du[o] ?? 0) * 0.3;
      this.dv[o] = (this.dv[o] ?? 0) * 0.3;
    }
  }

  /** The first whole orange orb pellet `p` meets, or -1. */
  private orangeNear(p: number): number {
    for (let o = 0; o < this.count; o++) {
      // An orb already breaking, or at the end of its life, is not hit again.
      if (this.kind[o] !== ORANGE || this.left(o) <= FADE * 0.5) continue;
      if (this.within(o, p, HIT)) return o;
    }
    return -1;
  }

  /** Drop every bullet that has lived its life or left the field, keeping the rest packed. */
  private sweep(): void {
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const u = this.u[i] ?? 0;
      const v = this.v[i] ?? 0;
      const gone =
        (this.age[i] ?? 0) >= (this.life[i] ?? 0) ||
        Math.abs(u) > FIELD.halfWidth + 1.5 ||
        Math.abs(v) > FIELD.halfDepth + 1.2;
      if (gone) continue;
      if (kept !== i) this.copy(i, kept);
      kept++;
    }
    this.count = kept;
  }

  private copy(from: number, to: number): void {
    this.u[to] = this.u[from] ?? 0;
    this.v[to] = this.v[from] ?? 0;
    this.du[to] = this.du[from] ?? 0;
    this.dv[to] = this.dv[from] ?? 0;
    this.age[to] = this.age[from] ?? 0;
    this.life[to] = this.life[from] ?? 0;
    this.kind[to] = this.kind[from] ?? 0;
  }

  private emit(u: number, v: number, angle: number, speed: number, kind: Kind): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.u[i] = u;
    this.v[i] = v;
    this.du[i] = Math.cos(angle) * speed;
    this.dv[i] = Math.sin(angle) * speed;
    this.age[i] = 0;
    this.life[i] = kind === PELLET ? PELLET_LIFE : ORB_LIFE;
    this.kind[i] = kind;
  }
}

/**
 * Where the camera stands: its turn about the field (`yaw`), its height
 * (`pitch`, 0 level, π/2 straight down), its field of view in degrees, and
 * how far the field is stood up (`hinge`, 0 the floor, π/2 a wall).
 */
export interface ArenaView {
  readonly yaw: number;
  readonly pitch: number;
  readonly fov: number;
  readonly hinge: number;
}

/** The three ways the arena is seen. */
const ANGLED: ArenaView = { yaw: -0.5, pitch: 0.62, fov: 32, hinge: 0 };
const TOP_DOWN: ArenaView = { yaw: 0, pitch: 1.45, fov: 30, hinge: 0 };
const SIDE_ON: ArenaView = { yaw: 0, pitch: 0.1, fov: 28, hinge: Math.PI / 2 };
/**
 * The views in turn: in 3D, then from above, then swinging down to the side
 * as the field stands up to face it, and back round to 3D.
 */
const ROUTE: readonly ArenaView[] = [ANGLED, TOP_DOWN, SIDE_ON];
/** Seconds a view holds, and seconds the camera takes to move to the next. */
export const VIEW_HOLD = 22;
export const VIEW_MOVE = 6;

/** The still view: what reduced motion shows, and where the camera starts. */
export const STILL_VIEW: ArenaView = ANGLED;

/** Eases 0→1 with no speed at either end (smootherstep). */
function settle(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Where the camera is `t` seconds into the play: a view held, or eased into the next. */
export function viewAt(t: number): ArenaView {
  const cycle = VIEW_HOLD + VIEW_MOVE;
  const leg = Math.floor(Math.max(0, t) / cycle);
  const into = Math.max(0, t) - leg * cycle;
  const from = ROUTE[leg % ROUTE.length] ?? ANGLED;
  const to = ROUTE[(leg + 1) % ROUTE.length] ?? ANGLED;
  const k = settle((into - VIEW_HOLD) / VIEW_MOVE);
  // A slow sway, so a held view is never quite still.
  const sway = 0.06 * Math.sin((t / 90) * Math.PI * 2);
  return {
    yaw: from.yaw + (to.yaw - from.yaw) * k + sway,
    pitch: from.pitch + (to.pitch - from.pitch) * k,
    fov: from.fov + (to.fov - from.fov) * k,
    hinge: from.hinge + (to.hinge - from.hinge) * k,
  };
}
