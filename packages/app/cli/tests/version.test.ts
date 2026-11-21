import { expect, test } from "bun:test";
import { KbVersionSchema, WIRE_PROTOCOL } from "@kb/contracts";
import { KB_SDK_VERSION } from "@kb/ext-sdk";
import { KB_SOURCE_BIN } from "@kb/test-kit";

/**
 * `kb --version` prints the stamped version, whether the launcher answers
 * it (the bare request) or the command table does (any other spelling).
 * With `--json` it prints which kb this is as `KbVersionSchema`: the
 * version and the wire protocol it serves.
 */
async function kb(args: readonly string[]) {
  const child = Bun.spawn([KB_SOURCE_BIN, ...args], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code: await child.exited, stdout, stderr };
}

const TEXT: readonly (readonly string[])[] = [["--version"], ["-V"], ["get", "x", "--version"]];
for (const args of TEXT) {
  test(`kb ${args.join(" ")} prints the version and exits 0`, async () => {
    expect(await kb(args)).toEqual({ code: 0, stdout: `${KB_SDK_VERSION}\n`, stderr: "" });
  });
}

const JSON_FORMS: readonly (readonly string[])[] = [
  ["--version", "--json"],
  ["--json", "--version"],
  ["-V", "--json"],
  ["get", "x", "--version", "--json"],
];
for (const args of JSON_FORMS) {
  test(`kb ${args.join(" ")} prints the version and the wire protocol as JSON`, async () => {
    const { code, stdout, stderr } = await kb(args);
    expect({ code, stderr, lines: stdout.split("\n").length }).toEqual({
      code: 0,
      stderr: "",
      lines: 2,
    });
    expect(KbVersionSchema.parse(JSON.parse(stdout))).toEqual({
      version: KB_SDK_VERSION,
      protocol: WIRE_PROTOCOL,
    });
  });
}
