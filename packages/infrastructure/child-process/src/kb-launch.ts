import text from "./kb-launch-flags.txt" with { type: "text" };
/** Shipped verbatim as lib/kb/launch-flags. Every supported adapter passes this contract. */
export const KB_LAUNCH_FLAGS: readonly string[] = Object.freeze(
  text
    .trim()
    .split("\n")
    .map((line) => line.trim()),
);
export const UNSAFE_KB_LAUNCH = 78;
/** Extra startup arguments could override config or execute a preload, so the contract is exact. */
export function kbLaunchError(execArgv: readonly string[]): string | null {
  const actual = execArgv.toSorted();
  const expected = KB_LAUNCH_FLAGS.toSorted();
  return actual.length === expected.length &&
    actual.every((argument, index) => argument === expected[index])
    ? null
    : `kb: unsafe Bun launch; use kb's launcher or pass exactly ${KB_LAUNCH_FLAGS.join(" ")} before cli.js. Repository .env and bunfig.toml must not configure kb.`;
}
