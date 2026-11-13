/**
 * `ext.days.today` (DESIGN.md → Days): a day's node, made, with whatever is
 * missing above it, in one transaction. The day is the caller's; without
 * one it is today in the store's zone (`storeToday`).
 */
import { Effect } from "effect";
import { z } from "zod";
import { GraphWrites, KbCtx, type ExtensionAction } from "@kb/contracts";
import { domainError, present, type DomainError } from "@kb/model";
import { storeToday } from "./capture.ts";
import { isDayKey } from "./period.ts";
import { planToday } from "./today-plan.ts";

const todayInput = z.object({
  day: z
    .string()
    .optional()
    .describe(
      "the calendar date, YYYY-MM-DD; today in the store's time zone (the days time zone setting, else the zone of the process that runs it) when omitted",
    ),
});
const todayOutput = z.object({
  id: z.string().describe("the day's node"),
  made: z
    .array(z.string())
    .describe("the nodes this call made, parent first; empty when the day existed"),
});

/**
 * One node per key holds across every caller because the write lands only
 * on the state it was planned from (`GraphWrites.commit`, the store's
 * conditional commit): a second caller that planned the same day before the
 * first committed is planned again, finds the day, and writes nothing. The
 * unique-key guard is what refuses a hand-keyed duplicate.
 */
const todayEffect = Effect.fn("ext.days.today")(function* (
  input: z.infer<typeof todayInput>,
): Effect.fn.Return<z.infer<typeof todayOutput>, DomainError, KbCtx | GraphWrites> {
  const ctx = yield* KbCtx;
  const day = input.day ?? (yield* storeToday(ctx.nodes));
  if (!isDayKey(day))
    return yield* domainError("invalid_input", `not a calendar date (YYYY-MM-DD): ${day}`);
  const write = yield* (yield* GraphWrites).commit((nodes) => planToday(nodes, day));
  const { id, made } = present(write, "a day plan always answers");
  return { id, made: [...made] };
});

export const TODAY_ACTION: ExtensionAction = {
  id: "today",
  title: "Open a day",
  description:
    "A day's node (today's when day is omitted), made the first time it is asked for, in one transaction with whatever is missing above it: the journal root, the year, the ISO week. A day node is found by its period key, never its text or place.",
  mode: { kind: "write" },
  inputSchema: todayInput,
  outputSchema: todayOutput,
  effect: todayEffect,
};
