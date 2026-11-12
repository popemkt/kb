#!/usr/bin/env bun
/** The installed entry validates startup before loading the captured application artifact. */
import { Effect } from "effect";
import { runProgram } from "./bootstrap.ts";
import { loadPackagedProgram } from "./package-image.ts";

process.exitCode = await runProgram(() => Effect.runPromise(loadPackagedProgram(import.meta.dir)));
