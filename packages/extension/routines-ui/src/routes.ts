import { CALENDAR_MODES, type CalendarParams } from "@kb/routines";

/** The calendar's page: `/calendar[/<mode>[/<YYYY-MM-DD>]]`. */
export const CALENDAR_PATH = "/calendar";

/** The path that opens the calendar in `mode` at `date`. */
export function calendarPath({ mode, date }: CalendarParams = {}): string {
  if (mode === undefined) return CALENDAR_PATH;
  return date === undefined ? `${CALENDAR_PATH}/${mode}` : `${CALENDAR_PATH}/${mode}/${date}`;
}

export function matchCalendar(path: string): CalendarParams | null {
  const match = /^\/calendar(?:\/([a-z]+)(?:\/(\d{4}-\d{2}-\d{2}))?)?\/?$/.exec(path);
  if (match === null) return null;
  const mode = CALENDAR_MODES.find((value) => value === match[1]);
  if (match[1] !== undefined && mode === undefined) return null;
  if (mode === undefined) return {};
  return match[2] === undefined ? { mode } : { mode, date: match[2] };
}
