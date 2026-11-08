import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { makeKernel, type PluginContext } from "@kb/plugin";
import { EXTENSION_SDK } from "@kb/contracts";
import { decodeExtensionPlugin } from "../src/module.ts";

test("the host refuses a stranger's namespace before it can run", () => {
  const decoded = decodeExtensionPlugin(
    { name: "stranger", namespace: "graph", apply: () => Effect.void },
    "stranger",
  );
  expect(Result.isFailure(decoded)).toBe(true);
  if (Result.isFailure(decoded)) expect(decoded.failure).toContain("ext.stranger");
});
test("the host binds declaration authority while preserving contribution ids", () => {
  let contributionNamespace = "";
  const decoded = decodeExtensionPlugin(
    {
      name: "stranger",
      apply: (ctx: PluginContext) => {
        contributionNamespace = ctx.namespace;
        return ctx
          .declare("values", {
            cardinality: "list",
            combine: "all",
            kernel: "registry",
            tier: "T0",
          })
          .pipe(Effect.asVoid);
      },
    },
    "stranger",
  );
  expect(Result.isSuccess(decoded)).toBe(true);
  if (Result.isSuccess(decoded)) {
    const kernel = makeKernel({ host: "registry" });
    Effect.runSync(kernel.load(decoded.success));
    expect(contributionNamespace).toBe("stranger");
    expect(kernel.points()[0]?.key.name).toBe("ext.stranger.values");
    Effect.runSync(kernel.shutdown);
  }
});
test("the extension SDK does not serve a point constructor", () => {
  expect(Object.hasOwn(EXTENSION_SDK, "Point")).toBe(false);
});
