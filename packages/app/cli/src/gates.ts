/**
 * `kb docs check`, `kb docs materialize`, `kb check audit` and `kb check
 * gaps`: the commands a repository's gates run, as sugar over the actions
 * every surface calls (`docs.check`, `docs.materialize`, `ext.check.audit`,
 * `ext.check.gaps`), as `kb trace` is over `graph.trace`. The CLI imports nothing of either family; it prints what the
 * actions answer, read off the receipt.
 *
 * A check is a question with a yes or no, so a succeeded receipt that says
 * "not clean" still exits {@link EXIT_FAILED}: a hook or CI step reads the
 * exit code, not the text.
 */
import type { Command } from "commander";
import { Effect, Predicate } from "effect";
import { onWire, type ActionReceipt, type KbContext } from "@kb/contracts";
import { invokeReceiptEffect, writeErr } from "@kb/runtime";
import { ACTION_INVOKE_WIRE, EXIT_FAILED, kbAction, report, type GlobalOpts } from "./command.ts";
import { readTextArgEffect } from "./input.ts";

const call = (ctx: KbContext, id: string, input: unknown) =>
  invokeReceiptEffect(ctx, onWire(ACTION_INVOKE_WIRE, { id, input }));

function listOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(Predicate.isObject) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A report's own `clean` flag; anything else is not clean. */
function isClean(receipt: ActionReceipt): boolean {
  return (
    receipt.status === "succeeded" &&
    Predicate.isObject(receipt.output) &&
    receipt.output.clean === true
  );
}

/** What a docs action could not read goes to stderr, as `kb trace`'s warnings do. */
function warnDocs(receipt: ActionReceipt, globals: GlobalOpts): void {
  if (globals.json === true || receipt.status !== "succeeded") return;
  if (!Predicate.isObject(receipt.output)) return;
  for (const warning of strings(receipt.output.warnings)) writeErr(`kb docs: warning — ${warning}`);
}

function materializeLines(output: unknown): string[] {
  const written = Predicate.isObject(output) ? listOf(output.written) : [];
  if (written.length === 0) return ["kb docs: no docs views (docs.markdown view nodes) found"];
  return written.map((w) => `kb docs: wrote ${String(w.output)} (view: ${String(w.view)})`);
}

function docsCheckLines(output: unknown): string[] {
  const views = Predicate.isObject(output) ? listOf(output.views) : [];
  if (Predicate.isObject(output) && output.clean === true) {
    return [`kb docs: clean (${views.length} view${views.length === 1 ? "" : "s"})`];
  }
  return [
    ...views
      .filter((v) => v.status !== "clean")
      .map((v) => `kb docs: ${String(v.status)} — ${String(v.output)} (view: ${String(v.view)})`),
    "kb docs out of date — run: kb docs materialize, then stage the results",
  ];
}

function auditLines(output: unknown): string[] {
  if (Predicate.isObject(output) && output.clean === true) return ["kb checks: clean"];
  const findings = Predicate.isObject(output) ? listOf(output.findings) : [];
  return findings.map((finding) => {
    const subject =
      typeof finding.rule === "string" ? `rule ${finding.rule}` : `check ${String(finding.check)}`;
    return `${String(finding.kind)} — ${String(finding.message)} (${subject})`;
  });
}

function gapsLines(output: unknown): string[] {
  if (!Predicate.isObject(output)) return [];
  const counts = `${String(output.markers)} marker(s) in ${String(output.scanned)} file(s)`;
  if (output.clean === true) return [`kb gaps: clean (${counts})`];
  return [
    ...listOf(output.findings).map((f) => `${String(f.kind)} — ${String(f.message)}`),
    counts,
  ];
}

/** `--files-from` holds NUL-separated paths, as `git ls-files -z` writes them. */
function fileList(text: string): string[] {
  return text.split("\0").filter((path) => path !== "");
}

/** Print a check's report, and exit by its answer rather than by the receipt alone. */
const runCheck = (
  ctx: KbContext,
  globals: GlobalOpts,
  id: string,
  lines: (output: unknown) => readonly string[],
  opts: { warn?: (receipt: ActionReceipt, globals: GlobalOpts) => void; input?: unknown } = {},
) =>
  Effect.map(call(ctx, id, opts.input ?? {}), (receipt) => {
    opts.warn?.(receipt, globals);
    const code = report(receipt, globals, lines);
    return code === 0 && !isClean(receipt) ? EXIT_FAILED : code;
  });

export function gateCommands(program: Command): void {
  const docs = program.command("docs").description("Generated docs (docs.markdown views)");
  docs
    .command("check")
    .description("Exit 0 when every generated doc matches .kb data, 1 when one is stale")
    .action(
      kbAction((ctx, globals) =>
        runCheck(ctx, globals, "docs.check", docsCheckLines, { warn: warnDocs }),
      ),
    );
  docs
    .command("materialize")
    .description("Regenerate every generated doc, or one view's")
    .argument("[view]", "docs view name")
    .action(
      kbAction((ctx, globals, [view]: [string | undefined]) =>
        Effect.map(call(ctx, "docs.materialize", view === undefined ? {} : { view }), (receipt) => {
          warnDocs(receipt, globals);
          return report(receipt, globals, materializeLines);
        }),
      ),
    );

  const check = program.command("check").description("Rules and their checks (#rule, #check)");
  check
    .command("audit")
    .description(
      "Exit 0 when every rule's home resolves and every check is wired and honest, 1 otherwise",
    )
    .action(kbAction((ctx, globals) => runCheck(ctx, globals, "ext.check.audit", auditLines)));
  check
    .command("gaps")
    .description("Exit 0 when every gap marker in the listed files names an open #gap, 1 otherwise")
    .argument("[files...]", "root-relative files to scan")
    .option("--files-from <file>", 'NUL-separated file list, or "-" for stdin')
    .action(
      kbAction((ctx, globals, [files, opts]: [string[], { filesFrom?: string }]) =>
        Effect.gen(function* () {
          const listed =
            opts.filesFrom === undefined
              ? []
              : fileList(yield* readTextArgEffect("--files-from", opts.filesFrom));
          // An empty list is the action's to refuse: a scan of nothing is no pass.
          return yield* runCheck(ctx, globals, "ext.check.gaps", gapsLines, {
            input: { files: [...files, ...listed] },
          });
        }),
      ),
    );
}
