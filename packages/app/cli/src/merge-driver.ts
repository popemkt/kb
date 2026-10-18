/**
 * `kb merge-jsonl %O %A %B [%P]`: the git merge driver for `.kb/nodes.jsonl`.
 *
 * A repository registers it per clone (AGENTS.md → merging `nodes.jsonl`);
 * this checkout registers `bin/merge-jsonl`, which runs this command from
 * source and falls back to git's text merge when it cannot run at all.
 * Git passes the three versions as files, expects the result written back
 * over `%A`, and reads the exit status: zero is resolved, anything else is a
 * conflict, whatever `%A` then holds.
 *
 * The merge itself is `mergeNodeSets` — this command is the git boundary and
 * nothing else: read three files, write one, choose an exit code. A conflict
 * must never leave `%A` as our side alone, or a `git add` drops theirs; so
 * when the id-based merge cannot run, this command runs git's text merge
 * itself. The codes:
 *
 * - 0: merged.
 * - 3: a conflict is written to `%A` — nodes that need a decision, or git's
 *   conflict markers when the id-based merge could not run.
 * - 2: nothing could be written; `%A` is untouched.
 *
 * Every other code is a process that did not run to completion (a crash
 * exits 1), which a wrapper answers with git's text merge.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJsonl, decodeStoredNode, mergeNodeSets, type KbNode } from "@kb/model";
import { writeErr } from "@kb/runtime";
import { cliAction } from "./command.ts";

const MERGED = 0;
const CONFLICT_WRITTEN = 3;
const NOTHING_WRITTEN = 2;

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

/** The id-based merge: written to `%A` either way, with the nodes that need a decision. */
function mergeById(base: string, ours: string, theirs: string, shown: string): number {
  const result = mergeNodeSets(
    readSide(base, "the merge base"),
    readSide(ours, "our side"),
    readSide(theirs, "their side"),
  );
  writeFileSync(ours, canonicalJsonl(result.nodes));
  if (result.conflicts.length === 0) return MERGED;
  const nodesToDecide = new Set(result.conflicts.map((c) => c.id)).size;
  writeErr(`merge-jsonl: ${shown}: ${String(nodesToDecide)} node(s) need a decision:`);
  for (const c of result.conflicts) writeErr(`  ${c.id}: ${c.reason}`);
  writeErr(
    "The file is valid JSONL with one side of each conflict kept. Fix those nodes with the kb CLI, then `git add` it.",
  );
  return CONFLICT_WRITTEN;
}

/** Git's own three-way text merge into `%A`; true when it wrote its result. */
function textMerge(base: string, ours: string, theirs: string): boolean {
  const run = spawnSync(
    "git",
    ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", ours, base, theirs],
    { stdio: "ignore" },
  );
  // merge-file exits with its conflict count (capped at 127), or above it on an error.
  return run.error === undefined && run.status !== null && run.status <= 127;
}

function mergeFiles(base: string, ours: string, theirs: string, shown: string): number {
  try {
    return mergeById(base, ours, theirs, shown);
  } catch (err) {
    writeErr(`merge-jsonl: ${shown}: ${describe(err)}`);
  }
  if (!textMerge(base, ours, theirs)) {
    writeErr(`merge-jsonl: ${shown}: git merge-file could not run either; ${shown} is untouched`);
    return NOTHING_WRITTEN;
  }
  writeErr(`merge-jsonl: ${shown}: fell back to a text merge, check it and git add`);
  return CONFLICT_WRITTEN;
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
