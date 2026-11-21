#!/usr/bin/env bun
import { Command } from "commander";
import { WIRE_PROTOCOL } from "@kb/contracts";
import { KB_SDK_VERSION } from "@kb/ext-sdk";
import { deployGovernance, type GovernanceMode } from "@kb/runtime";
import { toGovernance } from "./arguments.ts";
import { EXIT_OK, handleCliError } from "./command.ts";
import { VERSION_FLAGS, versionJson } from "./version-option.ts";

/** What a command module adds to the program: the commands it declares, with their options. */
type Declare = (program: Command) => void;

/**
 * The command table: every `kb` command by name, in the order help lists
 * them, with the module under `commands/` that declares it. A module is
 * loaded only when one of its commands is the one run, so a command's
 * options, their parsers and its own code cost every other command nothing
 * (the CLI row of `LAZY_FENCES` holds `commands/` behind these imports).
 * Help, and a name no row holds, load every module, so commander lists
 * them all and suggests the nearest.
 */
const COMMANDS: readonly {
  readonly names: readonly string[];
  readonly load: () => Promise<Declare>;
}[] = [
  { names: ["mcp"], load: () => import("./commands/mcp.ts").then((m) => m.mcpCommand) },
  { names: ["ui"], load: () => import("./commands/ui.ts").then((m) => m.uiCommand) },
  {
    names: ["init", "store"],
    load: () => import("./commands/store.ts").then((m) => m.storeCommands),
  },
  {
    names: ["add", "set", "unset", "get", "export", "rm", "mv"],
    load: () => import("./commands/nodes.ts").then((m) => m.nodeCommands),
  },
  {
    names: ["field", "tag", "ontology"],
    load: () => import("./commands/schema.ts").then((m) => m.schemaCommands),
  },
  {
    names: ["query", "run", "search", "backlinks", "children"],
    load: () => import("./commands/reads.ts").then((m) => m.readCommands),
  },
  {
    names: ["ext"],
    load: () => import("./commands/extensions.ts").then((m) => m.extensionCommands),
  },
  { names: ["trust"], load: () => import("./commands/trust.ts").then((m) => m.trustCommands) },
  {
    names: ["locations", "open"],
    load: () => import("./commands/locations.ts").then((m) => m.locationCommands),
  },
  {
    names: ["procedure"],
    load: () => import("./commands/procedures.ts").then((m) => m.procedureCommands),
  },
  {
    names: ["migrate"],
    load: () => import("./commands/procedures.ts").then((m) => m.migrateCommands),
  },
  {
    names: ["trace", "suggest", "relate"],
    load: () => import("./commands/relations.ts").then((m) => m.relationCommands),
  },
  {
    names: ["docs", "check"],
    load: () => import("./commands/gates.ts").then((m) => m.gateCommands),
  },
  {
    names: ["merge-jsonl"],
    load: () => import("./commands/merge-driver.ts").then((m) => m.mergeDriverCommand),
  },
  {
    names: ["action-invoke"],
    load: () => import("./commands/action-invoke.ts").then((m) => m.actionInvokeCommand),
  },
];

/** The program before any command: its name, version, global options and governance hook. */
function baseProgram(argv: readonly string[]): Command {
  const program = new Command();
  program
    .name("kb")
    .description("Repo-native outliner datastore")
    .version(argv.includes("--json") ? versionJson(WIRE_PROTOCOL) : KB_SDK_VERSION, VERSION_FLAGS)
    .option("--json", "machine-readable JSON output", false)
    .option("--root <path>", "repo root containing .kb/")
    .option(
      "--governance <mode>",
      "required: every call is put to the governance family's guards, and refused while they are not loaded; off: no governance policy; declared required approval always applies",
      toGovernance,
      "required",
    )
    .hook("preAction", () => {
      deployGovernance(program.opts<{ governance: GovernanceMode }>().governance);
    })
    .exitOverride()
    .showHelpAfterError(false);
  return program;
}

/**
 * The program `argv` runs: the base, with the commands of the row that
 * names its command, or of every row when it names none of them.
 */
export function programFor(argv: readonly string[]): Promise<Command> {
  return Promise.resolve()
    .then(() => {
      // Read the global options before selecting a module. Commander's
      // exit override can throw during this scan, so main handles it
      // through the same promise as the command's parse.
      const [name] = baseProgram(argv).parseOptions(argv.slice(2)).operands;
      const named = COMMANDS.filter(({ names }) => name !== undefined && names.includes(name));
      return Promise.all((named.length > 0 ? named : COMMANDS).map((row) => row.load()));
    })
    .then((declares) => {
      const program = baseProgram(argv);
      for (const declare of declares) declare(program);
      return program;
    });
}

/**
 * Process entry. Commander's parse is the promise; the only work after it is
 * turning a thrown parse/usage error into the same exit code every command
 * uses.
 */
export function main(argv: string[] = process.argv): Promise<number> {
  return programFor(argv)
    .then((program) => program.parseAsync(argv))
    .then(() => (typeof process.exitCode === "number" ? process.exitCode : EXIT_OK))
    .catch((err: unknown) => {
      const code = handleCliError(err, argv.includes("--json"));
      process.exitCode = code;
      return code;
    });
}
