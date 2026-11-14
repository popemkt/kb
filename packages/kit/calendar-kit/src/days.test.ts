/** A calendar's days: the range each layout shows, a step, and a range's title. */
import { describe, expect, test } from "vitest";
import { daysOf, stepAnchor, titleOf, weekStartOf } from "./days";

describe("a calendar's days", () => {
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
  test("a day shows itself, steps a day, and is titled by its date", () => {
    expect(daysOf("day", "2026-11-14")).toEqual(["2026-11-14"]);
    expect(stepAnchor("day", "2026-11-30", 1)).toBe("2026-12-01");
    expect(titleOf("day", "2026-11-14")).toBe("Sat, Nov 14, 2026");
  });
});
