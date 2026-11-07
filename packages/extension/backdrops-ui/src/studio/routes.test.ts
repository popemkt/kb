import { describe, expect, test } from "vitest";
import { matchStudio, studioPath } from "./routes";

describe("the studio's routes", () => {
  test("/backdrops is the gallery", () => {
    expect(matchStudio("/backdrops")).toEqual({});
    expect(matchStudio("/backdrops/")).toEqual({});
  });

  test("/backdrops/<id> is one backdrop, by its declared id, and leads back to itself", () => {
    expect(matchStudio("/backdrops/backdrops.black-hole")).toEqual({
      backdrop: "backdrops.black-hole",
    });
    expect(matchStudio(studioPath("yorha.arena"))).toEqual({ backdrop: "yorha.arena" });
    expect(studioPath()).toBe("/backdrops");
  });

  test("any other path is not the studio's", () => {
    expect(matchStudio("/backdropsx")).toBeNull();
    expect(matchStudio("/backdrops/a/b")).toBeNull();
    expect(matchStudio("/lab")).toBeNull();
  });
});
