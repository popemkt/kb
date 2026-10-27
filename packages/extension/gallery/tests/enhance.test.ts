/**
 * The enhancer's request (research record §6.5): the composed prompt is the
 * one message, verbatim, and the system prompt names the target family, how
 * it reads a prompt, and asks for the rewritten prompt alone.
 */
import { describe, expect, test } from "bun:test";
import { COMPOSE_TARGETS, ENHANCE_ACTION, EnhancedSchema, enhanceInput } from "@kb/gallery";
describe("the prompt enhancer's request", () => {
  test("asks the agent family's completion, by id", () => {
    expect(ENHANCE_ACTION).toBe("ext.agent.complete");
  });
  test("sends the composed prompt as the message, verbatim", () => {
    const prompt = "a lighthouse on a cliff, (golden hour:1.2), <lora:film:0.6>";
    expect(enhanceInput(prompt, "sd").message).toBe(prompt);
  });
  test("tells the model which family it writes for, and to answer with the prompt alone", () => {
    for (const target of COMPOSE_TARGETS) {
      const { system } = enhanceInput("a cat", target.id);
      expect(system).toContain(`You rewrite prompts for ${target.label}`);
      expect(
        system.endsWith(
          "Reply with the rewritten prompt alone: no preamble, no quotes around it, no notes.",
        ),
      ).toBe(true);
    }
  });
  test("a family that reads no negative prompt is written for without one", () => {
    for (const target of COMPOSE_TARGETS) {
      const { system } = enhanceInput("a cat", target.id);
      expect(system.includes("It reads no negative prompt")).toBe(!target.negatives);
    }
  });
  test("reads the reply's text from what the completion answers", () => {
    const answer = { text: "a lighthouse", truncated: false, provider: "scripted" };
    expect(EnhancedSchema.parse(answer)).toEqual({ text: "a lighthouse" });
  });
});
