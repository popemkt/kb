/**
 * Where a page that loads at the root opens (DESIGN.md → Provider roles,
 * DESIGN-UI.md → Days): the `ui.landing` role, which core owns and days
 * replaces through its manifest, asked once per page load and only while the
 * page stands, unmoved, at the root with nothing in its URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { definePlugin } from "@kb/plugin";
import {
  getPath,
  land,
  landOnce,
  LandingService,
  navigate,
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

/** A days landing that counts its calls and answers `id`. */
function counted(id: string) {
  const calls = { n: 0 };
  const answer: Landing = () => {
    calls.n += 1;
    return Promise.resolve(id);
  };
  return { calls, answer };
}

describe("ui.landing", () => {
  it("with only core's default, a page at the root stays home", async () => {
    syncPagePlugins([]);
    await land();
    expect(getPath()).toBe("/");
  });

  it("days, elected over core, opens today's node in place of the root", async () => {
    syncPagePlugins([daysLanding(() => Promise.resolve("days.2026-11-11"))]);
    const depth = window.history.length;
    await land();
    expect(getPath()).toBe("/node/days.2026-11-11");
    expect(window.history.length).toBe(depth);
  });

  it("a page that loads anywhere but the root, or with a query, is not asked", async () => {
    const { calls, answer } = counted("days.2026-11-11");
    syncPagePlugins([daysLanding(answer)]);
    window.history.replaceState({}, "", "/settings");
    await land();
    expect(getPath()).toBe("/settings");
    window.history.replaceState({}, "", "/?q=x");
    await land();
    expect(getPath()).toBe("/");
    expect(calls.n).toBe(0);
  });

  it("a person who moves while the answer is pending stays where they went", async () => {
    const pending = Promise.withResolvers<string>();
    syncPagePlugins([daysLanding(() => pending.promise)]);
    const landing = land();
    await Promise.resolve();
    navigate("/settings");
    pending.resolve("days.2026-11-11");
    await landing;
    expect(getPath()).toBe("/settings");
  });

  it("is asked once per page load: days switched on later, or reloaded, never moves the page", async () => {
    syncPagePlugins([]);
    await landOnce();
    expect(getPath()).toBe("/");
    const { calls, answer } = counted("days.2026-11-11");
    syncPagePlugins([daysLanding(answer)]);
    await landOnce();
    syncPagePlugins([]);
    syncPagePlugins([daysLanding(answer)]);
    await landOnce();
    expect(getPath()).toBe("/");
    expect(calls.n).toBe(0);
  });
});
