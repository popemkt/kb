import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { makeKernel, Point, Service, type PluginContext } from "../src/index.ts";

const run = Effect.runSync;

test("a retired activation cannot register through its captured context", () => {
  const kernel = makeKernel({ host: "registry" });
  const service = Service<string>()("activation.source");
  const point = Point<string>()("activation.output", {
    cardinality: "list",
    combine: "all",
    kernel: "registry",
    tier: "T0",
  });
  let previous: PluginContext | undefined;
  run(kernel.load({ name: "source", apply: (ctx) => ctx.provide(service, "first") }));
  run(
    kernel.load({
      name: "consumer",
      inject: [service],
      apply: (ctx) =>
        Effect.sync(() => {
          previous ??= ctx;
        }),
    }),
  );
  run(kernel.unload("source"));
  run(kernel.load({ name: "source", apply: (ctx) => ctx.provide(service, "second") }));
  if (previous === undefined) throw new Error("captured activation");
  expect(
    Exit.isFailure(run(Effect.exit(previous.contribute(point, { id: "stale", value: "bad" })))),
  ).toBe(true);
  expect(Exit.isFailure(run(Effect.exit(previous.get(service))))).toBe(true);
  expect(
    Exit.isFailure(run(Effect.exit(previous.plugin({ name: "stale", apply: () => Effect.void })))),
  ).toBe(true);
  expect(kernel.contributions(point)).toEqual([]);
  expect(kernel.plugins().some(({ name }) => name === "consumer/stale")).toBe(false);
  run(kernel.shutdown);
});

test("a handle belongs to its loaded entry rather than a later namesake", () => {
  const kernel = makeKernel({ host: "registry" });
  const stale = run(kernel.load({ name: "same", apply: () => Effect.void }));
  run(stale.unload);
  run(kernel.load({ name: "same", apply: () => Effect.void }));
  run(stale.unload);
  expect(kernel.plugins().map(({ name }) => name)).toEqual(["same"]);
  run(kernel.shutdown);
});
