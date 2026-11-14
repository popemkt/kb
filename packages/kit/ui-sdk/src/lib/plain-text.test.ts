/** A node's text as plain words (`plainText`). */
import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

const textOf = (id: string) => (id === "ship" ? "Ship" : undefined);

describe("a node's text as plain words", () => {
  it("reads references by their labels and drops media and markup", () => {
    expect(plainText("- A keeper alone with [[ship|the ship]]", textOf)).toBe(
      "A keeper alone with the ship",
    );
    expect(plainText("with [[ship]] **now**", textOf)).toBe("with Ship now");
    expect(plainText("![storm](assets/storm.png)", textOf)).toBe("");
    expect(plainText("Fog at [dawn](https://example.com)", textOf)).toBe("Fog at dawn");
  });
});
