/**
 * The calendar's sync line counts writes, not the instances shown: each node
 * an instance reads its status from is one write, however many instances of
 * one series a week shows.
 */
import { describe, expect, test } from "vitest";
import type { CalendarEntry, SyncStatus } from "@kb/routines";
import type { CalendarChoice } from "./model";
import { syncSummary } from "./sync-shown";

const ZONE = "UTC";
const CALENDAR: CalendarChoice = { id: "cal", name: "Personal", mode: "on", zone: ZONE, ink: 0 };
const synced: SyncStatus = { state: "synced", message: "" };
const pending: SyncStatus = { state: "pending", message: "" };
const failed: SyncStatus = { state: "error", message: "unavailable" };

/** An instance of the series `gym` on `day`, its status read from `statusNode`. */
function instance(day: string, status: SyncStatus | null, statusNode: string): CalendarEntry {
  return {
    key: `gym:${day}`,
    routine: "gym",
    title: "Gym",
    on: day,
    series: true,
    day,
    at: "07:00",
    start: null,
    end: null,
    duration: 60,
    zone: ZONE,
    state: "scheduled",
    occurrence: statusNode === "gym" ? null : statusNode,
    calendar: CALENDAR.id,
    status,
    statusNode,
  };
}

const WEEK = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const summary = (entries: readonly CalendarEntry[]) =>
  syncSummary(
    {
      byDay: new Map(entries.map((entry) => [entry.day, [entry]])),
      calendars: new Map([[CALENDAR.id, CALENDAR]]),
    },
    ZONE,
  );

describe("the calendar's sync line", () => {
  test("one instance marked done is one write waiting, beside its synced series", () => {
    const entries = WEEK.map((day) =>
      day === "2026-11-18" ? instance(day, pending, "done-18") : instance(day, synced, "gym"),
    );
    expect(summary(entries)).toEqual({ state: "pending", text: "1 waiting" });
  });

  test("a series' own change is one write, however many of its instances are shown", () => {
    expect(summary(WEEK.map((day) => instance(day, pending, "gym")))).toEqual({
      state: "pending",
      text: "1 waiting",
    });
  });

  test("failures count by write too, and outrank waiting", () => {
    const entries = [
      instance(WEEK[0] ?? "", failed, "gym"),
      instance(WEEK[1] ?? "", failed, "gym"),
      instance(WEEK[2] ?? "", pending, "done-18"),
    ];
    expect(summary(entries)).toEqual({ state: "error", text: "1 failed" });
  });

  test("every write sent reads Synced", () => {
    expect(summary(WEEK.map((day) => instance(day, synced, "gym")))).toEqual({
      state: "synced",
      text: "Synced",
    });
  });
});
