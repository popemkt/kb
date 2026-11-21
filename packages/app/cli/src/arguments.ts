/**
 * The CLI's option parsers: each turns one argument into its value or throws
 * the usage error (exit {@link EXIT_USAGE}) commander reports for it.
 */
import { CommanderError } from "commander";

/** What a command exits with when it was called wrong. */
export const EXIT_USAGE = 2;

export const toInt = (v: string): number => Number.parseInt(v, 10);

/** How the process is governed (`--governance`): `required` or `off`. */
export const toGovernance = (value: string): "required" | "off" => {
  if (value === "required" || value === "off") return value;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `--governance is required or off, not ${value}`,
  );
};
