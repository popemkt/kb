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
 *   paths, as many as the completion takes; a model that cannot see is
 *   sent the words alone, and the reply says how many pictures it saw. A
 *   request the endpoint refuses with pictures is asked again with the
 *   words alone, and the reflection says why, so the page can.
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

/**
 * A reflection, how many pictures were sent and how many the model saw;
 * `refused` is why the request with pictures failed, when the words alone
 * answered.
 */
export interface Reflected {
  readonly reflection: Reflection;
  readonly sent: number;
  readonly saw: number;
  readonly refused?: string;
}

export interface ComposerModel {
  /** Whether the person's model is shown pictures: a picture is then read without asking. */
  readonly sees: () => Promise<boolean>;
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

function composerModelOver(completion: ModelCompletion): ComposerModel {
  return {
    sees: () => completion.sees(),
    enhance: async (prompt, target) => {
      const reply = await completion.complete(enhanceInput(prompt, target));
      if (reply.ok) return reply.text;
      toast(`Could not enhance the prompt: ${reply.reason}`);
      return null;
    },
    reflect: async (words, pictures, library) => {
      const images = pictures.slice(0, completion.pictures);
      const ask = (shown: readonly string[]) =>
        completion.complete({
          ...reflectInput(words, library, shown.length),
          ...(shown.length === 0 ? {} : { images: shown }),
        });
      let reply = await ask(images);
      let refused: string | undefined;
      // A model behind a seeing wire may still refuse pictures: ask again with the words alone.
      if (!reply.ok && images.length > 0 && words.trim() !== "") {
        refused = reply.reason;
        reply = await ask([]);
      }
      if (!reply.ok) {
        toast(`Could not reflect it: ${reply.reason}`);
        return null;
      }
      const reflection = parseReflection(reply.text);
      if (reflection === null) {
        toast("The model's answer could not be read as axes; try again");
        return null;
      }
      return {
        reflection,
        sent: images.length,
        saw: reply.saw,
        ...(refused === undefined ? {} : { refused }),
      };
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
