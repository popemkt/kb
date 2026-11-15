/** A table's calculations (DESIGN-UI.md → Calculations): what a column offers, and what one makes. */
import { describe, expect, test } from "bun:test";
import type { PropValue } from "@kb/model";
import { calculate, calculationsFor } from "@kb/views";

const num = (v: number): PropValue => ({ t: "num", v });

describe("a column's calculations", () => {
  test("a number column offers all six, any other column count alone", () => {
    expect(calculationsFor("number")).toEqual(["count", "sum", "average", "median", "min", "max"]);
    expect(calculationsFor("text")).toEqual(["count"]);
    expect(calculationsFor("date")).toEqual(["count"]);
  });

  test("count counts the rows that hold a value, of any type", () => {
    expect(calculate("count", [num(1), undefined, { t: "str", v: "x" }])).toBe(2);
  });

  test("the number calculations read the number values only", () => {
    const values = [num(4), undefined, num(1), { t: "str", v: "9" } as PropValue, num(10)];
    expect(calculate("sum", values)).toBe(15);
    expect(calculate("average", values)).toBe(5);
    expect(calculate("median", values)).toBe(4);
    expect(calculate("min", values)).toBe(1);
    expect(calculate("max", values)).toBe(10);
    expect(calculate("median", [num(1), num(2), num(3), num(10)])).toBe(2.5);
  });

  test("a number calculation with no number has no result", () => {
    expect(calculate("sum", [undefined, { t: "str", v: "a" }])).toBeNull();
  });
});
