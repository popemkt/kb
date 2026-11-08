#!/usr/bin/env bun
// Validate startup before importing the CLI and its runtime. Preloads run before any JS;
// supported launchers must supply the flags, since this check cannot undo executed code.
import { kbLaunchError, UNSAFE_KB_LAUNCH } from "@kb/child-process";
const launchError = kbLaunchError(process.execArgv);
if (launchError !== null) {
  process.stderr.write(`${launchError}\n`);
  process.exit(UNSAFE_KB_LAUNCH);
}
const { main } = await import("./cli.ts");
process.exit(await main());
