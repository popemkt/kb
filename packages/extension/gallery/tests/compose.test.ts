/**
 * Composition is AUTOMATIC1111's `{prompt}` rule exactly: the examples are
 * its own (research record §2), and the properties are the ones that make
 * it the rule to adopt: total, stacking, and separate for the negative.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { composePrompt, mergePrompt } from "@kb/gallery";

describe("mergePrompt", () => {
  test("a template with {prompt} has every occurrence replaced", () => {
    expect(mergePrompt("cinematic still {prompt}, film grain", "a cat")).toBe(
      "cinematic still a cat, film grain",
    );
    expect(mergePrompt("{prompt} and {prompt}", "x")).toBe("x and x");
  });

  test("a template without {prompt} is appended, empty parts dropped", () => {
    expect(mergePrompt("masterpiece, best quality", "a cat")).toBe(
      "a cat, masterpiece, best quality",
    );
    expect(mergePrompt("golden hour", "  ")).toBe("golden hour");
    expect(mergePrompt("", "a cat")).toBe("a cat");
  });

  test("no input loses text", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (template, prompt) => {
        const out = mergePrompt(template, prompt);
        if (template.includes("{prompt}")) expect(out).toContain(prompt);
        else {
          expect(out).toContain(prompt.trim());
          expect(out).toContain(template.trim());
        }
      }),
    );
  });
});

describe("composePrompt", () => {
  const cinematic = { prompt: "cinematic still {prompt} . film grain", negative: "cartoon" };
  const golden = { prompt: "golden hour", negative: "" };

  test("styles apply in order, each wrapping the result so far", () => {
    expect(composePrompt("a lighthouse", "", [golden, cinematic]).positive).toBe(
      "cinematic still a lighthouse, golden hour . film grain",
    );
    expect(composePrompt("a lighthouse", "", [cinematic, golden]).positive).toBe(
      "cinematic still a lighthouse . film grain, golden hour",
    );
  });

  test("the negative is merged by the same rule, separately", () => {
    expect(composePrompt("a lighthouse", "blurry", [cinematic, golden]).negative).toBe(
      "blurry, cartoon",
    );
  });

  test("a target that reads no negative gets none", () => {
    expect(composePrompt("a lighthouse", "blurry", [cinematic], "flux").negative).toBe("");
    expect(composePrompt("a lighthouse", "blurry", [cinematic], "video").negative).toBe("");
  });

  test("an empty subject leaves no dangling comma, and a repeated part is kept once", () => {
    const shot = { prompt: "{prompt}, wide shot, highly detailed", negative: "blurry, lowres" };
    const neon = { prompt: "{prompt}, neon light, Highly detailed", negative: "lowres" };
    expect(composePrompt("", "", [shot, neon])).toEqual({
      positive: "wide shot, highly detailed, neon light",
      negative: "blurry, lowres",
    });
  });

  test("no styles is the subject as written", () => {
    expect(composePrompt("a lighthouse", "blurry", [])).toEqual({
      positive: "a lighthouse",
      negative: "blurry",
    });
  });
});
