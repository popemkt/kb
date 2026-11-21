/**
 * The landing's deadline is one over the whole election (DESIGN.md →
 * Provider roles, `ui.landing`): when the elected landing stalls and the
 * role runner moves on to the next candidate, that candidate gets what is
 * left of the same 4 s, not 4 s of its own, so two stalled candidates hold
 * the first paint no longer than one. The fault is the landing role's
 * alone: days' other roles stand. A file of its own, since the overrun
 * demotes both candidates for the rest of the page's session.
 */
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bundledPlugin, defineExtension, LANDING_ROLE } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { definePlugin } from "@kb/plugin";
import {
  CaptureTargetService,
  captureTarget,
  getPath,
  land,
  LandingService,
  setToastSink,
  syncUiPlugins,
  type Landing,
} from "@kb/ui-sdk";
import { installDomGlobals } from "@kb/ui-test-kit";
import { syncPagePlugins } from "@/test-support/page-plugins";

let restore: () => void = () => {};
beforeAll(() => {
  restore = installDomGlobals().restore;
});
afterAll(() => {
  syncUiPlugins([]);
  restore();
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

const INBOX = "days.inbox";

/** Days' page half reduced to its landing and its capture target, under days' own declaration. */
function days(answer: Landing) {
  return bundledPlugin(
    daysExtension,
    definePlugin({
      name: "days",
      apply: (ctx) =>
        Effect.all([
          ctx.provide(LandingService, answer),
          ctx.provide(CaptureTargetService, () => Promise.resolve(INBOX)),
        ]),
    }),
  );
}

/** A second family that claims the landing behind days (a lower priority wins), the next candidate when days is faulted. */
const runnerUp = defineExtension({
  name: "runner-up",
  label: "Runner-up",
  manifest: {
    replaces: [{ role: LANDING_ROLE.role, priority: 90, why: "A second landing to fall back on." }],
    capabilities: { page: "full" },
  },
});

function runnerUpLanding(answer: Landing) {
  return bundledPlugin(
    runnerUp,
    definePlugin({ name: "runner-up", apply: (ctx) => ctx.provide(LandingService, answer) }),
  );
}

describe("ui.landing's one deadline", () => {
  it("two stalled candidates hold the page about 4 s all told, not 4 s each", async () => {
    vi.useFakeTimers();
    try {
      const told: string[] = [];
      setToastSink((message) => told.push(message));
      const asked: string[] = [];
      const stall =
        (who: string): Landing =>
        () => {
          asked.push(who);
          return new Promise<string>(() => undefined);
        };
      syncPagePlugins([days(stall("days")), runnerUpLanding(stall("runner-up"))]);
      let settled = false;
      const landing = land().finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(3_900);
      expect(asked).toEqual(["days"]);
      expect(settled).toBe(false);
      // At the deadline days is faulted and the runner-up asked, with no time
      // left of its own: the wait ends there, not 4 s later.
      await vi.advanceTimersByTimeAsync(200);
      await landing;
      expect(settled).toBe(true);
      expect(asked).toEqual(["days", "runner-up"]);
      expect(getPath()).toBe("/");
      expect(told).toEqual(["Stayed home: the landing did not answer in time"]);
    } finally {
      vi.useRealTimers();
    }
    // The fault is the landing role's: days still answers where capture goes.
    await expect(captureTarget()).resolves.toBe(INBOX);
  });
});
