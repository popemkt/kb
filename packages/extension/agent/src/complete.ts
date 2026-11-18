import { Effect, Encoding, Stream } from "effect";
import { z } from "zod";
import {
  AGENT_IMAGE_TYPES,
  AgentCompleteAction,
  COMPLETION_LIMITS,
  type CompleteOutputSchema,
  Assets,
  CoreInvoke,
  extensionActionId,
  failed,
  type ExtensionAction,
} from "@kb/contracts";
import { assetMediaType, domainError } from "@kb/model";
import { SIGHT_ID, agentExtension } from "./extension.ts";
import { chooseProvider, type Backends } from "./selection.ts";
import { isAgentImageType, type AgentImage, type AgentRuntime, type AgentTurn } from "./runtime.ts";

/**
 * `ext.agent.complete` (`DESIGN.md` → Agent packages → completion): kb's
 * one way to ask a model for text. It is one turn of the provider the
 * person chose for the agent (`sys.f.agent.provider`, read per call by the
 * one chooser, `chooseProvider`, with its binding's trust), with no tools
 * and no screen: the caller's system prompt and one message in, with the
 * pictures it names from the root's assets, the reply's text out, and how
 * many pictures the model was shown, none when its runtime does not see.
 * A family that needs a model calls it (a canvas run's instruction through its contribution key; a
 * page half, such as the gallery's prompt enhancer, through the
 * `ModelCompletionService` the agent's page half provides over it), so no
 * family holds a model client of its own.
 *
 * Every call is bounded: what it is sent ({@link COMPLETION_LIMITS}), how
 * much of the reply it keeps, and how long it waits. It declares no node it
 * acts on (`targets`), so no sandboxed code may call it, directly or
 * through an action it calls (`grantRefusal`, `callWithin`).
 */

/** The id the completion is invoked by: the one spelling of it, for the family's own halves. */
export const AGENT_COMPLETE_ACTION = AgentCompleteAction.id;

/** The id the sight is invoked by. */
export const AGENT_SIGHT_ACTION = extensionActionId(agentExtension.name, SIGHT_ID);

/** What the sight answers. */
export const SightOutputSchema = z.object({
  sees: z.boolean().describe("whether the model a completion would ask is shown its pictures"),
  provider: z.string().describe("the provider a completion would ask, or the default runtime"),
});

/** The system prompt of a completion whose caller names none. */
const COMPLETION_SYSTEM = "Answer the message. Reply with the answer alone, no preamble.";

type CompleteInput = z.infer<typeof AgentCompleteAction.definition.inputSchema>;
type CompleteOutput = z.infer<typeof CompleteOutputSchema>;

/**
 * The pictures `paths` name, read from the root's assets: each a media type
 * a model takes and no larger than its bound, or the call is refused.
 */
const picturesOf = Effect.fn("ext.agent.complete.pictures")(function* (paths: readonly string[]) {
  const assets = yield* Assets;
  const images: AgentImage[] = [];
  for (const path of paths) {
    const mediaType = assetMediaType(path);
    if (mediaType === null || !isAgentImageType(mediaType)) {
      return yield* domainError(
        "invalid_input",
        `${path} is not a picture a model takes (${AGENT_IMAGE_TYPES.join(", ")})`,
        { path },
      );
    }
    const bytes = yield* assets.read(path, COMPLETION_LIMITS.imageBytes);
    images.push({ mediaType, data: Encoding.encodeBase64(bytes) });
  }
  return images;
});

/** A turn of one message and no tools: a tool call, which no model is offered, is refused. */
function completionTurn(input: CompleteInput, images: readonly AgentImage[]): AgentTurn {
  return {
    system: input.system ?? COMPLETION_SYSTEM,
    message: { text: input.message, screen: null, images },
    resume: undefined,
    tools: [],
    call: (action) =>
      Effect.succeed(failed(action, "unknown_action", "a completion offers no tools")),
  };
}

