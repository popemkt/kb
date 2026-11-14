/**
 * The row a list with detail shows (DESIGN-UI.md → List with detail): the
 * one the screen holds while it is still a row, else the first, else none.
 */
import { describe, expect, test } from "bun:test";
import { detailRowOf } from "@kb/views";

describe("detailRowOf", () => {
  test("shows the held row while it is one of the rows", () => {
    expect(detailRowOf(["a", "b", "c"], "b")).toBe("b");
  });
  test("falls back to the first row when nothing is held or the held row is gone", () => {
    expect(detailRowOf(["a", "b"], null)).toBe("a");
    expect(detailRowOf(["a", "b"], "gone")).toBe("a");
  });
  test("shows nothing when there are no rows", () => {
    expect(detailRowOf([], "a")).toBeNull();
  });
});
