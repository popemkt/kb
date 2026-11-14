/**
 * A procedure (DESIGN.md → Action registry → Procedures): an ordered list of
 * steps, each an action, that a person or an agent walks through on any
 * surface (a wizard page, `kb procedure`, MCP). Each step's done-ness is
 * read, never recorded: a step names a read action that answers whether it
 * is done, so a procedure resumes wherever it was left, on whichever
 * surface, and there is no progress state to drift from the store.
 *
 * A procedure is data over actions, contributed to {@link ProcedurePoint};
 * the core actions `procedure.list`, `procedure.status` and `procedure.step`
 * read and walk it.
 */
import { z } from "zod";
import { Point } from "@kb/plugin";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";

/** An action call a procedure makes: an action id and its input. */
export const ProcedureCallSchema = z.object({
  action: z.string().min(1),
  input: z.unknown(),
});
export type ProcedureCall = z.infer<typeof ProcedureCallSchema>;

/**
 * What a step's check answers: a read action's output, done when it says
 * so. It may also say which of the step's actions it recommends (roll back,
 * when a migration's verify found problems) and give lines to show beside
 * the step (those problems).
 */
export const StepCheckSchema = z
  .object({
    done: z.boolean(),
    recommended: z.string().optional(),
    notes: z.array(z.string()).optional(),
  })
  .loose();

/** One action a step offers: its name in the step, and the call it makes. */
interface StepAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Presentation of an action whose effect is destructive. */
  readonly tone?: "destructive";
  readonly call: ProcedureCall;
}

export interface ProcedureStep {
  /** Its name within the procedure. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /**
   * What doing the step is. One action: the step runs it. Several: the step
   * is a **decision** (keep or roll back, say), the caller names the one it
   * means, and nothing takes it for a person — a run of every step in order
   * (`kb procedure --yes`) stops before it.
   */
  readonly actions: readonly [StepAction, ...StepAction[]];
  /**
   * A read action whose output's `done` says whether the step is done, read
   * from the store (or what the store's machine holds, a backup) each time.
   */
  readonly check: ProcedureCall;
}

/** Whether `step` is a decision: it offers more than one action. */
export function isDecision(step: Pick<ProcedureStep, "actions">): boolean {
  return step.actions.length > 1;
}

/** What a plugin contributes to {@link ProcedurePoint}; its id is the contribution's. */
export interface ProcedureContribution {
  readonly title: string;
  readonly description?: string;
  readonly steps: readonly ProcedureStep[];
}

/** Every procedure any loaded plugin offers, by id. */
export const ProcedurePoint = Point<ProcedureContribution>()(
  CORE_POINT_DEFINITIONS.procedure.name,
  CORE_POINT_DEFINITIONS.procedure.spec,
);

/** One step as a procedure's status reads it. */
export const StepStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  actions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      tone: z.literal("destructive").optional(),
      description: z.string().optional(),
      call: ProcedureCallSchema,
    }),
  ),
  /** More than one action: the caller decides which, and nothing decides for a person. */
  decision: z.boolean(),
  /** The action its check recommends, one of `actions`. */
  recommended: z.string().optional(),
  /** What its check gives to show beside it. */
  notes: z.array(z.string()),
  /** What its check answered: done, not done, or why it could not say. */
  check: z.discriminatedUnion("status", [
    z.object({ status: z.literal("done") }),
    z.object({ status: z.literal("not-done") }),
    z.object({ status: z.literal("failed"), code: z.string(), message: z.string() }),
  ]),
  /**
   * Whether the step is behind the procedure: its own check says done, or a
   * later step's does — steps are walked in order, so a later step done
   * means this one was passed, whatever its check reads now.
   */
  done: z.boolean(),
});
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const ProcedureStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  steps: z.array(StepStatusSchema),
  /** The step to run next: the first not done. Null when every step is. */
  current: z.string().nullable(),
});
export type ProcedureStatus = z.infer<typeof ProcedureStatusSchema>;

/**
 * Each step done when its own check is or a later step's is; the current
 * step is the first that is not. The one reading of order a procedure has.
 */
export function walkedSteps(checks: readonly boolean[]): {
  readonly done: readonly boolean[];
  readonly current: number | null;
} {
  const lastDone = checks.lastIndexOf(true);
  const done = checks.map((_, at) => at <= lastDone);
  const current = done.indexOf(false);
  return { done, current: current === -1 ? null : current };
}

/** The result of one step: its nested action receipt and freshly read progress. */
export const ProcedureStepOutputSchema = z.object({
  receipt: z.unknown(),
  status: ProcedureStatusSchema,
});
