/**
 * The landing's budget (DESIGN.md → Provider roles, `ui.landing`): a landing
 * that does not answer in about 4 s is given up on, the page stays home and
 * the person is told why, so the workspace is never held for good. A file of
 * its own, since an overrun demotes days for the rest of the page's session,
 * as it would in a page, and every test in a file shares that session.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { definePlugin } from "@kb/plugin";
import {
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

/** Days' page half reduced to its landing, under days' own declaration. */
function daysLanding(answer: Landing) {
  return bundledPlugin(
    daysExtension,
    definePlugin({ name: "days", apply: (ctx) => ctx.provide(LandingService, answer) }),
  );
}

describe("ui.landing's budget", () => {
  it("gives up on a landing that does not answer in about 4 s: home, and says so", async () => {
    vi.useFakeTimers();
    try {
      const told: string[] = [];
      setToastSink((message) => told.push(message));
      const never = Promise.withResolvers<string>();
      syncPagePlugins([daysLanding(() => never.promise)]);
      const landing = land();
      await vi.advanceTimersByTimeAsync(3_900);
      expect(told).toEqual([]);
      // Past the budget the wait ends, so the shell draws the workspace home.
      await vi.advanceTimersByTimeAsync(200);
      await landing;
      expect(getPath()).toBe("/");
      expect(told).toEqual(["Stayed home: the landing did not answer in time"]);
      // An answer after the budget moves nothing.
      never.resolve("days.2026-11-11");
      await vi.advanceTimersByTimeAsync(0);
      expect(getPath()).toBe("/");
    } finally {
      vi.useRealTimers();
    }
  });
});
