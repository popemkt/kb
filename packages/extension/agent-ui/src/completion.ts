/**
 * The agent's completion as the page's `ModelCompletionService`: the
 * person's call to the family's own `ext.agent.complete`, through the
 * page's one invoke path, the request (pictures included) passed as it is,
 * its reply read as text and how many pictures the model saw, or as why
 * there is none; and whether its model sees, by the family's
 * `ext.agent.sight`, which asks no model.
 * A half that wants a model's text injects the service, so it waits while
 * the agent is off and names nothing of this family.
 */
import {
  AGENT_COMPLETE_ACTION,
  AGENT_SIGHT_ACTION,
  COMPLETION_LIMITS,
  CompleteOutputSchema,
  SightOutputSchema,
} from "@kb/agent";
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
      if (text === "") return { ok: false, reason: "the model answered nothing" };
      return { ok: true, text, saw: reply.data.saw };
    },
    pictures: COMPLETION_LIMITS.images,
    // A sight that cannot be read is no sight: the page then asks with words.
    sees: async () => {
      const receipt = await ports
        .invoke(onWire(PAGE_WIRE, { id: AGENT_SIGHT_ACTION, input: {} }))
        .catch((error: unknown) => failed(AGENT_SIGHT_ACTION, "internal", messageOf(error)));
      if (receipt.status === "failed") return false;
      const sight = SightOutputSchema.safeParse(receipt.output);
      return sight.success && sight.data.sees;
    },
  };
}
