/**
 * The agent's completion as the page's `ModelCompletionService`: the
 * person's call to the family's own `ext.agent.complete`, through the
 * page's one invoke path, its reply read as text or as why there is none.
 * A half that wants a model's text injects the service, so it waits while
 * the agent is off and names nothing of this family.
 */
import { AGENT_COMPLETE_ACTION, CompleteOutputSchema } from "@kb/agent";
import { failed, onWire, PAGE_WIRE } from "@kb/contracts";
import type { CompletionReply, CompletionRequest, ModelCompletion } from "@kb/ui-sdk";
import type { AgentPorts } from "./chat";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The completion over `ports`' invoke path. */
export function modelCompletion(ports: Pick<AgentPorts, "invoke">): ModelCompletion {
  return {
    complete: async (request: CompletionRequest): Promise<CompletionReply> => {
      const receipt = await ports
        .invoke(onWire(PAGE_WIRE, { id: AGENT_COMPLETE_ACTION, input: request }))
        .catch((error: unknown) => failed(AGENT_COMPLETE_ACTION, "internal", messageOf(error)));
      if (receipt.status === "failed") return { ok: false, reason: receipt.message };
      const reply = CompleteOutputSchema.safeParse(receipt.output);
      if (!reply.success) return { ok: false, reason: "the agent's reply could not be read" };
      const text = reply.data.text.trim();
      return text === "" ? { ok: false, reason: "the model answered nothing" } : { ok: true, text };
    },
  };
}