/** The reply of `turn` on `runtime`, kept to its bound and waited for no longer than its bound. */
const replyOf = Effect.fn("ext.agent.complete.reply")(function* (
  runtime: AgentRuntime,
  turn: AgentTurn,
) {
  let text = "";
  let truncated = false;
  yield* Stream.runForEachWhile(runtime.turn(turn), (output) =>
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
  return { text, truncated };
});

function completeEffect(backends: Backends) {
  return Effect.fn("ext.agent.complete")(function* (input: CompleteInput) {
    const invoke = yield* CoreInvoke;
    if (invoke === null) {
      return yield* domainError("internal", "this host runs no invoke core to read the provider");
    }
    // Every picture is read, and refused, before any model runs.
    const images = yield* picturesOf(input.images ?? []);
    // The provider is read as the caller reads, through the invoke core.
    const chosen = yield* chooseProvider((request) => invoke(request, "read"), backends).pipe(
      Effect.mapError((error) => domainError("internal", error.message)),
    );
    // A runtime of its own, so nothing of the call outlives it.
    const runtime = chosen.build();
    const { text, truncated } = yield* replyOf(runtime, completionTurn(input, images));
    const answer: CompleteOutput = {
      text,
      truncated,
      provider: chosen.label ?? runtime.name,
      // What the runtime's wire carried: a runtime that does not see answered from the text alone.
      saw: runtime.sees ? images.length : 0,
    };
    return answer;
  });
}

/** The action over the host's `backends`. */
function completeAction(backends: Backends): ExtensionAction {
  return {
    ...AgentCompleteAction.definition,
    title: "Complete with the agent's model",
    description:
      "Ask the model the person chose for the agent (its selected #agent-provider, or the default) " +
      "for one reply: a system prompt and one message in, with up to " +
      `${COMPLETION_LIMITS.images} pictures from kb's assets, the reply's text out. The model is ` +
      "offered no tools and sees nothing of kb but the message and its pictures; `saw` says how " +
      "many pictures it was shown, 0 when its runtime cannot take them and it answered from the " +
      "text alone.",
    // It changes nothing in kb; it reaches the provider's endpoint or starts its process.
    mode: { kind: "read", outsideRoot: true },
    effect: completeEffect(backends),
  };
}

function sightEffect(backends: Backends) {
  return Effect.fn("ext.agent.sight")(function* () {
    const invoke = yield* CoreInvoke;
    if (invoke === null) {
      return yield* domainError("internal", "this host runs no invoke core to read the provider");
    }
    const chosen = yield* chooseProvider((request) => invoke(request, "read"), backends).pipe(
      Effect.mapError((error) => domainError("internal", error.message)),
    );
    // Building a runtime starts nothing: a turn would.
    const runtime = chosen.build();
    const answer: z.infer<typeof SightOutputSchema> = {
      sees: runtime.sees,
      provider: chosen.label ?? runtime.name,
    };
    return answer;
  });
}

/** Whether a completion's model sees, read from the provider it would ask, asking no model. */
function sightAction(backends: Backends): ExtensionAction {
  return {
    id: SIGHT_ID,
    title: "Whether the agent's model sees pictures",
    description:
      "Whether the model a completion would ask (the agent's selected #agent-provider, or the " +
      "default) is shown the pictures sent with a message. It reads the provider and asks no model.",
    mode: { kind: "read" },
    inputSchema: z.object({}),
    outputSchema: SightOutputSchema,
    effect: sightEffect(backends),
  };
}

/**
 * The agent family's actions, served by its host entry as its `threads`
 * capability (`agentExtension.host`), in its `ext.agent` namespace, on the
 * backends the bridge holds.
 */
// GAP [[01M5ZF97R8ZK857GS29QGVD3EN]] ext.agent.models and ext.agent.check are not built
export function agentActions(backends: Backends): readonly ExtensionAction[] {
  return [completeAction(backends), sightAction(backends)];
}
