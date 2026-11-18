import { Effect, Schema } from "effect";
import { z } from "zod";
import { isAssetPath, present } from "@kb/model";
import { failed, type CoreInvoker, type ActionReceipt } from "./actions.ts";
import { ActionPoint, extensionActionId } from "./extension.ts";

type ActionResult<Output> =
  | (Extract<ActionReceipt, { status: "succeeded" }> & { readonly output: Output })
  | Extract<ActionReceipt, { status: "failed" }>;

/**
 * A capability's schema is shared. Its provider binds the address from its own
 * declaration when it constructs the action, including while dormant.
 */
function actionKey<I extends z.ZodType, O extends z.ZodType>(
  localId: string,
  inputSchema: I,
  outputSchema: O,
) {
  let binding: { readonly family: string; readonly id: string } | undefined;
  const address = () => present(binding, `the provider of ${localId} binds its action key`);
  const definition = { id: localId, inputSchema, outputSchema };
  const request = (input: z.input<I>) => ({ id: address().id, input });
  return {
    kind: "contribution" as const,
    point: ActionPoint,
    get id() {
      return address().id;
    },
    get name() {
      return address().id;
    },
    get family() {
      return address().family;
    },
    definition,
    bind(family: string) {
      if (binding !== undefined && binding.family !== family) {
        throw new Error(`the provider of ${binding.id} already bound this action key`);
      }
      binding ??= { family, id: extensionActionId(family, localId) };
      return definition;
    },
    request,
    invoke: (run: CoreInvoker, input: z.input<I>, scope: Parameters<CoreInvoker>[1]) => {
      const call = request(input);
      return run(call, scope).pipe(
        Effect.map((receipt): ActionResult<z.output<O>> => {
          if (receipt.status === "failed") return receipt;
          const parsed = outputSchema.safeParse(receipt.output);
          return parsed.success
            ? { ...receipt, output: parsed.data }
            : failed(call.id, "internal", `${call.id} returned an invalid reply`);
        }),
      );
    },
  };
}

export const AGENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** The bounds of one completion: what it sends, what it keeps of the reply, how long it waits. */
export const COMPLETION_LIMITS = {
  /** The longest system prompt, in characters. */
  system: 20_000,
  /** The longest message, in characters. */
  message: 100_000,
  /** The most pictures a message carries. */
  images: 4,
  /** The largest picture, in bytes. */
  imageBytes: 5 * 1024 * 1024,
  /** The most of the reply kept, in characters; the turn stops there. */
  reply: 32_000,
  /** How long a completion waits for its whole reply. */
  timeoutMs: 180_000,
} as const;

const completeInput = z.object({
  system: z
    .string()
    .min(1)
    .max(COMPLETION_LIMITS.system)
    .optional()
    .describe(
      "what the model is told it is and does (the system prompt); a plain answerer when absent",
    ),
  message: z
    .string()
    .min(1)
    .max(COMPLETION_LIMITS.message)
    .describe("the one message the model answers"),
  images: z
    .array(
      z
        .string()
        .refine(isAssetPath, "an asset path, assets/<name>.<ext>")
        .describe("an asset path, as asset.upload answers it"),
    )
    .max(COMPLETION_LIMITS.images)
    .optional()
    .describe(
      `pictures shown with the message: at most ${COMPLETION_LIMITS.images} of kb's assets ` +
        `(${AGENT_IMAGE_TYPES.join(", ")}), each at most ${COMPLETION_LIMITS.imageBytes / 1024 / 1024} MiB`,
    ),
});

/** What a completion answers. */
export const CompleteOutputSchema = z.object({
  text: z.string().describe("the reply"),
  truncated: z
    .boolean()
    .describe(`whether the reply was cut at ${COMPLETION_LIMITS.reply} characters`),
  provider: z.string().describe("who answered: the provider's name, or the default runtime's"),
  saw: z
    .number()
    .int()
    .min(0)
    .describe("how many of the pictures the model was shown: 0 when its runtime does not see"),
});

const listInput = z.object({
  subjects: z
    .array(z.string().min(1))
    .describe("the nodes whose scripts to list: a canvas's board and the page itself, say"),
});

/** One script as listed: which, for which node, what it may ask, and whether it runs. */
const ListedScriptSchema = z.object({
  id: z.string(),
  label: z.string(),
  subject: z.string().describe("the node that names it, its kb.subject when it runs"),
  reads: z.string().describe("what it may read: none, its subject, or the graph"),
  actions: z.array(z.string()).describe("the actions it may call"),
  trusted: z.boolean().describe("whether a person trusts it here: an untrusted script never runs"),
});

const listOutput = z.object({ scripts: z.array(ListedScriptSchema) });

const scriptRunInput = z.object({
  script: z.string().min(1).describe("the #script node to run"),
  subject: z
    .string()
    .min(1)
    .describe("the node it runs for, its kb.subject: the canvas it acts on, say"),
});

const scriptRunOutput = z.object({
  script: z.string(),
  subject: z.string(),
  ended: z
    .object({ reason: z.string(), message: z.string() })
    .nullable()
    .describe("why the run ended, or null when it went quiet still running"),
});

export const EdgeKindSchema = Schema.Union([
  Schema.Literals(["mention", "child", "ref-prop"]),
  Schema.String.pipe(
    Schema.refine((key): key is `prop:${string}` => key.startsWith("prop:"), {
      expected: 'a "prop:<field id>" key',
    }),
  ),
]);

const isEdgeKind = Schema.is(EdgeKindSchema);
export const edgeKinds = z
  .array(
    z
      .string()
      .refine(isEdgeKind, { message: 'expected mention, child, ref-prop or "prop:<field id>"' }),
  )
  .optional()
  .describe("The relationships walked; default mention, child and ref-prop (every ref field)");
export const includeSystem = z
  .boolean()
  .optional()
  .describe(
    "Walk through scaffolding (sys.* nodes, commands, tags and fields) too; by default the graph elides it",
  );

const edgesInput = z.object({
  ids: z.array(z.string()).min(1).describe("The nodes whose edges among themselves are drawn"),
  kinds: edgeKinds,
  includeSystem,
});

const edgesOutput = z.object({
  /** Of the ids named, those the graph shows, once each and in the order named. */
  nodes: z.array(z.string()),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: z.string(),
      weight: z.number(),
      label: z.string(),
    }),
  ),
});

export const AgentCompleteAction = actionKey("complete", completeInput, CompleteOutputSchema);
export const ScriptListAction = actionKey("script.list", listInput, listOutput);
export const ScriptRunAction = actionKey("script.run", scriptRunInput, scriptRunOutput);
export const GraphEdgesAction = actionKey("edges", edgesInput, edgesOutput);
