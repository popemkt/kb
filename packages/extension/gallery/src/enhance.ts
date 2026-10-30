/**
 * The prompt enhancer (research record §6.5): a composed prompt rewritten
 * for its model family by the model the person chose for the agent. The
 * gallery holds no model client and names no family that does: its page
 * half asks whichever family provides the page's model completion
 * (`ModelCompletionService`, DESIGN-UI.md → The gallery). This module says
 * what it asks: an instruction-LLM system prompt (research
 * record §2, "Enhancers": a role line, rules, an output cue) that names the
 * target family and how that family reads a prompt, and the prompt as the
 * one message.
 */
import { COMPOSE_TARGETS, type ComposeTarget } from "./compose.ts";
/** How each model family reads a prompt, which the enhancer writes for. */
const HOW_IT_READS: Readonly<Record<ComposeTarget, string>> = {
  sd:
    "It reads comma-separated tags and short phrases, the most important first. " +
    "Keep any (word:1.2) weights and <lora:name:0.8> tokens exactly as written.",
  flux:
    "It reads natural-language sentences, and word order is attention, so lead with the subject. " +
    "It reads no negative prompt: say what should be there, never what should not.",
  video:
    "It reads a description of one shot in plain sentences: the subject and what it does, the " +
    "camera's framing and movement, the lens, the light, and any sound. It reads no negative " +
    "prompt: say what should be there, never what should not.",
};
/** The system prompt that rewrites a prompt for `target`. */
export function enhancerSystem(target: ComposeTarget): string {
  const label = COMPOSE_TARGETS.find((t) => t.id === target)?.label ?? target;
  return [
    `You rewrite prompts for ${label}, a generative image or video model.`,
    HOW_IT_READS[target],
    "Keep the person's intent, subject and every style they chose. Add concrete visual detail " +
      "(materials, light, colour, composition) only where it serves that intent. Put any text " +
      "that should appear in the picture in double quotes. Stay under 120 words.",
    "Reply with the rewritten prompt alone: no preamble, no quotes around it, no notes.",
  ].join("\n\n");
}
/** What the enhancer sends the completion for `prompt`, composed for `target`. */
export function enhanceInput(
  prompt: string,
  target: ComposeTarget,
): { readonly system: string; readonly message: string } {
  return { system: enhancerSystem(target), message: prompt };
}
