/**
 * The procedure actions (DESIGN.md → Action registry → Procedures): read a
 * procedure's status and walk its next step. A procedure is what plugins
 * contributed to `ProcedurePoint` in any kernel this host holds; its steps'
 * checks and runs are ordinary calls through the invoke core (`CoreInvoke`),
 * made as this call's caller, so a step's action is decided exactly as it
 * would be invoked on its own — its approval included.
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  CoreInvoke,
  FamilyKernels,
  ProcedurePoint,
  ProcedureStatusSchema,
  ProcedureStepOutputSchema,
  StepCheckSchema,
  isDecision,
  walkedSteps,
  type ActionDefinition,
  type ActionReceipt,
  type CoreInvoker,
  type ProcedureCall,
  type ProcedureContribution,
  type ProcedureStatus,
  type StepStatus,
} from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";

/** The invoke core under this call, or why there is none to walk a procedure with. */
const invoker = Effect.fn("procedure.invoker")(function* (): Effect.fn.Return<
  CoreInvoker,
  DomainError
> {
  const invoke = yield* CoreInvoke;
  return invoke ?? (yield* domainError("internal", "this host has no invoke core to run steps"));
});

/** Every procedure this host's kernels hold, by id, the first kernel's winning. */
const procedures = Effect.fn("procedure.all")(function* (): Effect.fn.Return<
  ReadonlyMap<string, ProcedureContribution>,
  never,
  FamilyKernels
> {
  const found = new Map<string, ProcedureContribution>();
  for (const { kernel } of yield* FamilyKernels)
    for (const { id, value } of kernel.contributions(ProcedurePoint))
      if (!found.has(id)) found.set(id, value);
  return found;
});

const procedureOf = Effect.fn("procedure.of")(function* (
  id: string,
): Effect.fn.Return<ProcedureContribution, DomainError, FamilyKernels> {
  const found = (yield* procedures()).get(id);
  return found ?? (yield* domainError("not_found", `no procedure ${id}`, { procedure: id }));
});

const requestOf = (call: ProcedureCall) => ({ id: call.action, input: call.input });

/** What a step's check answered, read through the invoke core as a read, and what it adds. */
function checkOf(receipt: ActionReceipt): {
  readonly check: StepStatus["check"];
  readonly recommended?: string;
  readonly notes: readonly string[];
} {
  if (receipt.status === "failed")
    return { check: { status: "failed", code: receipt.code, message: receipt.message }, notes: [] };
  const parsed = StepCheckSchema.safeParse(receipt.output);
  if (!parsed.success)
    return {
      check: {
        status: "failed",
        code: "internal",
        message: `${receipt.id} answered no \`done\`: ${parsed.error.message}`,
      },
      notes: [],
    };
  const { done, recommended, notes = [] } = parsed.data;
  return {
    check: { status: done ? "done" : "not-done" },
    ...(recommended === undefined ? {} : { recommended }),
    notes,
  };
}

/** A check's recommendation, kept only when it names one of the step's actions. */
function recommendedOf(
  step: ProcedureContribution["steps"][number],
  recommended: string | undefined,
): { recommended?: string } {
  return recommended !== undefined && step.actions.some((action) => action.id === recommended)
    ? { recommended }
    : {};
}

/** `id`'s status: every step's check read now, and the step to run next. */
const statusOf = Effect.fn("procedure.statusOf")(function* (
  id: string,
): Effect.fn.Return<ProcedureStatus, DomainError, FamilyKernels> {
  const procedure = yield* procedureOf(id);
  const invoke = yield* invoker();
  const checks = yield* Effect.forEach(procedure.steps, (step) =>
    invoke(requestOf(step.check), "read").pipe(Effect.map(checkOf)),
  );
  const walked = walkedSteps(checks.map(({ check }) => check.status === "done"));
  return {
    id,
    title: procedure.title,
    ...(procedure.description === undefined ? {} : { description: procedure.description }),
    steps: procedure.steps.map((step, at) => ({
      id: step.id,
      title: step.title,
      ...(step.description === undefined ? {} : { description: step.description }),
      actions: step.actions.map((action) => ({ ...action })),
      decision: isDecision(step),
      ...recommendedOf(step, checks[at]?.recommended),
      notes: [...(checks[at]?.notes ?? [])],
      check: checks[at]?.check ?? { status: "not-done" },
      done: walked.done[at] ?? false,
    })),
    current: walked.current === null ? null : (procedure.steps[walked.current]?.id ?? null),
  };
});

