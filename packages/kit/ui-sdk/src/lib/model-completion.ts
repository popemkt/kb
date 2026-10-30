/**
 * A one-shot completion with the model the person chose, as a service: a
 * system prompt and one message in, the reply's text out. The family that
 * holds a model provides it while its page half is loaded, over its own
 * action; a half that wants a model's text (the gallery's prompt enhancer)
 * injects the service, so it waits, pending, while no family provides it,
 * and names no other family's action or code.
 */
import { Service } from "@kb/plugin";

export interface CompletionRequest {
  /** What the model is told it is and does; a plain answerer when absent. */
  readonly system?: string;
  /** The one message the model answers. */
  readonly message: string;
}

/** The reply's text, or why there is none, in words the person can read. */
export type CompletionReply =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

export interface ModelCompletion {
  readonly complete: (request: CompletionRequest) => Promise<CompletionReply>;
}

/** Where a family that holds a model provides its completion while it is loaded. */
export const ModelCompletionService = Service<ModelCompletion>()("ui.model-completion");
