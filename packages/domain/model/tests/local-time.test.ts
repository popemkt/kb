import { expect, test } from "bun:test";
import { conformsToType, parseTypedValue } from "../src/field-value.ts";

test("every minute round trips through the shared parser and write check", () => {
  for (let minute = 0; minute < 1440; minute++) {
    const v = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    expect(parseTypedValue(v, "time")).toEqual({ ok: true, value: { t: "str", v } });
    expect(conformsToType("time", { t: "str", v })).toBe(true);
  }
});

test("time refuses dates, zones, seconds and impossible wall clocks", () => {
  for (const v of ["24:00", "12:60", "7:30", "07:30:00", "07:30Z", "2026-11-02", "-1:00"]) {
    expect(parseTypedValue(v, "time").ok).toBe(false);
    expect(conformsToType("time", { t: "str", v })).toBe(false);
  }
  expect(parseTypedValue(" 07:30 ", "time")).toEqual({ ok: true, value: { t: "str", v: "07:30" } });
  expect(conformsToType("time", { t: "str", v: " 07:30 " })).toBe(false);
  expect(conformsToType("time", { t: "num", v: 730 })).toBe(false);
  expect(conformsToType("time", { t: "str", v: "" })).toBe(true);
});
