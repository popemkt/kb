/**
 * `kb ui --identity-header <header>=<login>`: each one names the header a
 * trusted proxy names the person in and one login that is them; repeated,
 * they collect the logins under the one header.
 */
import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { collectIdentity } from "../src/arguments.ts";

describe("--identity-header", () => {
  test("collects the logins under the one header it names", () => {
    const first = collectIdentity("Tailscale-User-Login=a@github", undefined);
    expect(collectIdentity("tailscale-user-login=b@github", first)).toEqual({
      header: "Tailscale-User-Login",
      people: ["a@github", "b@github"],
    });
  });

  test.each(["no-login=", "=a@github", "Tailscale-User-Login", "Bad Header=a@github"])(
    "%s is a usage error",
    (value) => {
      expect(() => collectIdentity(value, undefined)).toThrow(CommanderError);
    },
  );

  test("two different headers are a usage error", () => {
    const first = collectIdentity("Tailscale-User-Login=a@github", undefined);
    expect(() => collectIdentity("X-Forwarded-User=a", first)).toThrow(CommanderError);
  });
});
