/**
 * A horizontal scroller fades the edges past which more of its content lies
 * (`scrollEdgesOf`), and only those.
 */
import { describe, expect, it } from "vitest";
import { scrollEdgesOf } from "./edge-fade";

/** A scroller 800 wide over content 1200 wide, scrolled to `scrollLeft`. */
const at = (scrollLeft: number) =>
  scrollEdgesOf({ scrollLeft, scrollWidth: 1200, clientWidth: 800 });

describe("the edges a horizontal scroller hides more past", () => {
  it("are none when its content fits", () => {
    expect(scrollEdgesOf({ scrollLeft: 0, scrollWidth: 800, clientWidth: 800 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("is the end at the start, both in the middle, and the start at the end", () => {
    expect(at(0)).toEqual({ start: false, end: true });
    expect(at(200)).toEqual({ start: true, end: true });
    expect(at(400)).toEqual({ start: true, end: false });
  });

  it("counts a pixel's slack as none, as a scroller may stop a fraction short of its end", () => {
    expect(scrollEdgesOf({ scrollLeft: 399.5, scrollWidth: 1200, clientWidth: 800 }).end).toBe(
      false,
    );
    expect(scrollEdgesOf({ scrollLeft: 0.5, scrollWidth: 1200, clientWidth: 800 }).start).toBe(
      false,
    );
  });
});
