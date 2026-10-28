/**
 * `ext.canvas.run` (DESIGN.md → Canvas documents → Run): a canvas run as a
 * computer, tldraw computer's model built from kb's parts. The engine is
 * `@kb/canvas`'s `flowPlan` and `runFlow`; this verb is its performer, and
 * each performer is the family that already owns the work, reached through
 * the invoke core:
 *
 * - a component whose node names scripts runs them (`ext.code.script.run`,
 *   its node the subject), its inputs written to its `input` first, and
 *   its output is what they left in its `output`;
 * - a component with no inputs is a constant: its output is its words;
 * - any other is an instruction, its node's text, performed by the agent
 *   family's model (`ext.agent.complete`) on its inputs: the instruction
 *   is the system prompt, the inputs the message. A run is a person's or
 *   the agent's, never code's (the verb takes no targets), and a script a
 *   run performs cannot ask the model either: the completion takes no
 *   targets, so the grant refuses it to code.
 *
 * Each output is written to its node's `output` field as the step ends, one
 * write each, so every step shows, reads and undoes like any edit.
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  CoreInvoke,
  KbCtx,
  type ActionReceipt,
  type ExtensionAction,
  type KbContext,
} from "@kb/contracts";
import { IndexedNodes, ResolveError, resolveFieldIn, type NodeId } from "@kb/model";
import { MAX_FLOW_ROUNDS, flowPlan, runFlow, type FlowResult, type FlowStep } from "@kb/canvas";
import type { NodeIndex } from "@kb/query";
import { CanvasIdSchema } from "./schemas.ts";
import { CanvasTxError, canvasStep, readCanvasEffect, type CanvasFail } from "./write.ts";

/** The field a component's output is kept in, made at the first run that needs it. */
const OUTPUT_FIELD = "output";
/** The field a script component reads its inputs from, written by the run before its scripts run. */
const INPUT_FIELD = "input";
/** The model performer: one tool-less turn of the agent family's selected provider. */
const MODEL_ACTION = "ext.agent.complete";
/** What the model is told it is, before the instruction it performs. */
const CANVAS_PERFORMER =
  "You are one component of a canvas that runs as a computer. Perform the instruction below " +
  "on the inputs in the message, which are the outputs of the components wired into this one, " +
  "in order, separated by a line of three dashes. Reply with the result alone, no preamble: " +
  "it becomes this component's output.";
/** How one input is set apart from the next in the message. */
const INPUT_SEPARATOR = "\n\n---\n\n";
/** An instruction's completion: the instruction in the system prompt, its inputs as the message. */
const instructionTurn = (instruction: string, inputs: readonly string[]) => ({
  system: `${CANVAS_PERFORMER}\n\nInstruction: ${instruction}`,
  message: inputs.join(INPUT_SEPARATOR) || "(the inputs are empty)",
});
const SCRIPT_LIST = "ext.code.script.list";
const SCRIPT_RUN = "ext.code.script.run";

const runInput = z.object({
  canvasId: CanvasIdSchema,
  from: z
    .string()
    .min(1)
    .optional()
    .describe("run only this component and what its outputs reach; every component when absent"),
  rounds: z
    .number()
    .int()
    .min(1)
    .max(MAX_FLOW_ROUNDS)
    .optional()
    .describe(
      "how many rounds a flow whose outputs loop back runs (default 1); an acyclic flow runs once",
    ),
});

const runOutput = z.object({
  canvasId: z.string(),
  order: z
    .array(z.string())
    .describe("the components (item ids) in the order each round performs them"),
  rounds: z.number(),
  steps: z.number().describe("how many times a component was performed"),
  outputField: z.string().describe("the field each component's output is written to"),
  outcomes: z.array(
    z.object({
      item: z.string(),
      nodeId: z.string(),
      status: z.enum(["done", "failed", "skipped"]),
      by: z.string().optional().describe("constant, model or script"),
      output: z.string().optional(),
      message: z.string().optional(),
      after: z.array(z.string()).optional().describe("the inputs that failed or were skipped"),
    }),
  ),
});

const scriptsSchema = z.object({ scripts: z.array(z.object({ id: z.string() })) });
const completedSchema = z.object({ text: z.string() });

/** A receipt's failure in words, or null for one that succeeded. */
const failureOf = (receipt: ActionReceipt) =>
  receipt.status === "failed" ? receipt.message : null;

/** The id of the field named `name`: the field of that name, made when kb has none. */
const fieldEffect = Effect.fn("ext.canvas.run.field")(function* (name: string) {
  const ctx = yield* KbCtx;
  const found = yield* canvasStep(() => {
    try {
      return resolveFieldIn(IndexedNodes.of(ctx.nodes), name);
    } catch (err) {
      if (err instanceof ResolveError && err.code === "not_found") return null;
      throw err;
    }
  });
  if (found !== null) return found;
  const invoke = yield* CoreInvoke;
  if (invoke === null)
    return yield* Effect.fail(new CanvasTxError("this host runs no invoke core"));
  const made = yield* invoke({ id: "field.define", input: { name } }, "write");
  if (made.status === "failed") return yield* Effect.fail(new CanvasTxError(made.message));
  return z.object({ id: z.string() }).parse(made.output).id;
});

/** Write `values` as `field` of `nodeId`, in place of what it held; the failure in words, or null. */
const writeField = Effect.fn("ext.canvas.run.write")(function* (
  nodeId: NodeId,
  field: string,
  values: readonly string[],
) {
  const invoke = yield* CoreInvoke;
  if (invoke === null) return "this host runs no invoke core";
  const written = yield* invoke(
    {
      id: "node.update",
      input: {
        id: nodeId,
        unsetProps: [{ field }],
        setProps: values.map((v) => ({ field, value: { t: "str", v } })),
      },
    },
    "write",
  );
  return failureOf(written);
});

