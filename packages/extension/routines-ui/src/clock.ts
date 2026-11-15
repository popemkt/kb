/**
 * The calendar's clock: the zone the page shows times in and what "now" is.
 * The page reads the browser's; a test or a story hands it its own.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { untilNextMinute } from "./event-moment";

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

/**
 * What `clock` says now. While `ticking`, the component is drawn again at
 * each whole minute, so what it says of the time follows the clock on its
 * own; otherwise it reads the clock when it is drawn.
 */
export function useClockNow(clock: CalendarClock, ticking: boolean): number {
  const [tick, setTick] = useState(() => clock.now());
  useEffect(() => {
    if (!ticking) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const at = clock.now();
      setTick(at);
      timer = setTimeout(step, untilNextMinute(at));
    };
    timer = setTimeout(step, untilNextMinute(clock.now()));
    return () => clearTimeout(timer);
  }, [clock, ticking]);
  return ticking ? Math.max(tick, clock.now()) : clock.now();
}
