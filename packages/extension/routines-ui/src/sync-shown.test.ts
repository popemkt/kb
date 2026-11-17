/**
 * The calendar's sync line counts writes, not the instances shown: each
 * target the host keeps a status for is one write, however many instances of
 * one series a week shows, and a sending calendar's own status is one too.
 */
import { describe, expect, test } from "vitest";
import { NO_STATUSES, type CalendarEntry, type SyncStatus, type SyncStatuses } from "@kb/routines";
import type { CalendarChoice } from "./model";
import { syncSummary } from "./sync-shown";

const ZONE = "UTC";
const CALENDAR: CalendarChoice = { id: "cal", name: "Personal", mode: "on", zone: ZONE, ink: 0 };
const synced: SyncStatus = { state: "synced", message: "" };
const pending: SyncStatus = { state: "pending", message: "" };
const failed: SyncStatus = { state: "error", message: "unavailable" };

const WEEK = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];

/** An instance of the series `gym` on `day`. */
function instance(day: string): CalendarEntry {
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
    occurrence: null,
    calendar: CALENDAR.id,
  };
}

/** The host's statuses: the series' and those of the days named. */
function statuses(
  series: SyncStatus | null,
  days: Readonly<Record<string, SyncStatus>> = {},
  calendar: SyncStatus | null = null,
): SyncStatuses {
  return {
    ...NO_STATUSES,
    series: series === null ? {} : { gym: series },
    instances: { gym: days },
    calendars: calendar === null ? {} : { [CALENDAR.id]: calendar },
  };
}

const summary = (held: SyncStatuses) =>
  syncSummary(
    {
      byDay: new Map(WEEK.map((day) => [day, [instance(day)]])),
      calendars: new Map([[CALENDAR.id, CALENDAR]]),
    },
    held,
    ZONE,
  );

describe("the calendar's sync line", () => {
  test("one instance marked done is one write waiting, beside its synced series", () => {
    expect(summary(statuses(synced, { "2026-11-18": pending }, synced))).toEqual({
      state: "pending",
      text: "1 waiting",
    });
  });

  test("a series' own change is one write, however many of its instances are shown", () => {
    expect(summary(statuses(pending, {}, synced))).toEqual({ state: "pending", text: "1 waiting" });
  });

  test("failures count by write too, and outrank waiting", () => {
    expect(summary(statuses(failed, { "2026-11-18": pending }, synced))).toEqual({
      state: "error",
      text: "1 failed",
    });
  });

  test("a calendar whose list or endings failed is a failed write of its own", () => {
    expect(summary(statuses(failed, {}, failed))).toEqual({ state: "error", text: "2 failed" });
  });

  test("a former Google calendar whose series wait for release is a failed write too", () => {
    const held = {
      ...statuses(synced, {}, synced),
      calendars: {
        [CALENDAR.id]: synced,
        [CALENDAR.id + "@old-google"]: { state: "error" as const, message: "held" },
      },
    };
    expect(summary(held)).toEqual({ state: "error", text: "1 failed" });
  });

  test("every write sent reads Synced", () => {
    expect(summary(statuses(synced, {}, synced))).toEqual({ state: "synced", text: "Synced" });
  });

  test("nothing heard from the host claims nothing synced", () => {
    expect(summary(NO_STATUSES)).toEqual({ state: "none", text: "Not synced yet" });
  });
});
