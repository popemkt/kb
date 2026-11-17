/**
 * The host's sync statuses (docs/research/2026-11-02-kb-routines-gcal.md →
 * Status lives in the host): one per write target, the events whose ending
 * is held, and the pages that hear them. It is memory only. A fresh host
 * fills it with its first pass, and the store never holds it.
 */
import { Effect } from "effect";
import { canonicalJson } from "@kb/model";
import type { RemoteEvent, SyncStatus, SyncStatuses } from "@kb/routines";
import type { Target } from "./reconcile.ts";

/** A target's key: one string per target, whatever its kind. */
export function targetKey(target: Target): string {
  if (target.kind === "series") return "series:" + target.routine;
  if (target.kind === "instance") return "instance:" + target.routine + "/" + target.day;
  return "calendar:" + target.calendar;
}

type Hear = (statuses: SyncStatuses) => Effect.Effect<void>;

export class StatusBook {
  private readonly series = new Map<string, SyncStatus>();
  private readonly instances = new Map<string, Map<string, SyncStatus>>();
  private readonly calendars = new Map<string, SyncStatus>();
  /** Each event whose ending waits for a release, with the Google id of the series that would end. */
  readonly held = new Map<string, string>();
  private readonly watchers = new Map<string, Hear>();
  private published = "";

  get(target: Target): SyncStatus | undefined {
    if (target.kind === "series") return this.series.get(target.routine);
    if (target.kind === "instance") return this.instances.get(target.routine)?.get(target.day);
    return this.calendars.get(target.calendar);
  }

  set(target: Target, status: SyncStatus): void {
    if (target.kind === "series") this.series.set(target.routine, status);
    else if (target.kind === "calendar") this.calendars.set(target.calendar, status);
    else {
      const days = this.instances.get(target.routine) ?? new Map<string, SyncStatus>();
      days.set(target.day, status);
      this.instances.set(target.routine, days);
    }
  }

  /** Google holds what `target` wants: synced, with its id and link, and when kb last sent it. */
  holds(target: Target, remote: RemoteEvent): void {
    const at = this.get(target)?.at;
    this.set(target, {
      state: "synced",
      message: "",
      eventId: remote.id,
      url: remote.url,
      ...(at === undefined ? {} : { at }),
    });
  }

  /** `target`'s write waits, keeping what is known of the event it is for. */
  waits(target: Target): void {
    this.set(target, { ...this.get(target), state: "pending", message: "" });
  }

  /** Forget each target `keep` refuses: an event gone, a day with nothing to send, a calendar not reached. */
  prune(keep: (target: Target) => boolean): void {
    for (const routine of this.series.keys())
      if (!keep({ kind: "series", routine })) this.series.delete(routine);
    for (const [routine, days] of this.instances) {
      for (const day of days.keys())
        if (!keep({ kind: "instance", routine, day })) days.delete(day);
      if (days.size === 0) this.instances.delete(routine);
    }
    for (const calendar of this.calendars.keys())
      if (!keep({ kind: "calendar", calendar })) this.calendars.delete(calendar);
  }

  snapshot(): SyncStatuses {
    return {
      series: Object.fromEntries(this.series),
      instances: Object.fromEntries(
        [...this.instances].map(([routine, days]) => [routine, Object.fromEntries(days)]),
      ),
      calendars: Object.fromEntries(this.calendars),
      held: [...this.held.keys()].toSorted(),
    };
  }

  /** `connection` hears the statuses now, and each new value after, until it is dropped. */
  watch(connection: string, hear: Hear): Effect.Effect<void> {
    this.watchers.set(connection, hear);
    return hear(this.snapshot());
  }

  unwatch(connection: string): void {
    this.watchers.delete(connection);
  }

  /** Tell every watcher the statuses, when they differ from what was last told. */
  publish(): Effect.Effect<void> {
    const now = this.snapshot();
    const text = canonicalJson(now);
    if (text === this.published) return Effect.void;
    this.published = text;
    return Effect.forEach(this.watchers.values(), (hear) => hear(now), { discard: true });
  }
}
