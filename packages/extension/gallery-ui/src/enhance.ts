/**
 * The composer's prompt enhancer: the composed prompt rewritten for its
 * model family by the model the person chose (`enhanceInput` says what is
 * asked). The gallery holds no model and names no family that does. Its
 * `enhance` child injects the page's `ModelCompletionService`, so it waits,
 * pending, while no family provides one (the agent off, or no `kb ui` to
 * host it), and offers the enhancer at its point once one does. The
 * composer offers Enhance while the point holds it, and says what it needs
 * while it does not.
 */
import { Effect } from "effect";
import { enhanceInput, type ComposeTarget } from "@kb/gallery";
import { definePlugin, Point } from "@kb/plugin";
import { ModelCompletionService, toast, type ModelCompletion } from "@kb/ui-sdk";

export interface PromptEnhancer {
  /** `prompt` rewritten for `target`; null after telling the person why not. */
  readonly enhance: (prompt: string, target: ComposeTarget) => Promise<string | null>;
}

/** Where the gallery's enhance child offers the enhancer while a model's completion is provided. */
export const PromptEnhancerPoint = Point<PromptEnhancer>()("gallery.prompt-enhancer");

/** What the composer says Enhance needs while no enhancer is offered. */
export const ENHANCE_NEEDS =
  "Enhance needs the agent: switch it on in Settings → Extensions, in kb ui";

function enhancerOver(completion: ModelCompletion): PromptEnhancer {
  return {
    enhance: async (prompt, target) => {
      const reply = await completion.complete(enhanceInput(prompt, target));
      if (reply.ok) return reply.text;
      toast(`Could not enhance the prompt: ${reply.reason}`);
      return null;
    },
  };
}

export const galleryEnhancePlugin = definePlugin({
  name: "enhance",
  inject: [ModelCompletionService],
  apply: (ctx) =>
    Effect.gen(function* () {
      const completion = yield* ctx.get(ModelCompletionService);
      yield* ctx.contribute(PromptEnhancerPoint, {
        id: "enhancer",
        value: enhancerOver(completion),
      });
    }),
});
