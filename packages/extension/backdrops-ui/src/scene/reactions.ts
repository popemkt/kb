/**
 * How a scene feels the owner (DESIGN-UI.md → Page-head backdrops): the
 * pointer over its frame, typing, a write landing, a move to another page.
 * Each becomes one eased signal a composition reads, so no reaction snaps
 * on or off.
 *
 * - `calm` rises while a node's text is being edited and falls when the
 *   owner stops: actors settle, slow and ignore the pointer.
 * - `impulse` is what the owner's writes add to the scene. A write never
 *   restarts it: each adds energy to the one under way, at most one every
 *   `IMPULSE_EVERY` (writes between merge into the next), and the energy
 *   decays by itself. Typing writes on every keystroke, so a keystroke adds
 *   a little (`TYPING_GAIN`): continuous typing is a gentle sustained
 *   response that eases away when it stops; a write outside typing adds a
 *   full one.
 * - `stir` is the impulse with typing's share taken out (none while calm), so
 *   a scene that keeps still for typing reads it; `ripple` is a pulse on a
 *   move to another page.
 * - `startle` is a short pulse when something happens on the page that the
 *   owner did not do here (`PageEvents`: a change from elsewhere, an error, a
 *   turn the agent finished); `noticed` says which happened last, and how
 *   many have, for a scene that answers each kind its own way or holds what
 *   it noticed still.
 * - `pointer` is where the owner's pointer is over the frame (null when it
 *   is not), its `near` easing in and out so the actors do not twitch at the
 *   edge, and `speed` how fast it is moving.
 */
import type { PageEvents } from "@kb/ui-sdk";
import { clamp01, damp, envelope } from "./math.ts";

/** Something that happened on the page: one of its counted events. */
export type PageEventKind = keyof PageEvents;

interface PointerState {
  readonly x: number;
  readonly y: number;
  /** 0 when absent, easing to 1 while over the frame. */
  readonly near: number;
  /** Pixels per second, smoothed. */
  readonly speed: number;
}

/** A pulse fired at a time, and read as the time since. */
interface Pulse {
  at: number;
  rise: number;
  fall: number;
  gain: number;
}

export interface Reactions {
  readonly calm: number;
  /** The owner's writes, merged: 0..1, quick up and slow down, never restarted. */
  readonly impulse: number;
  /** The impulse while not typing: 0..1, nothing while calm. */
  readonly stir: number;
  /** The owner moved to another page: 0..1, slower. */
  readonly ripple: number;
  /** Something happened on the page (`notice`): 0..1, a quick start and a short fall. */
  readonly startle: number;
  /** The kind last noticed (null before any), and how many have been. */
  readonly noticed: { readonly kind: PageEventKind | null; readonly count: number };
  readonly pointer: PointerState;
  /** Fired by the stage when the activity signal moves. */
  readonly write: () => void;
  readonly navigate: () => void;
  readonly notice: (kind: PageEventKind) => void;
  readonly setEditing: (editing: boolean) => void;
  readonly setPointer: (x: number, y: number) => void;
  readonly clearPointer: () => void;
  /** Advance by `dt` seconds. */
  readonly update: (dt: number) => void;
  /** The `ripple` age: seconds since the last navigation (Infinity before any). */
  readonly sinceNavigate: () => number;
}

/** The least time between two impulses (s): writes in between merge into the next. */
export const IMPULSE_EVERY = 0.15;
/** What one keystroke's write adds, against a full write's 1. */
const TYPING_GAIN = 0.05;
/** How fast an impulse rises to its energy (1/s), and how long the energy lasts (s). */
const IMPULSE_RISE = 18;
const IMPULSE_FALL = 1.4;

const pulseValue = (pulse: Pulse, now: number): number =>
  clamp01(pulse.gain * envelope(now - pulse.at, pulse.rise, pulse.fall));

export function startReactions(): Reactions {
  let now = 0;
  let calm = 0;
  let editing = false;
  // The impulse: energy the writes add, the level that follows it, and what is waiting to land.
  let energy = 0;
  let impulse = 0;
  let pending = 0;
  let landed = -Infinity;
  const ripplePulse: Pulse = { at: -1e9, rise: 0.35, fall: 2.4, gain: 1 };
  const startlePulse: Pulse = { at: -1e9, rise: 0.06, fall: 1.1, gain: 1 };
  let noticed: Reactions["noticed"] = { kind: null, count: 0 };
  let px = 0;
  let py = 0;
  let over = false;
  let near = 0;
  let speed = 0;
  let lastX = 0;
  let lastY = 0;
  let sinceMove = 0;

  const reactions: Reactions = {
    get calm() {
      return calm;
    },
    get impulse() {
      return impulse;
    },
    get stir() {
      // Typing keeps a still scene calm: its share of the impulse is not a stir.
      return impulse * (1 - calm);
    },
    get ripple() {
      return pulseValue(ripplePulse, now);
    },
    get startle() {
      return pulseValue(startlePulse, now);
    },
    get noticed() {
      return noticed;
    },
    get pointer() {
      return { x: px, y: py, near, speed };
    },
    write: () => {
      pending = Math.max(pending, editing ? TYPING_GAIN : 1);
    },
    navigate: () => {
      ripplePulse.at = now;
    },
    notice: (kind) => {
      startlePulse.at = now;
      noticed = { kind, count: noticed.count + 1 };
    },
    setEditing: (value) => {
      editing = value;
    },
    setPointer: (x, y) => {
      if (!over) {
        lastX = x;
        lastY = y;
      }
      px = x;
      py = y;
      over = true;
    },
    clearPointer: () => {
      over = false;
    },
    update: (dt) => {
      now += dt;
      if (pending > 0 && now - landed >= IMPULSE_EVERY) {
        // Added to the energy under way, saturating: a merge, never a restart.
        energy += pending * (1 - energy);
        pending = 0;
        landed = now;
      }
      energy *= Math.exp(-dt / IMPULSE_FALL);
      impulse = damp(impulse, energy, IMPULSE_RISE, dt);
      calm = damp(calm, editing ? 1 : 0, editing ? 1.4 : 0.55, dt);
      near = damp(near, over ? 1 : 0, over ? 6 : 2.5, dt);
      const moved = Math.hypot(px - lastX, py - lastY);
      lastX = px;
      lastY = py;
      sinceMove = moved > 0 ? 0 : sinceMove + dt;
      const instant = dt > 0 ? moved / dt : 0;
      speed = damp(speed, sinceMove > 0.1 ? 0 : instant, 8, dt);
    },
    sinceNavigate: () => now - ripplePulse.at,
  };
  return reactions;
}
