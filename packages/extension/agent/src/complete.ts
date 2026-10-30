import { Effect, Stream } from "effect";
import { z } from "zod";
import {
  ActionPoint,
  CoreInvoke,
  extensionActionId,
  extensionNamespace,
  failed,
  familyTags,
  provideAction,
  type ExtensionAction,
} from "@kb/contracts";
import { domainError } from "@kb/model";
import { definePlugin, type Plugin } from "@kb/plugin";
import { agentExtension } from "./extension.ts";
import { chooseProvider, type Backends } from "./selection.ts";
import type { AgentTurn } from "./runtime.ts";

/**
 * `ext.agent.complete` (`DESIGN.md` → Agent packages → completion): kb's
 * one way to ask a model for text. It is one turn of the provider the
 * person chose for the agent (`sys.f.agent.provider`, read per call by the
 * one chooser, `chooseProvider`, with its binding's trust), with no tools
 * and no screen: the caller's system prompt and one message in, the reply's
 * text out. A family that needs a model calls it (a canvas run's
 * instruction by id; a page half, such as the gallery's prompt enhancer,
 * through the `ModelCompletionService` the agent's page half provides over
 * it), so no family holds a model client of its own.
 *
 * Every call is bounded: what it is sent ({@link COMPLETION_LIMITS}), how
 * much of the reply it keeps, and how long it waits. It declares no node it
 * acts on (`targets`), so no sandboxed code may call it, directly or
 * through an action it calls (`grantRefusal`, `callWithin`).
 */

/** The bounds of one completion: what it sends, what it keeps of the reply, how long it waits. */
const COMPLETION_LIMITS = {
  /** The longest system prompt, in characters. */
  system: 20_000,
  /** The longest message, in characters. */
  message: 100_000,
  /** The most of the reply kept, in characters; the turn stops there. */
  reply: 32_000,
  /** How long a completion waits for its whole reply. */
  timeoutMs: 180_000,
} as const;

/** The completion's local id, in the family's namespace. */
const COMPLETE_ID = "complete";

/** The id the completion is invoked by: the one spelling of it, for the family's own halves. */
export const AGENT_COMPLETE_ACTION = extensionActionId(agentExtension.name, COMPLETE_ID);

/** The system prompt of a completion whose caller names none. */
const COMPLETION_SYSTEM = "Answer the message. Reply with the answer alone, no preamble.";

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
});

/** What a completion answers. */
export const CompleteOutputSchema = z.object({
  text: z.string().describe("the reply"),
  truncated: z
    .boolean()
    .describe(`whether the reply was cut at ${COMPLETION_LIMITS.reply} characters`),
  provider: z.string().describe("who answered: the provider's name, or the default runtime's"),
});

type CompleteInput = z.infer<typeof completeInput>;
type CompleteOutput = z.infer<typeof CompleteOutputSchema>;

/** A turn of one message and no tools: a tool call, which no model is offered, is refused. */
function completionTurn(input: CompleteInput): AgentTurn {
  return {
    system: input.system ?? COMPLETION_SYSTEM,
    message: { text: input.message, screen: null },
    resume: undefined,
    tools: [],
    call: (action) =>
      Effect.succeed(failed(action, "unknown_action", "a completion offers no tools")),
  };
}

function completeEffect(backends: Backends) {
  return Effect.fn("ext.agent.complete")(function* (input: CompleteInput) {
    const invoke = yield* CoreInvoke;
    if (invoke === null) {
      return yield* domainError("internal", "this host runs no invoke core to read the provider");
    }
    // The provider is read as the caller reads, through the invoke core.
    const chosen = yield* chooseProvider((request) => invoke(request, "read"), backends).pipe(
      Effect.mapError((error) => domainError("internal", error.message)),
    );
    // A runtime of its own, so nothing of the call outlives it.
    const runtime = chosen.build();
    let text = "";
    let truncated = false;
    yield* Stream.runForEachWhile(runtime.turn(completionTurn(input)), (output) =>
      Effect.sync(() => {
        if (output.kind !== "text") return true;
        const room = COMPLETION_LIMITS.reply - text.length;
        text += output.delta.slice(0, room);
        truncated = output.delta.length > room;
        return !truncated;
      }),
    ).pipe(
      Effect.mapError((error) => domainError("internal", error.message)),
      Effect.timeoutOrElse({
        duration: COMPLETION_LIMITS.timeoutMs,
        orElse: () =>
          Effect.fail(
            domainError("internal", `no whole reply within ${COMPLETION_LIMITS.timeoutMs / 1000}s`),
          ),
      }),
    );
    const answer: CompleteOutput = { text, truncated, provider: chosen.label ?? runtime.name };
    return answer;
  });
}

/** The action over the host's `backends`. */
function completeAction(backends: Backends): ExtensionAction {
  return {
    id: COMPLETE_ID,
    title: "Complete with the agent's model",
    description:
      "Ask the model the person chose for the agent (its selected #agent-provider, or the default) " +
      "for one reply: a system prompt and one message in, the reply's text out. The model is " +
      "offered no tools and sees nothing of kb but what the message says.",
    // It changes nothing in kb; it reaches the provider's endpoint or starts its process.
    mode: { kind: "read", outsideRoot: true },
    inputSchema: completeInput,
    outputSchema: CompleteOutputSchema,
    effect: completeEffect(backends),
  };
}

/**
 * The agent family's actions, in its `ext.agent` namespace: a child of the
 * bridge, which holds the backends they run on.
 */
// GAP [[01M5ZF97R8ZK857GS29QGVD3EN]] ext.agent.models and ext.agent.check are not built
export function agentActionsPlugin(backends: Backends): Plugin {
  return definePlugin({
    name: "actions",
    namespace: extensionNamespace(agentExtension.name),
    tags: familyTags(agentExtension),
    apply: (ctx) =>
      Effect.asVoid(ctx.contribute(ActionPoint, provideAction(completeAction(backends)))),
  });
}
