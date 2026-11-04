import { expect, test } from "bun:test";

/** Playwright loads the bundled declarations through Node's ESM loader. */
test("the shared entry loads in Node ESM as well as Bun", () => {
  const result = Bun.spawnSync(
    [
      "node",
      "--input-type=module",
      "--eval",
      "await import(process.argv[1])",
      new URL("../src/index.ts", import.meta.url).href,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
