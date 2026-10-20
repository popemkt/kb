/**
 * `kb --governance required|off`: how the process is governed is the
 * deployment's to say, and anything else is a usage error.
 */
import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { toGovernance } from "../src/arguments.ts";

describe("--governance", () => {
  test.each(["required", "off"] as const)("%s is a mode", (mode) => {
    expect(toGovernance(mode)).toBe(mode);
  });

  test.each(["", "on", "Required", "optional"])("%p is a usage error", (value) => {
    expect(() => toGovernance(value)).toThrow(CommanderError);
  });
});
