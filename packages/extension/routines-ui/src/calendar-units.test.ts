/**
 * The calendar's arithmetic: the path it is opened at, the days each layout
 * shows, the week grid's lanes, and a drop read back into its routine's zone.
 */
import { describe, expect, test } from "vitest";
import type { CalendarEntry } from "@kb/routines";
import { instantOf } from "@kb/routines";
import { daysOf, stepAnchor, titleOf, weekStartOf } from "./dates";
import { minutesAt, placeAt, placeDay } from "./layout";
import { calendarPath, matchCalendar } from "./routes";

describe("routes", () => {
  test("a path names a layout and a day, and reads back", () => {
    expect(matchCalendar("/calendar")).toEqual({});
    expect(matchCalendar("/calendar/month")).toEqual({ mode: "month" });
    expect(matchCalendar("/calendar/week/2026-11-04")).toEqual({
      mode: "week",
      date: "2026-11-04",
    });
    expect(matchCalendar("/calendar/year")).toBeNull();
    expect(matchCalendar("/gallery")).toBeNull();
    expect(calendarPath({ mode: "agenda", date: "2026-11-04" })).toBe(
      "/calendar/agenda/2026-11-04",
    );
  });
});

describe("days", () => {
  test("weeks start on Monday; a month shows the weeks that cover it", () => {
    expect(weekStartOf("2026-11-04")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    const month = daysOf("month", "2026-11-17");
    expect(month[0]).toBe("2026-10-26");
    expect(month).toHaveLength(42);
    expect(month[month.length - 1]).toBe("2026-12-06");
    expect(daysOf("month", "2027-02-10")).toHaveLength(28);
    expect(daysOf("agenda", "2026-11-04")).toHaveLength(14);
  });
  test("a step moves by the layout's span, and a range is titled", () => {
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepAnchor("week", "2026-11-04", -1)).toBe("2026-10-28");
    expect(titleOf("month", "2026-11-04")).toBe("November 2026");
    expect(titleOf("week", "2026-11-04")).toBe("Nov 2 – 8, 2026");
    expect(titleOf("week", "2026-12-30")).toBe("Dec 28 – Jan 3, 2027");
  });
});

const ZONE = "Asia/Ho_Chi_Minh";
function timed(key: string, at: string, minutes: number): CalendarEntry {
  const start = instantOf("2026-11-04", at, ZONE);
  return {
    key,
    routine: key,
    title: key,
    on: "2026-11-04",
    series: false,
    day: "2026-11-04",
    at,
    start,
    end: start + minutes * 60_000,
    duration: minutes,
    zone: ZONE,
    state: "scheduled",
    occurrence: null,
    calendar: "",
    status: null,
  };
}

describe("the week grid", () => {
  test("overlapping instances share the width in lanes; a later one starts a new group", () => {
    const placed = placeDay(
      [timed("a", "09:00", 60), timed("b", "09:30", 60), timed("c", "11:00", 30)],
      "2026-11-04",
      ZONE,
    );
    expect(placed.map((p) => [p.entry.key, p.top, p.height, p.lane, p.lanes])).toEqual([
      ["a", 540, 60, 0, 2],
      ["b", 570, 60, 1, 2],
      ["c", 660, 30, 0, 1],
    ]);
  });
  test("an instance past midnight is cut at the day's end; a pointer reads the quarter hour it is in", () => {
    const [late] = placeDay([timed("late", "23:30", 90)], "2026-11-04", ZONE);
    expect([late?.top, late?.height]).toEqual([1410, 30]);
    expect(minutesAt(48 * 9 + 5)).toBe(540);
    expect(minutesAt(48 * 9 + 20)).toBe(555);
    expect(minutesAt(-30)).toBe(0);
  });
  test("a drop on the page's clock is stored on the routine's", () => {
    expect(placeAt("2026-11-04", 9 * 60, "Europe/Berlin", ZONE)).toEqual({
      day: "2026-11-04",
      at: "15:00",
    });
    expect(placeAt("2026-11-04", 23 * 60, "Europe/Berlin", ZONE)).toEqual({
      day: "2026-11-05",
      at: "05:00",
    });
  });
});
