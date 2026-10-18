/**
 * `kb merge-jsonl %O %A %B [%P]`: the git merge driver for `.kb/nodes.jsonl`.
 *
 * A repository registers it per clone (AGENTS.md → merging `nodes.jsonl`);
 * this checkout registers `bin/merge-jsonl`, which runs this command from
 * source and falls back to git's text merge when it cannot run at all.
 * Git passes the three versions as files, expects the result written back
 * over `%A`, and reads the exit status.
 *
 * The merge itself is `mergeNodeSets` — this command is the git boundary and
 * nothing else: read three files, write one, choose an exit code. The codes
 * are 0 merged, 1 merged with nodes that need a decision, 2 could not merge
 * (`%A` untouched).
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJsonl, decodeStoredNode, mergeNodeSets, type KbNode } from "@kb/model";
import { writeErr } from "@kb/runtime";
import { cliAction } from "./command.ts";

const MERGED = 0;
const NEEDS_DECISION = 1;
const COULD_NOT_MERGE = 2;

/** An error and what caused it, on one line — git shows the driver's stderr. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause === undefined ? err.message : `${err.message}: ${describe(err.cause)}`;
}

/** Parse one side. A side git never wrote (a fresh add) is an empty store. */
function readSide(path: string, label: string): KbNode[] {
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${label} (${path})`, { cause: err });
  }
  const nodes: KbNode[] = [];
  const lines = body.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    try {
      nodes.push(decodeStoredNode(JSON.parse(line)));
    } catch (err) {
      throw new Error(`${label} is not a valid node store at line ${String(i + 1)}`, {
        cause: err,
      });
    }
  }
  return nodes;
}

function mergeFiles(base: string, ours: string, theirs: string, shown: string): number {
  let body: string;
  let conflicts: readonly { id: string; reason: string }[];
  try {
    const result = mergeNodeSets(
      readSide(base, "the merge base"),
      readSide(ours, "our side"),
      readSide(theirs, "their side"),
    );
    body = canonicalJsonl(result.nodes);
    conflicts = result.conflicts;
  } catch (err) {
    // Leave %A untouched; the caller falls back to git's text merge.
    writeErr(`merge-jsonl: ${shown}: ${describe(err)}`);
    return COULD_NOT_MERGE;
  }

  writeFileSync(ours, body);

  if (conflicts.length === 0) return MERGED;
  const nodesToDecide = new Set(conflicts.map((c) => c.id)).size;
  writeErr(`merge-jsonl: ${shown}: ${String(nodesToDecide)} node(s) need a decision:`);
  for (const c of conflicts) writeErr(`  ${c.id}: ${c.reason}`);
  writeErr(
    "The file is valid JSONL with one side of each conflict kept. Fix those nodes with the kb CLI, then `git add` it.",
  );
  return NEEDS_DECISION;
}

export function mergeDriverCommand(program: Command): void {
  program
    .command("merge-jsonl")
    .description("Git merge driver for .kb/nodes.jsonl: three-way by node id")
    .argument("<base>", "%O: the merge base")
    .argument("<ours>", "%A: our side, overwritten with the result")
    .argument("<theirs>", "%B: their side")
    .argument("[path]", "%P: the path git shows")
    .action(
      cliAction((_globals, [base, ours, theirs, path]: [string, string, string, string?]) =>
        Effect.sync(() => mergeFiles(base, ours, theirs, path ?? ours)),
      ),
    );
}
