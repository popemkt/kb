/**
 * Following a date (DESIGN.md → Provider roles): core's declaration owns
 * `ui.date-target`, and its default leads nowhere; the days declaration's
 * manifest claims a replacement at 50 that answers the date's day, so a
 * followed date opens its day with days loaded, nothing happens without
 * it, and a days failure falls back to core's nowhere.
 */
import { Effect } from "effect";
import { afterAll, describe, expect, it, vi } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { coreExtension } from "@kb/operations";
import { definePlugin, makeKernel, Role, roleCall, type Kernel } from "@kb/plugin";
import { DateTargetService, leadsNowhere, syncUiPlugins, type DateTarget } from "@kb/ui-sdk";
import { followFrom } from "@/stores/follow";
import { syncPagePlugins } from "@/test-support/page-plugins";

const role = Role(DateTargetService);

function provider(name: string, answer: DateTarget) {
  return definePlugin({ name, apply: (ctx) => ctx.provide(DateTargetService, answer) });
}

const days = (answer: DateTarget) => bundledPlugin(daysExtension, provider("days", answer));

function kernelWith(answer: DateTarget | null): Kernel {
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(kernel.load(bundledPlugin(coreExtension, provider("core", leadsNowhere))));
  if (answer !== null) Effect.runSync(kernel.load(days(answer)));
  return kernel;
}

const ask = (kernel: Kernel, date: string) =>
  Effect.runPromise(roleCall(kernel, role, (target) => Effect.promise(() => target(date)), 1_000));

const dayOf: DateTarget = (date) => Promise.resolve(`days.${date}`);

describe("ui.date-target", () => {
  it("core's default leads nowhere when no family replaces it", async () => {
    const kernel = kernelWith(null);
    expect(await ask(kernel, "2026-11-12")).toBeNull();
    expect(kernel.roles().find((r) => r.role === role.name)?.elected).toBe("core");
  });

  it("days' manifest claim is elected over core's default, and answers the date's day", async () => {
    const kernel = kernelWith(dayOf);
    expect(await ask(kernel, "2026-11-12")).toBe("days.2026-11-12");
    expect(kernel.roles().find((r) => r.role === role.name)?.elected).toBe("days");
  });

  it("a failing days provider is demoted and core's default answers", async () => {
    const kernel = kernelWith(() => Promise.reject(new Error("refused")));
    expect(await ask(kernel, "2026-11-12")).toBeNull();
  });
});

/** Follow `date` as a plain click does, let the role answer, and say what was opened. */
async function follow(date: string): Promise<readonly unknown[][]> {
  const open = vi.fn();
  followFrom({ pane: "main", open }, { kind: "date", date }, "open");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return open.mock.calls;
}

describe("following a date", () => {
  afterAll(() => syncUiPlugins([]));

  it("opens the day the page's date target answers", async () => {
    syncPagePlugins([days(dayOf)]);
    expect(await follow("2026-11-12")).toEqual([["days.2026-11-12"]]);
  });

  it("does nothing where a date leads nowhere", async () => {
    syncPagePlugins([]);
    expect(await follow("2026-11-12")).toEqual([]);
  });
});
