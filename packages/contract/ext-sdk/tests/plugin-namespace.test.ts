import { expect, test } from "bun:test";
import { Effect, Exit, Result } from "effect";
import { makeKernel, PointName, type PluginContext } from "@kb/plugin";
import { EXTENSION_SDK, TxAfterPoint, onCommit } from "@kb/contracts";
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

test("only the host's trusted manifest binds a replacement claim to a decoded module", () => {
  const entry = { name: "sample", apply: () => Effect.void };
  const ordinary = decodeExtensionPlugin(entry, "sample");
  const approved = decodeExtensionPlugin(entry, "sample", {
    digest: "trusted-code",
    manifest: {
      replaces: [{ role: "ui.field-editor", why: "rows", priority: 30 }],
    },
  });
  if (Result.isFailure(ordinary) || Result.isFailure(approved)) throw new Error("decoded plugins");
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(kernel.load(ordinary.success));
  expect(kernel.replacementApproved("sample", "ui.field-editor")).toBe(false);
  Effect.runSync(kernel.unload("sample"));
  Effect.runSync(kernel.load(approved.success));
  expect(kernel.replacementApproved("sample", "ui.field-editor")).toBe(true);
  expect(kernel.replacementApproved("sample", "ui.host")).toBe(false);
  Effect.runSync(kernel.shutdown);
});

test("manifest point dependencies bind only the half that needs them and wait for later owners", () => {
  const point = "ext.owner.sources";
  const plugin = {
    name: "consumer",
    apply: (ctx: PluginContext) =>
      Effect.gen(function* () {
        const key = yield* ctx.point<string>(point);
        yield* ctx.contribute(key, { id: "source", value: "arrived" });
      }),
  };
  const decoded = decodeExtensionPlugin(plugin, "consumer", {
    digest: "consumer-code",
    manifest: { uses: [{ point, kernel: "registry" }] },
  });
  if (Result.isFailure(decoded)) throw new Error(decoded.failure);
  const kernel = makeKernel({ host: "registry" });
  Effect.runSync(kernel.load(decoded.success));
  expect(kernel.plugins().find(({ name }) => name === "consumer")?.status).toBe("pending");
  Effect.runSync(
    kernel.load({
      name: "owner",
      namespace: "ext.owner",
      apply: (ctx) =>
        ctx
          .declare<string>("sources", {
            cardinality: "list",
            combine: "all",
            kernel: "registry",
            tier: "T0",
          })
          .pipe(Effect.asVoid),
    }),
  );
  expect(kernel.contributions(PointName<string>()(point)).map(({ value }) => value)).toEqual([
    "arrived",
  ]);
  Effect.runSync(kernel.unload("owner"));
  expect(kernel.plugins().find(({ name }) => name === "consumer")?.status).toBe("pending");
  Effect.runSync(kernel.shutdown);

  const page = decodeExtensionPlugin({ name: "consumer", apply: () => Effect.void }, "consumer", {
    digest: "consumer-code",
    manifest: { uses: [{ point, kernel: "registry" }] },
  });
  if (Result.isFailure(page)) throw new Error(page.failure);
  const browser = makeKernel({ host: "page" });
  Effect.runSync(browser.load(page.success));
  expect(browser.plugins()[0]?.status).toBe("active");
  Effect.runSync(browser.shutdown);
});

test("manifest point-use bounds apply to descendants", () => {
  const entry = {
    name: "consumer",
    apply: (ctx: PluginContext) =>
      ctx
        .plugin({ name: "child", uses: ["ext.unlisted.sources"], apply: () => Effect.void })
        .pipe(Effect.asVoid),
  };
  const decoded = decodeExtensionPlugin(entry, "consumer", {
    digest: "code",
    manifest: { uses: [] },
  });
  if (Result.isFailure(decoded)) throw new Error(decoded.failure);
  const kernel = makeKernel({ host: "registry" });
  expect(Exit.isFailure(Effect.runSyncExit(kernel.load(decoded.success)))).toBe(true);
  expect(kernel.plugins()[0]?.status).toBe("failed");
  expect(kernel.plugins()[0]?.error?.message).toContain("not declared in the manifest's uses");
  expect(kernel.plugins().some(({ name }) => name === "consumer/child")).toBe(false);
  Effect.runSync(kernel.shutdown);
});

test("manifest reaction matches constrain descendants and freeze admitted matches", () => {
  for (const declared of [false, true]) {
    const match = { tagged: ["tag.inbox"] };
    const entry = {
      name: "router",
      apply: (ctx: PluginContext) =>
        ctx
          .plugin({
            name: "child",
            apply: (child) => onCommit(child, declared ? match : {}, () => Effect.void),
          })
          .pipe(Effect.asVoid),
    };
    const decoded = decodeExtensionPlugin(entry, "router", {
      digest: "code",
      manifest: { reacts: [match] },
    });
    if (Result.isFailure(decoded)) throw new Error(decoded.failure);
    const kernel = makeKernel({ host: "registry" });
    const loaded = Effect.runSyncExit(kernel.load(decoded.success));
    expect(Exit.isSuccess(loaded)).toBe(declared);
    const reactions = kernel.contributions(TxAfterPoint);
    if (declared) {
      match.tagged.push("tag.everything");
      expect(reactions[0]?.value.match).toEqual({ tagged: ["tag.inbox"] });
      expect(Object.isFrozen(reactions[0]?.value.match)).toBe(true);
    } else {
      expect(
        kernel
          .plugins()
          .map(({ error }) => error?.message)
          .join(" "),
      ).toContain("not declared in the manifest's reacts");
      expect(reactions).toEqual([]);
    }
    Effect.runSync(kernel.shutdown);
  }
});

test("an own declared point stays within authority, including dotted family names", () => {
  const own = "ext.consumer.sources";
  const decoded = decodeExtensionPlugin(
    {
      name: "consumer",
      apply: (ctx: PluginContext) =>
        Effect.gen(function* () {
          yield* ctx.declare("sources", {
            cardinality: "list",
            combine: "all",
            kernel: "registry",
            tier: "T0",
          });
          yield* ctx.plugin({
            name: "own",
            uses: [own],
            apply: (child) =>
              Effect.gen(function* () {
                yield* child.contribute(yield* child.point<string>(own), {
                  id: "own",
                  value: "own",
                });
              }),
          });
        }),
    },
    "consumer",
    { digest: "code", manifest: { uses: [] } },
  );
  if (Result.isFailure(decoded)) throw new Error(decoded.failure);
  const kernel = makeKernel({ host: "registry" });
  Effect.runSync(kernel.load(decoded.success));
  expect(kernel.plugins().every(({ status }) => status === "active")).toBe(true);
  expect(kernel.contributions(PointName<string>()(own)).map(({ value }) => value)).toEqual(["own"]);
  Effect.runSync(kernel.shutdown);
  const stranger = decodeExtensionPlugin(
    { name: "consumer", uses: ["ext.consumer.stranger.sources"], apply: () => Effect.void },
    "consumer",
    { digest: "code", manifest: { uses: [] } },
  );
  if (Result.isFailure(stranger)) throw new Error(stranger.failure);
  const other = makeKernel({ host: "registry" });
  expect(() => Effect.runSync(other.load(stranger.success))).toThrow(
    "not declared in the manifest",
  );
  Effect.runSync(other.shutdown);
});
