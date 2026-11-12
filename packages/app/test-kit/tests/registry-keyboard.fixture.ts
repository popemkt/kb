/** Actual registry key data for the page/registry contract; Bun stays behind this process boundary. */
import { Effect } from "effect";
import { KeyContextPoint, KeybindingPoint } from "@kb/contracts";
import { bunFileSystemLayer, sessionRegistry, invoke } from "@kb/runtime";
import { openSession, scratchRoot } from "../src/store-session.ts";

const catalog = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* scratchRoot;
      const context = yield* openSession(root);
      const registry = yield* sessionRegistry(context).pipe(Effect.provide(bunFileSystemLayer));
      const result = {
        contexts: registry.kernel.contributions(KeyContextPoint),
        bindings: registry.kernel.contributions(KeybindingPoint),
      };
      const cycles = [];
      for (const name of ["canvas", "outline", "days"]) {
        const offReceipt = yield* Effect.promise(() =>
          invoke(context, { id: "extension.switch", input: { name, on: false } }),
        );
        const off = yield* sessionRegistry(context).pipe(Effect.provide(bunFileSystemLayer));
        const offBindings = off.kernel.contributions(KeybindingPoint);
        const onReceipt = yield* Effect.promise(() =>
          invoke(context, { id: "extension.switch", input: { name, on: true } }),
        );
        const on = yield* sessionRegistry(context).pipe(Effect.provide(bunFileSystemLayer));
        cycles.push({
          name,
          offStatus: offReceipt.status,
          onStatus: onReceipt.status,
          off: offBindings,
          on: on.kernel.contributions(KeybindingPoint),
        });
      }
      const current = yield* sessionRegistry(context).pipe(Effect.provide(bunFileSystemLayer));
      yield* current.kernel.shutdown;
      return { ...result, cycles };
    }),
  ),
);
process.stdout.write(JSON.stringify(catalog));
