import { Effect } from "effect";
import { addDays, formatDay, parseDay, dayNumber } from "@kb/model";
import { SyncError, type RemoteEvent } from "./model.ts";
import {
  validateCalendarBatch,
  type CalendarMutation,
  type CalendarPort,
  type MutationOutcome,
} from "./ports.ts";

type Method = "create" | "get" | "write" | "instance" | "list";
interface Fault {
  readonly method: Method;
  readonly phase: "before" | "after";
  readonly error: SyncError;
}
interface Kept {
  readonly event: RemoteEvent;
  readonly revision: number;
}
interface Page {
  readonly events: readonly RemoteEvent[];
  readonly token: string;
}
const fault = (status: number, code: string) => new SyncError({ status, code });

/** Controllable CalendarPort implementation. No credentials or network. */
class FakeCalendar {
  readonly pageSize: number;
  constructor(pageSize: number) {
    this.pageSize = pageSize;
  }
  readonly calendars = new Map<string, Map<string, Kept>>();
  readonly instances = new Map<string, string>();
  readonly tokens = new Map<string, number>();
  readonly pages = new Map<string, Page>();
  readonly faults: Fault[] = [];
  readonly calls: { method: Method; size: number }[] = [];
  private revision = 0;
  private sequence = 0;
  readonly eventsOf = (calendar: string) => {
    const events = this.calendars.get(calendar);
    if (events === undefined) throw fault(404, "not_found");
    return events;
  };
  readonly hit = (method: Method, phase: Fault["phase"]) => {
    const index = this.faults.findIndex(
      (entry) => entry.method === method && entry.phase === phase,
    );
    if (index >= 0) throw this.faults.splice(index, 1)[0]?.error ?? fault(500, "fake_fault");
  };
  readonly save = (
    calendar: string,
    id: string,
    patch: Pick<RemoteEvent, "fields" | "deleted"> &
      Partial<Pick<RemoteEvent, "seriesId" | "originalStart">>,
  ) => {
    const previous = this.eventsOf(calendar).get(id)?.event;
    this.revision++;
    const event: RemoteEvent = {
      id,
      etag: '"' + this.revision + '"',
      url: "https://calendar.test/" + id,
      fields: patch.fields,
      deleted: patch.deleted || patch.fields?.status === "cancelled",
      runner: "fake-runner",
      ownedDrift: false,
      seriesId: patch.seriesId ?? previous?.seriesId ?? null,
      originalStart: patch.originalStart ?? previous?.originalStart ?? null,
    };
    this.eventsOf(calendar).set(id, { event: structuredClone(event), revision: this.revision });
    return structuredClone(event);
  };
  readonly get = (calendar: string, id: string) => {
    const kept = this.eventsOf(calendar).get(id);
    if (kept === undefined) throw fault(404, "not_found");
    return structuredClone(kept.event);
  };
  readonly apply = (calendar: string, change: CalendarMutation): MutationOutcome => {
    const previous = this.eventsOf(calendar).get(change.id)?.event;
    if (change.kind === "insert") {
      if (previous !== undefined)
        return { id: change.id, ok: false, error: fault(409, "already_exists") };
      return {
        id: change.id,
        ok: true,
        event: this.save(calendar, change.id, { fields: change.fields, deleted: false }),
      };
    }
    if (previous === undefined || (previous.deleted && previous.fields?.status !== "cancelled"))
      return { id: change.id, ok: false, error: fault(410, "deleted") };
    if (previous.etag !== change.etag)
      return { id: change.id, ok: false, error: fault(412, "precondition_failed") };
    if (change.kind === "remove") {
      this.save(calendar, change.id, { fields: null, deleted: true });
      return { id: change.id, ok: true, event: null };
    }
    return {
      id: change.id,
      ok: true,
      event: this.save(calendar, change.id, { fields: change.fields, deleted: false }),
    };
  };
  readonly run = <A>(method: Method, size: number, body: () => A) =>
    Effect.try({
      try: () => {
        this.calls.push({ method, size });
        this.hit(method, "before");
        const result = body();
        this.hit(method, "after");
        return result;
      },
      catch: (error) => (error instanceof SyncError ? error : fault(500, "fake_failed")),
    });
  readonly port: CalendarPort = {
    create: () =>
      this.run("create", 1, () => {
        const id = "calendar-" + ++this.sequence;
        this.calendars.set(id, new Map());
        return id;
      }),
    get: (calendar, id) => this.run("get", 1, () => this.get(calendar, id)),
    write: (calendar, changes) =>
      this.run("write", changes.length, () => {
        validateCalendarBatch(changes);
        return changes.map((change) => this.apply(calendar, change));
      }),
    instance: (calendar, series, originalTime) =>
      this.run("instance", 1, () => {
        const on = originalTime.day;
        const index = calendar + "/" + series + "/" + on;
        const existing = this.instances.get(index);
        if (existing !== undefined) return this.get(calendar, existing);
        const parent = this.get(calendar, series);
        if (parent.fields === null || parent.deleted || parent.fields.recurrence.length === 0)
          throw fault(404, "not_found");
        const original = parseDay(parent.fields.start.day);
        const end = parseDay(parent.fields.end.day);
        const requested = parseDay(on);
        if (original === null || end === null || requested === null)
          throw fault(400, "invalid_day");
        const id = "opaque-instance-" + ++this.sequence;
        const event = this.save(calendar, id, {
          deleted: false,
          seriesId: series,
          originalStart: { ...parent.fields.start, day: on },
          fields: {
            ...parent.fields,
            start: { ...parent.fields.start, day: on },
            end: {
              ...parent.fields.end,
              day: formatDay(addDays(requested, dayNumber(end) - dayNumber(original))),
            },
            recurrence: [],
          },
        });

        this.instances.set(index, id);
        return event;
      }),
    list: (calendar, token, page) =>
      this.run("list", 1, () => {
        let snapshot: Page;
        let offset = 0;
        let pageId: string;
        if (page === null) {
          const since = token === null ? 0 : this.tokens.get(token);
          if (since === undefined) throw fault(410, "invalid_sync_token");
          const nextToken = "token-" + ++this.sequence;
          this.tokens.set(nextToken, this.revision);
          snapshot = {
            events: [...this.eventsOf(calendar).values()]
              .filter((entry) => entry.revision > since)
              .map((entry) => structuredClone(entry.event)),
            token: nextToken,
          };
          pageId = "page-" + ++this.sequence;
          this.pages.set(pageId, snapshot);
        } else {
          const [name, position] = page.split(":");
          pageId = name ?? "";
          const known = this.pages.get(pageId);
          if (known === undefined) throw fault(400, "invalid_page");
          snapshot = known;
          offset = Number(position);
        }
        const events = snapshot.events.slice(offset, offset + this.pageSize);
        const nextPage =
          offset + this.pageSize < snapshot.events.length
            ? pageId + ":" + (offset + this.pageSize)
            : null;
        return { events, nextPage, nextToken: nextPage === null ? snapshot.token : null };
      }),
  };
  readonly inject = (method: Method, phase: Fault["phase"], error: SyncError) => {
    this.faults.push({ method, phase, error });
  };
  readonly expireTokens = () => this.tokens.clear();
  readonly snapshot = (calendar: string) =>
    [...this.eventsOf(calendar).values()].map(({ event }) => structuredClone(event));
}
export function makeFakeCalendar(pageSize = 2) {
  return new FakeCalendar(pageSize);
}
