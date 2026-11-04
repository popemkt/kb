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
      "Routines by day as a month, a week or an agenda: create, move, resize, tick done and skip their instances.",
  }),
);
