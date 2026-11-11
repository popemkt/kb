import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { ActionPoint, ProcedurePoint } from "@kb/contracts";
import { domainError } from "@kb/model";
import { definePlugin, makeKernel } from "@kb/plugin";
import { kbRuntimeLayer, openKbEffect, bunFileSystemLayer } from "@kb/runtime";
import { walk } from "../src/procedures.ts";

for (const mode of ["failure", "stalled", "wrong-action"] as const) {
  test(`CLI walk stops once for ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-procedure-cli-"));
    let calls = 0;
    try {
      const plugin = definePlugin({
        name: "probe",
        namespace: "probe",
        apply: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.contribute(ActionPoint, {
              id: "check",
              value: {
                title: "Check",
                description: "Never done",
                mode: { kind: "read" },
                inputSchema: z.object({}),
                outputSchema: z.object({ done: z.boolean() }),
                effect: () => Effect.succeed({ done: false }),
              },
            });
            yield* ctx.contribute(ActionPoint, {
              id: "run",
              value: {
                title: "Run",
                description: "Count execution",
                mode: { kind: "write" },
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                effect: Effect.fn("probe.run")(function* () {
                  calls++;
                  if (mode === "failure" || calls > 1)
                    return yield* domainError("invalid_input", "probe failed");
                  return {};
                }),
              },
            });
            yield* ctx.contribute(ProcedurePoint, {
              id: "walk",
              value: {
                title: "Probe",
                steps: [
                  {
                    id: "one",
                    title: "One",
                    actions: [
                      { id: "run", title: "Run", call: { action: "probe.run", input: {} } },
                    ],
                    check: { action: "probe.check", input: {} },
                  },
                ],
              },
            });
          }),
      });
      const code = await Effect.runPromise(
        Effect.gen(function* () {
          const ctx = yield* openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer));
          const kernel = makeKernel({ host: "server" });
          yield* kernel.load(plugin);
          return yield* walk(ctx, {}, "probe.walk", {
            yes: true,
            once: false,
            action: mode === "wrong-action" ? "rollback" : undefined,
          }).pipe(
            Effect.provide(kbRuntimeLayer(ctx, undefined, { kernel, rows: Effect.succeed([]) })),
          );
        }),
      );
      expect(code).toBe(1);
      expect(calls).toBe(mode === "wrong-action" ? 0 : 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
