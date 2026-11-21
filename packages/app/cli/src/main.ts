#!/usr/bin/env bun
// Validate startup before importing the CLI and its runtime. Preloads run before any JS;
// supported launchers must supply the flags, since this check cannot undo executed code.
import { kbLaunchError, UNSAFE_KB_LAUNCH } from "@kb/child-process";
import { KB_SDK_VERSION } from "@kb/ext-sdk";
import { bareVersionRequest, versionJson } from "./version-option.ts";
const launchError = kbLaunchError(process.execArgv);
const versionRequest = bareVersionRequest(process.argv.slice(2));
if (launchError !== null) {
  process.stderr.write(`${launchError}\n`);
  process.exitCode = UNSAFE_KB_LAUNCH;
} else if (versionRequest === "text") {
  process.stdout.write(`${KB_SDK_VERSION}\n`);
} else if (versionRequest === "json") {
  const { WIRE_PROTOCOL } = await import("@kb/contracts");
  process.stdout.write(`${versionJson(WIRE_PROTOCOL)}\n`);
} else {
  const { main } = await import("./cli.ts");
  // Natural shutdown lets both output streams finish their pending pipe writes.
  process.exitCode = await main();
}
