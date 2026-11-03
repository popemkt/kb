/**
 * The calendar's clock: the zone the page shows times in and what "now" is.
 * The page reads the browser's; a test or a story hands it its own.
 */
import { createContext, useContext } from "react";

export interface CalendarClock {
  readonly zone: string;
  readonly now: () => number;
}

const BROWSER_CLOCK: CalendarClock = {
  zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  now: () => Date.now(),
};

export const CalendarClockContext = createContext<CalendarClock>(BROWSER_CLOCK);

export function useCalendarClock(): CalendarClock {
  return useContext(CalendarClockContext);
}
