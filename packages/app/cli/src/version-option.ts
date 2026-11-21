/**
 * `kb --version`, one flag set over one value (`KB_SDK_VERSION`, the
 * version the build stamped); with `--json`, which kb this is
 * (`versionJson`). The launcher (`main.ts`) answers the bare request, with
 * or without `--json`, before it imports the command table, so asking which
 * kb this is loads no runtime. The command table declares the same flags,
 * so every other spelling, and the line in `kb --help`, stay commander's.
 */
import type { KbVersion } from "@kb/contracts";
import { KB_SDK_VERSION } from "@kb/ext-sdk";

export const VERSION_FLAGS = "-V, --version";

/**
 * The request the launcher answers itself: a version flag alone is `text`,
 * a version flag and `--json` is `json`, and anything else is the command
 * table's (`null`).
 */
export function bareVersionRequest(args: readonly string[]): "text" | "json" | null {
  const isFlag = (arg: string) => VERSION_FLAGS.split(", ").includes(arg);
  const rest = args.filter((arg) => !isFlag(arg));
  if (args.length - rest.length !== 1) return null;
  if (rest.length === 0) return "text";
  return rest.length === 1 && rest[0] === "--json" ? "json" : null;
}

/**
 * What `kb --version --json` prints (`KbVersionSchema`): this kb's version
 * and the wire protocol it serves. The caller passes `WIRE_PROTOCOL`, so
 * the launcher loads `@kb/contracts` only when it is asked for JSON.
 */
export function versionJson(protocol: number): string {
  return JSON.stringify({ version: KB_SDK_VERSION, protocol } satisfies KbVersion);
}
