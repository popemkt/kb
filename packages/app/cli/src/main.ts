#!/usr/bin/env bun
// Validate startup before importing the CLI and its runtime. Preloads run before any JS;
// supported launchers must supply the flags, since this check cannot undo executed code.
import { kbLaunchError, UNSAFE_KB_LAUNCH } from "@kb/child-process";
const launchError = kbLaunchError(process.execArgv);
if (launchError !== null) {
  process.stderr.write(`${launchError}\n`);
  process.exitCode = UNSAFE_KB_LAUNCH;
} else {
  const { main } = await import("./cli.ts");
  // Natural shutdown lets both output streams finish their pending pipe writes.
  process.exitCode = await main();
}
