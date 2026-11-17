/**
 * The host's sync statuses (docs/research/2026-11-02-kb-routines-gcal.md →
 * Status on nodes): one per write target, and the events whose ending is
 * held. The pass works them out here, and each is written on the node it is
 * for (`onNodes`). A fresh host fills the book with its first pass.
 */
import type { NodeLike } from "@kb/model";
import { routineOccurrences, type RemoteEvent, type SyncStatus } from "@kb/routines";
import type { CalendarTarget, Target } from "./reconcile.ts";

/** A calendar target's key: its node, and the former Google calendar when it is one. */
export function calendarKey(target: CalendarTarget): string {
  return target.former === undefined ? target.calendar : target.calendar + "@" + target.former;
}

/** A target's key: one string per target, whatever its kind. */
export function targetKey(target: Target): string {
  if (target.kind === "series") return "series:" + target.routine;
  if (target.kind === "instance") return "instance:" + target.routine + "/" + target.day;
  return "calendar:" + calendarKey(target);
}

/** How much a status says is wrong: a calendar node shows the worst of its Google calendars'. */
const WEIGHT = { synced: 0, pending: 1, error: 2 } as const;

/** The occurrence node `routine` holds for `day`, if it holds exactly one. */
function occurrenceOn(
  routine: NodeLike | undefined,
  day: string,
  nodes: ReadonlyMap<string, NodeLike>,
): string | undefined {
  if (routine === undefined) return undefined;
  try {
    return routineOccurrences(routine, nodes).get(day)?.node.id;
  } catch {
    return undefined;
  }
}

export class StatusBook {
  private readonly series = new Map<string, SyncStatus>();
  private readonly instances = new Map<string, Map<string, SyncStatus>>();
  private readonly calendars = new Map<
    string,
    { readonly target: CalendarTarget; readonly status: SyncStatus }
  >();
  /** Each event whose ending waits for a release, with the Google id of the series that would end. */
  readonly held = new Map<string, string>();

  get(target: Target): SyncStatus | undefined {
    if (target.kind === "series") return this.series.get(target.routine);
    if (target.kind === "instance") return this.instances.get(target.routine)?.get(target.day);
    return this.calendars.get(calendarKey(target))?.status;
  }

  set(target: Target, status: SyncStatus): void {
    if (target.kind === "series") this.series.set(target.routine, status);
    else if (target.kind === "calendar")
      this.calendars.set(calendarKey(target), { target, status });
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
    for (const [key, { target }] of this.calendars) if (!keep(target)) this.calendars.delete(key);
  }

  /**
   * Each status, keyed by the node it is written on: a series on its event,
   * an instance on its occurrence, and a calendar's on its calendar node. A
   * calendar node shows the worst of its Google calendar's and those it
   * named before, a former one's message naming the Google calendar.
   */
  onNodes(nodes: ReadonlyMap<string, NodeLike>): ReadonlyMap<string, SyncStatus> {
    const on = new Map<string, SyncStatus>();
    for (const [routine, status] of this.series) on.set(routine, status);
    for (const [routine, days] of this.instances)
      for (const [day, status] of days) {
        // GAP [[01M7JGRXEA5AWPZS3SKTRQY45E]] a day back to its series' default has no node to say its write waits.
        const occurrence = occurrenceOn(nodes.get(routine), day, nodes);
        if (occurrence !== undefined) on.set(occurrence, status);
      }
    for (const { target, status } of this.calendars.values()) {
      const shown =
        target.former === undefined || status.message === ""
          ? status
          : { ...status, message: target.former + ": " + status.message };
      const before = on.get(target.calendar);
      if (before === undefined || WEIGHT[shown.state] > WEIGHT[before.state])
        on.set(target.calendar, shown);
    }
    return on;
  }
}
