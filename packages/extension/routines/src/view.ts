/**
 * The routines calendar: a page that shows every routine's instances by day,
 * as a month, a week or an agenda, and edits them where they are. Its params
 * name only what it shows (the layout and the day it is open at); what it
 * draws is the graph's routines, read as the engine reads them.
 */
import { Schema } from "effect";
import { viewKey } from "@kb/views";

/** The calendar's layouts. */
export const CALENDAR_MODES = ["month", "week", "agenda"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export const CalendarParams = Schema.Struct({
  /** The layout; the page picks one for its width when none is named. */
  mode: Schema.optional(Schema.Literals(CALENDAR_MODES)),
  /** The local day (`YYYY-MM-DD`) it is open at; today when none is named. */
  date: Schema.optional(Schema.String),
});
export type CalendarParams = typeof CalendarParams.Type;

export const RoutinesCalendarView = viewKey(
  "routines.calendar",
  "Calendar",
  CalendarParams.annotate({
    description:
      "Events by day as a month, a week or an agenda: create, move, resize, tick done and skip their instances.",
  }),
);

export const SyncParams = Schema.Struct({
  /** The sync service (a `#google-account` node) whose setup is open; the list when none. */
  account: Schema.optional(Schema.String),
  /** Opened where Google sends the person back after its consent page. */
  returning: Schema.optional(Schema.Boolean),
});
export type SyncParams = typeof SyncParams.Type;

export const RoutinesSyncView = viewKey(
  "routines.sync",
  "Sync services",
  SyncParams.annotate({
    description:
      "The calendar's sync services: add one (Google), walk its setup step by step, connect it and pick the calendars it syncs.",
  }),
);

/** The sync services page, and one service's setup under it. */
export const SYNC_PATH = "/calendar/sync";
/**
 * Where Google sends the person back after its consent page: the redirect
 * URI an OAuth client lists, at the host's public origin. The page there
 * hands the URL it was opened at to `ext.routines.finish`.
 */
export const CONNECT_PATH = "/calendar/connect";
