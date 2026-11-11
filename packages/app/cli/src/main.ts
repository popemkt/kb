#!/usr/bin/env bun
// Supported launchers prevent preloads; the shared boundary validates before loading the runtime.
import { runProgram } from "./bootstrap.ts";
// Natural shutdown lets both output streams finish their pending pipe writes.
process.exitCode = await runProgram(() => import("./program.ts"));
