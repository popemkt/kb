/** `kb query`, `run`, `search`, `backlinks` and `children`: reading the graph. */
import type { Command } from "commander";
import { kbAction, runPlanEffect } from "../command.ts";
import { mapBacklinks, mapChildren, mapQuery, mapRun, mapSearch } from "../map.ts";

export function readCommands(program: Command): void {
  program
    .command("query")
    .description("Run a raw EDN datalog query")
    .argument("<edn>", "EDN query string")
    .action(
      kbAction((ctx, globals, [edn]: [string]) =>
        runPlanEffect(ctx, mapQuery({ query: edn }), globals),
      ),
    );

  program
    .command("run")
    .description("Execute a saved query from .kb/queries/<name>.edn")
    .argument("<name>", "saved query name (without .edn)")
    .action(
      kbAction((ctx, globals, [name]: [string]) => runPlanEffect(ctx, mapRun(name), globals)),
    );

  program
    .command("search")
    .description("Search node text and titles (case-insensitive substring)")
    .argument("<text>", "search text")
    .action(
      kbAction((ctx, globals, [text]: [string]) =>
        runPlanEffect(ctx, mapSearch(text), globals, { command: "search" }),
      ),
    );

  program
    .command("backlinks")
    .description("Nodes that mention <id>")
    .argument("<id>", "node id")
    .action(
      kbAction((ctx, globals, [id]: [string]) => runPlanEffect(ctx, mapBacklinks(id), globals)),
    );

  program
    .command("children")
    .description("Direct children of a node")
    .argument("<id>", "node id")
    .action(
      kbAction((ctx, globals, [id]: [string]) =>
        runPlanEffect(ctx, mapChildren(id), globals, { command: "children" }),
      ),
    );
}
