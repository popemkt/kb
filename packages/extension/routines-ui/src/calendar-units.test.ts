/**
 * The calendar's arithmetic: the path it is opened at, the week grid's lanes, and a drop read back into its routine's zone.
 */
import { describe, expect, test } from "vitest";
import type { CalendarEntry } from "@kb/routines";
import { daysOf } from "@kb/calendar-kit";
import { instantOf } from "@kb/routines";
import { elapsed, instantAfter, minutesAt, placeAt, placeDay } from "./layout";
import { calendarPath, matchCalendar } from "./routes";
import { clockOf, lengthBetween, lengthText, newStart, parseTime } from "./time-text";

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
  test("an end is the first time after its start the clock names, across either DST change", () => {
    const NY = "America/New_York";
    // Nov 1 2026, New York repeats 01:00–02:00. An instance at the second 01:30 ends at the second 01:45.
    const second130 = Date.UTC(2026, 10, 1, 6, 30);
    expect(instantAfter(second130, "2026-11-01", 105, NY)).toBe(Date.UTC(2026, 10, 1, 6, 45));
    const first130 = Date.UTC(2026, 10, 1, 5, 30);
    expect(instantAfter(first130, "2026-11-01", 105, NY)).toBe(Date.UTC(2026, 10, 1, 5, 45));
    // Mar 8 2026 skips 02:00–03:00: 01:30 to 04:15 is 105 minutes.
    expect(elapsed("2026-03-08", 90, 255, NY)).toBe(105);
    expect(elapsed("2026-11-01", 60, 120, NY)).toBe(120);
    expect(elapsed("2026-11-04", 23 * 60, 1440, ZONE)).toBe(60);
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

describe("typed times", () => {
  test("what a person types reads as HH:MM, and what is not a time reads as nothing", () => {
    const read = [
      "9",
      "09",
      "930",
      "0930",
      "9:30",
      "9.30",
      "21:30",
      "2130",
      "9pm",
      "9:30 am",
      "12am",
      "12pm",
      "12:15p",
    ];
    expect(read.map(parseTime)).toEqual([
      "09:00",
      "09:00",
      "09:30",
      "09:30",
      "09:30",
      "09:30",
      "21:30",
      "21:30",
      "21:00",
      "09:30",
      "00:00",
      "12:00",
      "12:15",
    ]);
    expect(["24:00", "9:60", "13pm", "0am", "nine", "", "9:3"].map(parseTime)).toEqual(
      Array.from({ length: 7 }, () => null),
    );
  });
  test("lengths wrap past midnight and read in words", () => {
    expect(lengthBetween("09:00", "10:45")).toBe(105);
    expect(lengthBetween("23:00", "07:00")).toBe(480);
    expect(lengthBetween("09:00", "09:00")).toBe(0);
    expect([30, 60, 105, 1560].map(lengthText)).toEqual(["30 min", "1 h", "1 h 45 min", "26 h"]);
    expect(clockOf(24 * 60 + 15)).toBe("00:15");
  });
  test("a new routine starts at today's next half hour, at nine off today's range, tomorrow at nine late at night", () => {
    const week = daysOf("week", "2026-11-04");
    expect(newStart(week, "2026-11-04", 10 * 60, "2026-11-04")).toEqual({
      day: "2026-11-04",
      from: 630,
    });
    expect(newStart(week, "2026-11-04", 10 * 60 + 30, "2026-11-04")).toEqual({
      day: "2026-11-04",
      from: 660,
    });
    expect(newStart(week, "2026-11-04", 23 * 60 + 40, "2026-11-04")).toEqual({
      day: "2026-11-05",
      from: 540,
    });
    expect(newStart(daysOf("week", "2026-11-18"), "2026-11-04", 600, "2026-11-18")).toEqual({
      day: "2026-11-18",
      from: 540,
    });
  });
});
