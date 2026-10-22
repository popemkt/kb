import { describe, expect, it } from "vitest";
import { outlineLocationOf, outlinePath, type OutlineLocation } from "./router";

describe("the outline location", () => {
  const places: readonly [OutlineLocation, string][] = [
    [{ ontology: null, zoom: null }, "/"],
    [{ ontology: null, zoom: "n.a" }, "/outline/n.a"],
    [{ ontology: "o.1", zoom: null }, "/o/o.1/outline"],
    [{ ontology: "o.1", zoom: "n.a" }, "/o/o.1/outline/n.a"],
    [{ ontology: null, zoom: "a b/c" }, "/outline/a%20b%2Fc"],
  ];

  it.each(places)("%o is %s, and reads back", (at, path) => {
    expect(outlinePath(at)).toBe(path);
    expect(outlineLocationOf(path)).toEqual(at);
  });

  it("names no place for any other path, or one that does not decode", () => {
    for (const path of [
      "/outline",
      "/graph",
      "/node/n.a",
      "/o/o.1",
      "/o/o.1/graph",
      "/outline/%E0%A4%A",
    ]) {
      expect(outlineLocationOf(path)).toBeNull();
    }
  });
});
