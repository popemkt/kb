/**
 * `kb --version`, one flag set over one value (`KB_SDK_VERSION`, the
 * version the build stamped). The launcher (`main.ts`) answers the bare
 * request before it imports the command table, so asking which kb this is
 * loads no runtime. The command table declares the same flags, so every
 * other spelling, and the line in `kb --help`, stay commander's.
 */
export const VERSION_FLAGS = "-V, --version";

/** Exactly one argument, and it is a version flag: the form the launcher answers. */
export function isBareVersionRequest(args: readonly string[]): boolean {
  return args.length === 1 && VERSION_FLAGS.split(", ").includes(args[0] ?? "");
}
