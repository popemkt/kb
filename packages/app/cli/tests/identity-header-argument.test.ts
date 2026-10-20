/**
 * `kb ui --identity-header <header>=<login>`: each one names the header a
 * trusted proxy names the person in and one login that is them; repeated,
 * they collect the logins under the one header.
 */
import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { checkUiListen, collectIdentity } from "../src/arguments.ts";

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

describe("where kb ui listens", () => {
  const header = { header: "Tailscale-User-Login", people: ["a@github"] };
  const origin = "https://kb.tailnet.ts.net";

  test("a TCP port takes no identity header; a socket with its proxy's origin does", () => {
    expect(() => checkUiListen({ port: 4321 })).not.toThrow();
    expect(() => checkUiListen({ identityHeader: header })).toThrow(CommanderError);
    expect(() =>
      checkUiListen({ socket: "/run/kb/kb.sock", publicOrigin: origin, identityHeader: header }),
    ).not.toThrow();
  });

  test.each([
    { socket: "/run/kb/kb.sock" },
    { socket: "/run/kb/kb.sock", publicOrigin: origin, port: 4321 },
    { socket: "/run/kb/kb.sock", publicOrigin: origin, dev: true },
    { socket: "/run/kb/kb.sock", publicOrigin: origin, devPort: 5173 },
  ])("%o is a usage error", (args) => {
    expect(() => checkUiListen(args)).toThrow(CommanderError);
  });
});