export const procedureListDef = {
  id: "procedure.list",
  title: "List procedures",
  description:
    "The procedures this kb offers — ordered steps, each an action, each step's done-ness read — with each one's next step",
  mode: { kind: "read" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    procedures: z.array(
      z.object({ id: z.string(), title: z.string(), current: z.string().nullable() }),
    ),
  }),
} satisfies ActionDefinition;

export const procedureListEffect = Effect.fn("procedure.list")(function* (): Effect.fn.Return<
  z.infer<typeof procedureListDef.outputSchema>,
  DomainError,
  FamilyKernels
> {
  const ids = [...(yield* procedures()).keys()].toSorted();
  const statuses = yield* Effect.forEach(ids, statusOf);
  return {
    procedures: statuses.map(({ id, title, current }) => ({ id, title, current })),
  };
});

export const procedureStatusDef = {
  id: "procedure.status",
  title: "Procedure status",
  description:
    "A procedure's steps, each with what its check reads now, and the step to run next (null when every step is done)",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ procedure: z.string().min(1) }),
  outputSchema: ProcedureStatusSchema,
} satisfies ActionDefinition;

export const procedureStatusEffect = Effect.fn("procedure.status")(function* (input: {
  readonly procedure: string;
}): Effect.fn.Return<ProcedureStatus, DomainError, FamilyKernels> {
  return yield* statusOf(input.procedure);
});

export const procedureStepDef = {
  id: "procedure.step",
  title: "Run a procedure's next step",
  description:
    "Run the step of a procedure that is next, and only that one: its action (for a decision, the one `action` names) is invoked as this call's caller and decided as it would be on its own (a step whose action needs approval needs it here). Answers the step's receipt and the procedure's status after it",
  mode: { kind: "write" } as const,
  inputSchema: z.object({
    procedure: z.string().min(1),
    /** The step the caller means to run, which must be the next one. */
    step: z.string().min(1),
    /** Which of the step's actions: needed when the step is a decision, else its one. */
    action: z.string().min(1).optional(),
  }),
  outputSchema: ProcedureStepOutputSchema,
} satisfies ActionDefinition;

export const procedureStepEffect = Effect.fn("procedure.step")(function* (input: {
  readonly procedure: string;
  readonly step: string;
  readonly action?: string | undefined;
}): Effect.fn.Return<z.infer<typeof procedureStepDef.outputSchema>, DomainError, FamilyKernels> {
  const before = yield* statusOf(input.procedure);
  if (before.current !== input.step) {
    const reason =
      before.current === null ? "every step is done" : `the next step is ${before.current}`;
    return yield* domainError(
      "conflict",
      `${input.step} is not the next step of ${input.procedure}: ${reason}`,
      { procedure: input.procedure, step: input.step, current: before.current },
    );
  }
  const step = (yield* procedureOf(input.procedure)).steps.find((s) => s.id === input.step);
  if (step === undefined)
    return yield* domainError("not_found", `${input.procedure} has no step ${input.step}`);
  const offered = step.actions.map((action) => action.id).join(", ");
  const chosen =
    input.action === undefined
      ? isDecision(step)
        ? undefined
        : step.actions[0]
      : step.actions.find((action) => action.id === input.action);
  if (chosen === undefined)
    return yield* domainError(
      "invalid_input",
      input.action === undefined
        ? `${input.step} is a decision: name one of ${offered}`
        : `${input.step} offers no ${input.action}: it offers ${offered}`,
      { procedure: input.procedure, step: input.step, offered: step.actions.map((a) => a.id) },
    );
  const receipt = yield* (yield* invoker())(requestOf(chosen.call), "write");
  // A step's action that needs approval is refused for want of it: the
  // call that walks it needs it, so that refusal is this call's.
  if (receipt.status === "failed" && receipt.code === "approval_required")
    return yield* domainError("approval_required", receipt.message, {
      procedure: input.procedure,
      step: input.step,
      action: chosen.call.action,
    });
  return { receipt, status: yield* statusOf(input.procedure) };
});
