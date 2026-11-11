/**
 * `kb procedure`: the procedures this kb offers, one's status, and walking
 * it (DESIGN.md → Action registry → Procedures). Every step runs through
 * `procedure.step`, so the terminal decides a step's approval as it decides
 * any call's; `--yes` only spares the "run it?" question, and stops at a
 * decision, which is never taken for a person.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { onWire, type KbContext, type ProcedureStatus, type StepStatus } from "@kb/contracts";
import { procedureListDef, procedureStatusDef, procedureStepDef } from "@kb/operations";
import { writeErr, writeOut } from "@kb/runtime";
import {
  ACTION_INVOKE_WIRE,
  EXIT_FAILED,
  EXIT_OK,
  askTerminal,
  invokeCliEffect,
  kbAction,
  outputLines,
  report,
  type GlobalOpts,
} from "./command.ts";
import { formatReceipt } from "./format.ts";

interface ProcedureOpts {
  readonly run?: boolean;
  readonly yes?: boolean;
  readonly action?: string;
}

interface WalkOpts {
  /** Do not ask before a step. */
  readonly yes: boolean;
  /** The action to take at the decision the walk meets. */
  readonly action: string | undefined;
  /** Run the next step only. */
  readonly once: boolean;
}

/** A step as lines: behind (✓), next (→) or ahead, a decision's actions (the recommended one marked), and its notes. */
function stepLines(step: StepStatus, current: string | null): string[] {
  const mark = step.done ? "✓" : step.id === current ? "→" : " ";
  const named = (a: StepStatus["actions"][number]) =>
    `${a.id} (${a.title}${a.id === step.recommended ? ", recommended" : ""})`;
  const offers = step.decision ? `  — decide: ${step.actions.map(named).join(" | ")}` : "";
  const failed = step.check.status === "failed" ? `  [check failed: ${step.check.message}]` : "";
  return [
    `${mark} ${step.id}  ${step.title}${offers}${failed}`,
    ...step.notes.map((note) => `    ${note}`),
  ];
}

function statusLines(status: ProcedureStatus): string[] {
  const next = status.steps.find((step) => step.id === status.current);
  return [
    `${status.title} (${status.id})`,
    ...status.steps.flatMap((step) => stepLines(step, status.current)),
    next === undefined
      ? "every step is done"
      : next.decision
        ? `awaiting a decision: kb procedure ${status.id} --action <${next.actions.map((a) => a.id).join("|")}>`
        : `next: kb procedure ${status.id} --run`,
  ];
}

const statusOf = (ctx: KbContext, procedure: string) =>
  invokeCliEffect(
    ctx,
    onWire(ACTION_INVOKE_WIRE, { id: procedureStatusDef.id, input: { procedure } }),
  ).pipe(
    Effect.map((receipt) => {
      if (receipt.status === "failed") return { read: false, receipt } as const;
      const parsed = procedureStatusDef.outputSchema.safeParse(receipt.output);
      return parsed.success
        ? ({ read: true, status: parsed.data } as const)
        : ({ read: false, receipt } as const);
    }),
  );

/**
 * Walk `procedure` from its next step (or run that step alone, `once`):
 * each one asked about first unless `yes`, a decision taken only when
 * `action` names one of its actions, and a step that fails or is declined
 * stopping the walk where it is.
 */
const walk = Effect.fn("kb.procedure.walk")(function* (
  ctx: KbContext,
  globals: GlobalOpts,
  procedure: string,
  opts: WalkOpts,
) {
  let decided = false;
  for (let ran = 0; !opts.once || ran === 0; ran++) {
    const read = yield* statusOf(ctx, procedure);
    if (!read.read) {
      writeOut(formatReceipt(read.receipt, { json: globals.json === true }));
      return EXIT_FAILED;
    }
    const { status } = read;
    const step = status.steps.find((s) => s.id === status.current);
    if (step === undefined) {
      for (const line of statusLines(status)) writeOut(line);
      return EXIT_OK;
    }
    // A decision is the person's: taken once, and only as named.
    if (step.decision && (opts.action === undefined || decided)) {
      for (const line of statusLines(status)) writeOut(line);
      return EXIT_OK;
    }
    const action = step.decision ? opts.action : undefined;
    if (!opts.yes) {
      const go = yield* askTerminal(
        Effect.succeed(`${statusLines(status).join("\n")}\n`),
        `Run ${step.id}${action === undefined ? "" : ` (${action})`}?`,
      );
      if (!go) {
        writeErr(`stopped before ${step.id}`);
        return EXIT_OK;
      }
    }
    const receipt = yield* invokeCliEffect(
      ctx,
      onWire(ACTION_INVOKE_WIRE, {
        id: procedureStepDef.id,
        input: { procedure, step: step.id, ...(action === undefined ? {} : { action }) },
      }),
    );
    if (receipt.status === "failed") {
      writeOut(formatReceipt(receipt, { json: globals.json === true }));
      return EXIT_FAILED;
    }
    writeErr(`ran ${step.id}`);
    decided = decided || step.decision;
  }
  const after = yield* statusOf(ctx, procedure);
  if (after.read) for (const line of statusLines(after.status)) writeOut(line);
  return EXIT_OK;
});

/** `kb procedure [id] [--run] [--yes] [--action <id>]`. */
export function procedureCommands(program: Command): void {
  program
    .command("procedure")
    .description(
      "The procedures this kb offers; with an id, its steps and the next one; --run walks it from there",
    )
    .argument("[id]", "the procedure, as `kb procedure` lists it")
    .option("--run", "run its steps in order from the next one, asking before each", false)
    .option(
      "--yes",
      "with --run: do not ask before each step (approvals still ask; stops at a decision)",
      false,
    )
    .option(
      "--action <id>",
      "the action to take at a decision step (with --run, or alone for that step)",
    )
    .action(
      kbAction((ctx, globals, [id, opts]: [string | undefined, ProcedureOpts]) => {
        if (id === undefined)
          return invokeCliEffect(
            ctx,
            onWire(ACTION_INVOKE_WIRE, { id: procedureListDef.id, input: {} }),
          ).pipe(
            Effect.map((receipt) =>
              report(
                receipt,
                globals,
                outputLines(procedureListDef, (out) =>
                  out.procedures.length === 0
                    ? ["no procedures"]
                    : out.procedures.map(
                        (p) =>
                          `${p.id}  ${p.title}  ${p.current === null ? "done" : `next: ${p.current}`}`,
                      ),
                ),
              ),
            ),
          );
        if (opts.run === true)
          return walk(ctx, globals, id, {
            yes: opts.yes === true,
            action: opts.action,
            once: false,
          });
        // `--action` alone is the person's decision at the next step, and only that.
        if (opts.action !== undefined)
          return walk(ctx, globals, id, { yes: true, action: opts.action, once: true });
        return invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, { id: procedureStatusDef.id, input: { procedure: id } }),
        ).pipe(
          Effect.map((receipt) =>
            report(receipt, globals, outputLines(procedureStatusDef, statusLines)),
          ),
        );
      }),
    );
}
