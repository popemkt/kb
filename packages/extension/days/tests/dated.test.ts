import { describe, expect, test } from "bun:test";
import { dateDayReferences } from "../src/index.ts";

describe("dateDayReferences", () => {
  test("a date field's value names its day's node; any other value names nothing", () => {
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "date" })).toEqual([
      "days.2026-11-12",
    ]);
    expect(dateDayReferences({ t: "str", v: "" }, { type: "date" })).toEqual([]);
    expect(dateDayReferences({ t: "str", v: "2026-11-12" }, { type: "text" })).toEqual([]);
  });
});
