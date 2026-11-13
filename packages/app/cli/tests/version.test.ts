import { expect, test } from "bun:test";
import { KB_SDK_VERSION } from "@kb/ext-sdk";
import { KB_SOURCE_BIN } from "@kb/test-kit";

/**
 * `kb --version` prints the stamped version, whether the launcher answers
 * it (the bare request) or the command table does (any other spelling).
 */
const SPELLINGS: readonly (readonly string[])[] = [
  ["--version"],
  ["-V"],
  ["--json", "--version"],
  ["get", "x", "--version"],
];
for (const args of SPELLINGS) {
  test(`kb ${args.join(" ")} prints the version and exits 0`, async () => {
    const child = Bun.spawn([KB_SOURCE_BIN, ...args], {
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code: await child.exited, stdout, stderr }).toEqual({
      code: 0,
      stdout: `${KB_SDK_VERSION}\n`,
      stderr: "",
    });
  });
}
