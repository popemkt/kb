import { describe, expect, it } from "vitest";
import { wrapGraphLabel } from "./graph-label";
const measure = (text: string) =>
  Array.from(text).reduce((width, char) => width + (char === "W" ? 12 : 6), 0);
describe("graph label space", () => {
  it("wraps tree labels without losing text", () => {
    const text = "A useful relationship between two ideas and one extraordinarilylongword";
    const lines = wrapGraphLabel(text, measure, 110);
    expect(lines.every((line) => measure(line) <= 110)).toBe(true);
    expect(lines.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
});
