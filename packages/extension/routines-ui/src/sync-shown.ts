import { entryStatus, type SyncStatus, type SyncStatuses } from "@kb/routines";
import { momentText } from "./layout";
import type { CalendarModel } from "./model";

/** How an instance stands with Google, as the page draws it. */
export type SyncShown = "synced" | "pending" | "error" | "none";

/** The dot for each state: the one palette every sync dot on the page uses. */
export const SYNC_DOTS: Readonly<Record<SyncShown, string>> = {
  synced: "bg-success",
  pending: "bg-warning",
  error: "bg-destructive",
  none: "border border-faint-foreground bg-transparent",
};

const NOT_SENDING: Readonly<Record<string, string>> = {
  preview: "the calendar is in preview",
  paused: "the calendar is paused",
};

/** When the engine says it synced, as the box says a time; what is no instant stays as written. */
function syncedAt(at: string, zone: string): string {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at : momentText(ms, zone);
}

/**
 * What an instance's dot shows, and what it says when hovered: its status
 * while its calendar sends, and that nothing is sent while the calendar is
 * in preview or paused (whatever status the engine last wrote), or when the
 * routine is on no calendar. When it synced is said on the wall clock of
 * `zone`, as the box's other times are.
 */
export function syncShown(
  status: SyncStatus | null,
  calendarMode: string | undefined,
  zone: string,
): { readonly state: SyncShown; readonly text: string } {
  if (calendarMode === undefined) return { state: "none", text: "Not synced: on no calendar" };
  if (calendarMode !== "on")
    return {
      state: "none",
      text: `Not synced: ${NOT_SENDING[calendarMode] ?? "the calendar's sync setting is not readable"}`,
    };
  if (status === null) return { state: "none", text: "Not synced yet" };
  const detail = status.message === "" ? "" : ` — ${status.message}`;
  if (status.state === "synced")
    return {
      state: "synced",
      text: `Synced to Google Calendar${status.at === undefined ? "" : ` at ${syncedAt(status.at, zone)}`}${detail}`,
    };
  if (status.state === "pending") return { state: "pending", text: `Waiting to sync${detail}` };
  return { state: "error", text: `Sync failed${detail}` };
}

/**
 * How the instances shown stand with Google: the worst state among them,
 * counted in writes (`entryStatus`), so a series' change is one however many
 * of its instances are shown. A sending calendar's own status (its list call
 * and the endings of its gone series) is one write too, and so is a former
 * Google calendar's, whose series the host is ending. A sending write the
 * host has said nothing of is not claimed synced.
 */
export function syncSummary(
  model: Pick<CalendarModel, "byDay" | "calendars">,
  statuses: SyncStatuses,
  zone: string,
): { readonly state: SyncShown; readonly text: string } {
  const writes = new Map<string, { readonly status: SyncStatus | null; readonly mode?: string }>();
  for (const entry of [...model.byDay.values()].flat()) {
    const { status, write } = entryStatus(statuses, entry);
    writes.set(write, { status, mode: model.calendars.get(entry.calendar)?.mode });
  }
  for (const [id, calendar] of model.calendars)
    writes.set("calendar/" + id, { status: statuses.calendars[id] ?? null, mode: calendar.mode });
  // A Google calendar no calendar names now, whose series the host is ending.
  for (const [id, status] of Object.entries(statuses.calendars))
    if (!model.calendars.has(id)) writes.set("calendar/" + id, { status, mode: "on" });
  const shown = [...writes.values()].map(({ status, mode }) => syncShown(status, mode, zone).state);
  const failed = shown.filter((state) => state === "error").length;
  const waiting = shown.filter((state) => state === "pending").length;
  if (failed > 0) return { state: "error", text: `${String(failed)} failed` };
  if (waiting > 0) return { state: "pending", text: `${String(waiting)} waiting` };
  const sending = [...writes.values()].filter(({ mode }) => mode === "on");
  if (sending.length === 0) return { state: "none", text: "Not syncing" };
  if (sending.some(({ status }) => status === null))
    return { state: "none", text: "Not synced yet" };
  return { state: "synced", text: "Synced" };
}
