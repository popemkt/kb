/**
 * The agent's completion as the page's `ModelCompletionService`: one call to
 * the family's own completion through the port it is given, its reply's
 * text trimmed, and every way there is no text said in words.
 */
import { describe, expect, test } from "vitest";
import { AGENT_COMPLETE_ACTION } from "@kb/agent";
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import { modelCompletion } from "./completion";

function over(answer: () => Promise<ActionReceipt>) {
  const calls: ActionInvocation[] = [];
  const completion = modelCompletion({
    invoke: (invocation) => {
      calls.push(invocation);
      return answer();
    },
  });
  return { calls, completion };
}

const succeeded = (output: unknown): Promise<ActionReceipt> =>
  Promise.resolve({ status: "succeeded", id: AGENT_COMPLETE_ACTION, output });

describe("the agent's model completion", () => {
  test("asks the family's completion as the person, and answers its text", async () => {
    const { calls, completion } = over(() =>
      succeeded({ text: "\n a lighthouse  ", truncated: false, provider: "scripted" }),
    );
    const request = { system: "You rewrite prompts.", message: "a lighthouse" };
    expect(await completion.complete(request)).toEqual({ ok: true, text: "a lighthouse" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(AGENT_COMPLETE_ACTION);
    expect(calls[0]?.input).toEqual(request);
    expect(calls[0]?.actor).toBe("human");
  });

  test("a failed call answers its reason", async () => {
    const { completion } = over(() =>
      Promise.resolve({
        status: "failed",
        id: AGENT_COMPLETE_ACTION,
        code: "internal",
        message: "agent provider Local proxy is not trusted on this machine",
      }),
    );
    expect(await completion.complete({ message: "a cat" })).toEqual({
      ok: false,
      reason: "agent provider Local proxy is not trusted on this machine",
    });
  });

  test("a call that throws, an empty reply and an unreadable one each answer why", async () => {
    const thrown = over(() => Promise.reject(new Error("socket closed")));
    expect(await thrown.completion.complete({ message: "a cat" })).toEqual({
      ok: false,
      reason: "socket closed",
    });
    const empty = over(() => succeeded({ text: "  ", truncated: false, provider: "scripted" }));
    expect(await empty.completion.complete({ message: "a cat" })).toEqual({
      ok: false,
      reason: "the model answered nothing",
    });
    const odd = over(() => succeeded({ reply: "a cat" }));
    expect(await odd.completion.complete({ message: "a cat" })).toEqual({
      ok: false,
      reason: "the agent's reply could not be read",
    });
  });
});
