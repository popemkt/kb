/**
 * When each key's writes may go (docs/research/2026-11-02-kb-routines-gcal.md
 * → Status lives in the host): an edit settles before it is sent, and a
 * failure backs off before it is tried again. A key is an event node, or a
 * calendar node for its list call. Memory only: a fresh host has nothing
 * waiting, and its first pass sends at once.
 */
import { retryDelay, settleAt, type SyncError } from "@kb/routines";

/** The most failures a key retries on its own; Sync now or a change starts it again. */
const ATTEMPTS = 10;

/** A key's place: since when it has been edited, when it may go next, and how often it failed. */
interface Due {
  readonly first: number;
  readonly at: number;
  readonly attempts: number;
}

export class Schedule {
  private readonly due = new Map<string, Due>();

  /** Whether `key`'s writes wait at `now`: an edit settling, a failure backing off, or one given up. */
  waits(key: string, now: number): boolean {
    const entry = this.due.get(key);
    return entry !== undefined && (entry.at > now || entry.attempts >= ATTEMPTS);
  }

  has(key: string): boolean {
    return this.due.has(key);
  }

  /** `key` was edited at `now`: it goes once it is quiet, and no later than its first edit allows. */
  edited(key: string, now: number): void {
    const first = this.due.get(key)?.first ?? now;
    this.due.set(key, { first, at: settleAt(first, now), attempts: 0 });
  }

  /**
   * `key` failed at `now` with `error`. A transport, server or quota failure
   * backs off (`jitter` in 0…1); another stops until a change or Sync now.
   */
  failed(key: string, error: SyncError, now: number, jitter: number): void {
    const attempts = (this.due.get(key)?.attempts ?? 0) + 1;
    const transient = error.status === 0 || error.status === 429 || error.status >= 500;
    const kind = error.status === 429 ? "quota" : "transport";
    this.due.set(key, {
      first: now,
      at: now + retryDelay(attempts, jitter, kind, error.retryAfter),
      attempts: transient ? attempts : ATTEMPTS,
    });
  }

  /** `key` cannot be sent as it is: it stops until a change. */
  stopped(key: string, now: number): void {
    this.due.set(key, { first: now, at: now, attempts: ATTEMPTS });
  }

  /** `key`'s writes went: nothing of it waits. */
  sent(key: string): void {
    this.due.delete(key);
  }

  /** Sync now: everything waiting goes at the next pass, with its retries counted afresh. */
  now(): void {
    for (const [key, entry] of this.due) this.due.set(key, { ...entry, at: 0, attempts: 0 });
  }

  /** The keys due at `now`. */
  dueAt(now: number): ReadonlySet<string> {
    return new Set([...this.due].filter(([, entry]) => entry.at <= now).map(([key]) => key));
  }

  /** Whether a pass at `now` has something to send: a key due that has not given up. */
  ready(now: number): boolean {
    return [...this.due.values()].some((entry) => entry.at <= now && entry.attempts < ATTEMPTS);
  }

  /** Each key of `due` that met no failure in the pass at `now` has nothing left to wait for. */
  settled(due: ReadonlySet<string>, now: number): void {
    for (const key of due) if ((this.due.get(key)?.at ?? Infinity) <= now) this.due.delete(key);
  }
}
