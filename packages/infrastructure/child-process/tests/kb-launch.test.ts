import { expect, test } from "bun:test";
import { KB_LAUNCH_FLAGS, kbLaunchError, UNSAFE_KB_LAUNCH } from "../src/index.ts";
test("KB launch policy accepts only the exact published flags, in either order", () => {
  expect(kbLaunchError(KB_LAUNCH_FLAGS)).toBeNull();
  expect(kbLaunchError(KB_LAUNCH_FLAGS.toReversed())).toBeNull();
  expect(UNSAFE_KB_LAUNCH).toBe(78);
  for (const args of [
    [],
    KB_LAUNCH_FLAGS.slice(1),
    KB_LAUNCH_FLAGS.slice(0, 1),
    [...KB_LAUNCH_FLAGS, "--preload=evil.ts"],
    [...KB_LAUNCH_FLAGS, "--env-file=evil"],
    [...KB_LAUNCH_FLAGS, "--config=evil.toml"],
  ])
    expect(kbLaunchError(args)).toContain("unsafe Bun launch");
});
