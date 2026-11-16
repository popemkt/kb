/**
 * `kb ui --public-origin <url>` and `--alias-origin <url>`: each names a
 * browser origin a reverse proxy serves the UI at, kept as its bare origin;
 * aliases collect, in order. Anything but an HTTP(S) origin is a usage error
 * that names the option it was given for.
 */
import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { collectAliasOrigins, toPublicOrigin } from "../src/arguments.ts";

const NOT_ORIGINS = [
  "kb.localhost",
  "ftp://kb.localhost",
  "https://kb.localhost/path",
  "https://kb.localhost/?q=1",
  "https://kb.localhost/#x",
  "https://u:p@kb.localhost",
];

describe("--public-origin", () => {
  test("keeps the bare origin, a trailing slash dropped", () => {
    expect(toPublicOrigin("https://kb.tailnet.ts.net/")).toBe("https://kb.tailnet.ts.net");
  });

  test.each(NOT_ORIGINS)("%s is a usage error naming --public-origin", (value) => {
    expect(() => toPublicOrigin(value)).toThrow(/^--public-origin must be an HTTP\(S\) origin/);
  });
});

describe("--alias-origin", () => {
  test("collects each origin it is given, in order, as its bare origin", () => {
    const first = collectAliasOrigins("https://kb.localhost/");
    expect(collectAliasOrigins("http://kb.lan.test:8080", first)).toEqual([
      "https://kb.localhost",
      "http://kb.lan.test:8080",
    ]);
  });

  test.each(NOT_ORIGINS)("%s is a usage error naming --alias-origin", (value) => {
    expect(() => collectAliasOrigins(value)).toThrow(CommanderError);
    expect(() => collectAliasOrigins(value)).toThrow(/^--alias-origin must be/);
  });
});
