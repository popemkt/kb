import type { SyncStatus } from "@kb/routines";

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

/**
 * What an instance's dot shows, and what it says when hovered: its status
 * while its calendar sends, and that nothing is sent while the calendar is
 * in preview or paused (whatever status the engine last wrote), or when the
 * routine is on no calendar.
 */
export function syncShown(
  status: SyncStatus | null,
  calendarMode: string | undefined,
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
      text: `Synced to Google Calendar${status.at === undefined ? "" : ` at ${status.at}`}${detail}`,
    };
  if (status.state === "pending") return { state: "pending", text: `Waiting to sync${detail}` };
  return { state: "error", text: `Sync failed${detail}` };
}
