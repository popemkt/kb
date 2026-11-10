/**
 * The capture target as an elected role (DESIGN.md → Provider roles): core's
 * declaration owns `ui.capture-target` and its default answers the top
 * level; the days declaration's manifest claims a replacement at 50, so
 * days answers when it is loaded, a days failure falls back to core, and
 * choosing core on the role node elects it over days.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { coreExtension } from "@kb/operations";
import { definePlugin, makeKernel, Role, roleCall, type Kernel } from "@kb/plugin";
import { CaptureTargetService, topLevelCapture, type CaptureTarget } from "@kb/ui-sdk";

const role = Role(CaptureTargetService);

function provider(name: string, answer: CaptureTarget) {
  return definePlugin({ name, apply: (ctx) => ctx.provide(CaptureTargetService, answer) });
}

function kernelWith(days: CaptureTarget | null): Kernel {
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(kernel.load(bundledPlugin(coreExtension, provider("core", topLevelCapture))));
  if (days !== null)
    Effect.runSync(kernel.load(bundledPlugin(daysExtension, provider("days", days))));
  return kernel;
}

const ask = (kernel: Kernel) =>
  Effect.runPromise(roleCall(kernel, role, (target) => Effect.promise(target), 1_000));

describe("ui.capture-target", () => {
  it("core's default answers the top level when no family replaces it", async () => {
    const kernel = kernelWith(null);
    expect(await ask(kernel)).toBeNull();
    expect(kernel.roles().find((r) => r.role === role.name)?.elected).toBe("core");
  });

  it("days' manifest claim is elected over core's default", async () => {
    const kernel = kernelWith(() => Promise.resolve("days.2026-11-11"));
    expect(await ask(kernel)).toBe("days.2026-11-11");
    expect(kernel.roles().find((r) => r.role === role.name)?.elected).toBe("days");
  });

  it("a failing days provider is demoted and core's default answers", async () => {
    const kernel = kernelWith(() => Promise.reject(new Error("refused")));
    expect(await ask(kernel)).toBeNull();
  });

  it("choosing core on the role node elects core over days", async () => {
    const kernel = kernelWith(() => Promise.resolve("days.2026-11-11"));
    Effect.runSync(kernel.configureRoles(new Map([[role.name, "core"]])));
    expect(await ask(kernel)).toBeNull();
  });
});
