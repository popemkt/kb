/**
 * The composer's model: what the person's own model does for the gallery,
 * asked through the page's `ModelCompletionService`. The gallery holds no
 * model and names no family that does. Its `model` child injects the
 * service, so it waits, pending, while no family provides one (the agent
 * off, or no `kb ui` to host it), and offers the composer's model at its
 * point once one does. Each use offers itself while the point holds it and
 * says what it needs while it does not; every workflow still works by hand.
 *
 * - **Enhance** rewrites a composed prompt for its model family
 *   (`enhanceInput`).
 * - **Reflect** breaks an idea, words and pictures, into axes with terms
 *   (`reflectInput`, read back by `parseReflection`). Pictures go as asset
 *   paths; a model that cannot see is sent the words alone, and the reply
 *   says how many pictures it saw, so the page can say so.
 */
import { Effect } from "effect";
import {
  enhanceInput,
  parseReflection,
  reflectInput,
  type ComposeTarget,
  type Library,
  type Reflection,
} from "@kb/gallery";
import { definePlugin, Point } from "@kb/plugin";
import { ModelCompletionService, toast, type ModelCompletion } from "@kb/ui-sdk";

/** A reflection, and how many of the pictures sent the model saw. */
export interface Reflected {
  readonly reflection: Reflection;
  readonly saw: number;
}

export interface ComposerModel {
  /** `prompt` rewritten for `target`; null after telling the person why not. */
  readonly enhance: (prompt: string, target: ComposeTarget) => Promise<string | null>;
  /** `words` and `pictures` (asset paths) broken into axes; null after saying why not. */
  readonly reflect: (
    words: string,
    pictures: readonly string[],
    library: Library,
  ) => Promise<Reflected | null>;
}

/** Where the gallery's `model` child offers the composer's model while a completion is provided. */
export const ComposerModelPoint = Point<ComposerModel>()("gallery.model");

/** What the page says a use of the model needs while none is offered. */
export const MODEL_NEEDS = "needs the agent: switch it on in Settings → Extensions, in kb ui";

/** The most pictures one reflection sends. */
const PICTURES = 4;

function composerModelOver(completion: ModelCompletion): ComposerModel {
  return {
    enhance: async (prompt, target) => {
      const reply = await completion.complete(enhanceInput(prompt, target));
      if (reply.ok) return reply.text;
      toast(`Could not enhance the prompt: ${reply.reason}`);
      return null;
    },
    reflect: async (words, pictures, library) => {
      const images = pictures.slice(0, PICTURES);
      const reply = await completion.complete({
        ...reflectInput(words, library, images.length),
        ...(images.length === 0 ? {} : { images }),
      });
      if (!reply.ok) {
        toast(`Could not reflect it: ${reply.reason}`);
        return null;
      }
      const reflection = parseReflection(reply.text);
      if (reflection === null) {
        toast("The model's answer could not be read as axes; try again");
        return null;
      }
      return { reflection, saw: reply.saw };
    },
  };
}

export const galleryModelPlugin = definePlugin({
  name: "model",
  inject: [ModelCompletionService],
  apply: (ctx) =>
    Effect.gen(function* () {
      const completion = yield* ctx.get(ModelCompletionService);
      yield* ctx.contribute(ComposerModelPoint, {
        id: "model",
        value: composerModelOver(completion),
      });
    }),
});
