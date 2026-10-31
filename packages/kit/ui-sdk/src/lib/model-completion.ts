/**
 * A one-shot completion with the model the person chose, as a service: a
 * system prompt and one message in, with any pictures from kb's assets, the
 * reply's text out, and how many pictures the model was shown. The family that
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
  /**
   * Pictures shown with the message: kb's assets, by the `assets/…` path
   * `asset.upload` answers with. A model that cannot take them answers from
   * the text alone.
   */
  readonly images?: readonly string[];
}

/**
 * The reply's text and how many of the request's pictures the model was
 * shown (0 when it answered from the text alone), or why there is no reply,
 * in words the person can read.
 */
export type CompletionReply =
  | { readonly ok: true; readonly text: string; readonly saw: number }
  | { readonly ok: false; readonly reason: string };

export interface ModelCompletion {
  readonly complete: (request: CompletionRequest) => Promise<CompletionReply>;
  /** The most pictures one request may carry: a request with more is refused whole. */
  readonly pictures: number;
}

/** Where a family that holds a model provides its completion while it is loaded. */
export const ModelCompletionService = Service<ModelCompletion>()("ui.model-completion");
