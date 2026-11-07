/**
 * Where the home store lives: `KB_HOME` when set, else the platform's place
 * for app data — except in a test run, which has no default.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TestRunPathUnnamed, homePath, dataPath } from "../src/home.ts";

describe("the home store's place", () => {
  test("KB_HOME names it, resolved to an absolute path", () => {
    expect(homePath({ KB_HOME: "/tmp/somewhere/home" }, "darwin", "/Users/me")).toBe(
      "/tmp/somewhere/home",
    );
    expect(homePath({ KB_HOME: "relative" }, "linux", "/home/me")).toBe(
      join(process.cwd(), "relative"),
    );
  });

  test("unset, it is the platform's application data place", () => {
    expect(homePath({}, "darwin", "/Users/me")).toBe(
      "/Users/me/Library/Application Support/kb/home",
    );
    expect(homePath({ XDG_DATA_HOME: "/data" }, "linux", "/home/me")).toBe("/data/kb/home");
    expect(homePath({ XDG_DATA_HOME: "" }, "linux", "/home/me")).toBe(
      "/home/me/.local/share/kb/home",
    );
  });

  test("a test run with no KB_HOME is refused, never pointed at the person's", () => {
    expect(() => homePath({ NODE_ENV: "test" }, "darwin", "/Users/me")).toThrow(TestRunPathUnnamed);
    expect(homePath({ NODE_ENV: "test", KB_HOME: "/tmp/run/home" }, "darwin", "/Users/me")).toBe(
      "/tmp/run/home",
    );
  });
});

test("persistent data is explicit in tests and owns the default home", () => {
  expect(() => dataPath({ NODE_ENV: "test" }, "linux", "/home/me")).toThrow(TestRunPathUnnamed);
  expect(dataPath({ KB_DATA: "/scratch/data" }, "linux", "/home/me")).toBe("/scratch/data");
  expect(homePath({ KB_DATA: "/scratch/data" }, "linux", "/home/me")).toBe("/scratch/data/home");
});
