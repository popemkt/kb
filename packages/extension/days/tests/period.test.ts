import { describe, expect, test } from "bun:test";
import {
  dayTitle,
  isDayKey,
  isoWeekOf,
  dayKeyAt,
  weekKey,
  weekTitle,
  yearKey,
} from "../src/period.ts";

describe("day keys", () => {
  test("a key names a real calendar date and nothing else", () => {
    expect(isDayKey("2026-11-10")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-11-10T09:00")).toBe(false);
    expect(isDayKey("Tue, Nov 10")).toBe(false);
  });

  test("an instant's day is read in the zone given", () => {
    const ms = Date.UTC(2026, 10, 10, 20, 30); // 20:30 UTC
    expect(dayKeyAt(ms, "UTC")).toBe("2026-11-10");
    expect(dayKeyAt(ms, "Asia/Ho_Chi_Minh")).toBe("2026-11-11");
    expect(dayKeyAt(ms, "America/Los_Angeles")).toBe("2026-11-10");
    expect(dayKeyAt(ms, "Not/AZone")).toBeNull();
  });
});

describe("ISO weeks", () => {
  test("a week belongs to the year its Thursday falls in", () => {
    // 2026-12-31 is a Thursday: week 53 of 2026; 2027-01-01..03 stay in it.
    expect(weekKey("2026-12-31")).toBe("2026-W53");
    expect(weekKey("2027-01-03")).toBe("2026-W53");
    expect(yearKey("2027-01-03")).toBe("2026");
    expect(weekKey("2027-01-04")).toBe("2027-W01");
    // 2024-12-30 is a Monday whose Thursday is in 2025.
    expect(weekKey("2024-12-30")).toBe("2025-W01");
    expect(yearKey("2024-12-30")).toBe("2025");
  });

  test("every day of a Monday-to-Sunday run shares one week", () => {
    const keys = [
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ].map(weekKey);
    expect(new Set(keys)).toEqual(new Set(["2026-W46"]));
    expect(weekKey("2026-11-16")).toBe("2026-W47");
  });

  test("weeks run 1 to 52 or 53 across a decade", () => {
    for (let y = 2020; y <= 2030; y++) {
      const last = isoWeekOf(`${y}-12-28`).week; // Dec 28 is always in the year's last week
      expect([52, 53]).toContain(last);
      expect(isoWeekOf(`${y}-01-04`)).toEqual({ year: y, week: 1 });
    }
  });
});

test("titles are the starting text, independent of the machine's zone", () => {
  expect(dayTitle("2026-11-10")).toBe("Tue, Nov 10");
  expect(weekTitle("2026-01-05")).toBe("Week 02");
});