/** A node's output as it is stored, if it holds one. */
function storedOutput(
  ctx: KbContext<NodeIndex>,
  nodeId: NodeId,
  field: string,
): string | undefined {
  const value = ctx.index.getNode(nodeId)?.props[field]?.[0];
  return value?.t === "str" ? value.v : undefined;
}

/** A step that could not be performed, and why. */
const fail = (message: string): FlowResult => ({ ok: false, message });

/** The performer: a step's node says how it performs; its output is written to `field`. */
function performer(field: string) {
  return Effect.fn("ext.canvas.run.perform")(function* (step: FlowStep) {
    const ctx = yield* KbCtx;
    const invoke = yield* CoreInvoke;
    if (invoke === null) return fail("this host runs no invoke core");
    const { nodeId } = step.component;
    const node = ctx.index.getNode(nodeId);
    if (node === undefined) return fail(`no node ${nodeId}`);
    const listed = yield* invoke({ id: SCRIPT_LIST, input: { subjects: [nodeId] } }, "read");
    const scripts =
      listed.status === "succeeded"
        ? (scriptsSchema.safeParse(listed.output).data?.scripts ?? [])
        : [];
    let made: FlowResult;
    if (scripts.length > 0) {
      const inputField = yield* fieldEffect(INPUT_FIELD).pipe(
        Effect.catch((err) => Effect.succeed(err)),
      );
      if (typeof inputField !== "string") return fail(inputField.message);
      const unwritten = yield* writeField(
        nodeId,
        inputField,
        step.inputs.map((i) => i.text),
      );
      if (unwritten !== null) return fail(`its inputs were not written: ${unwritten}`);
      for (const script of scripts) {
        const ran = yield* invoke(
          { id: SCRIPT_RUN, input: { script: script.id, subject: nodeId } },
          "write",
        );
        const failure = failureOf(ran);
        if (failure !== null) return fail(`script ${script.id}: ${failure}`);
      }
      const output = storedOutput(ctx, nodeId, field);
      return output === undefined
        ? fail(`its scripts ran and left no ${OUTPUT_FIELD}`)
        : { ok: true as const, output, by: "script" };
    } else if (step.component.inputs.length === 0) {
      made = { ok: true, output: node.text, by: "constant" };
    } else {
      const asked = yield* invoke(
        {
          id: MODEL_ACTION,
          input: instructionTurn(
            node.text,
            step.inputs.map((i) => i.text),
          ),
        },
        "write",
      );
      const failure = failureOf(asked);
      const answer = completedSchema.safeParse(asked.status === "succeeded" ? asked.output : null);
      made =
        failure !== null
          ? fail(`no model performed it: ${failure}`)
          : answer.success
            ? { ok: true, output: answer.data.text, by: "model" }
            : fail(`${MODEL_ACTION} answered no text`);
    }
    if (!made.ok) return made;
    const unwritten = yield* writeField(nodeId, field, [made.output]);
    return unwritten === null ? made : fail(`its output was not written: ${unwritten}`);
  });
}

const canvasRunEffect = Effect.fn("ext.canvas.run")(function* (
  input: z.infer<typeof runInput>,
): Effect.fn.Return<z.infer<typeof runOutput>, CanvasFail, KbCtx> {
  const ctx = yield* KbCtx;
  const doc = yield* readCanvasEffect(input.canvasId);
  const plan = yield* canvasStep(() => flowPlan(doc, input.from));
  if (plan.components.length === 0) {
    return yield* Effect.fail(
      new CanvasTxError(
        `${input.canvasId} has no flow: connect items that stand for nodes, and run again`,
      ),
    );
  }
  const field = yield* fieldEffect(OUTPUT_FIELD);
  const nodeOf = new Map(plan.components.map((c) => [c.item, c.nodeId]));
  const run = yield* runFlow(plan, performer(field), {
    ...(input.rounds === undefined ? {} : { rounds: input.rounds }),
    stored: (item) => {
      const nodeId = nodeOf.get(item);
      return nodeId === undefined ? undefined : storedOutput(ctx, nodeId, field);
    },
  });
  return {
    canvasId: input.canvasId,
    order: [...plan.order],
    rounds: run.rounds,
    steps: run.steps,
    outputField: field,
    outcomes: run.outcomes.map((outcome) => {
      const nodeId = nodeOf.get(outcome.item) ?? outcome.item;
      if (outcome.status === "skipped") return { ...outcome, nodeId, after: [...outcome.after] };
      return { ...outcome, nodeId };
    }),
  };
});

export const RUN_VERB: ExtensionAction = {
  id: "run",
  title: "Run a canvas as a computer",
  description:
    "Run the canvas's flow, as tldraw computer does: every item that stands for a node and is joined by " +
    "an edge to another is a component, and each edge carries the output of the one it leaves to the one " +
    "it enters. Upstream runs first (ties in document order). A component whose node names scripts runs " +
    "them, its inputs written to its input field first and its output what they leave in its output field; one with no inputs is a constant (its words); " +
    "any other is an instruction (its node's text) the agent's selected model performs on its inputs " +
    "(ext.agent.complete; where no agent is hosted, it fails by name). Each output is written " +
    "to its node's output field as it is made. A component after one that failed is skipped. A flow that " +
    "loops runs `rounds` rounds, at most 8.",
  mode: { kind: "write" },
  // It runs scripts and spends a model: no code's to call.
  inputSchema: runInput,
  outputSchema: runOutput,
  effect: canvasRunEffect,
};
