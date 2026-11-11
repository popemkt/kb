/** One source-inspection contract for every host of the plugin kernel. */
import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  bindPluginAuthority,
  definePlugin,
  KERNEL_HOSTS,
  makeKernel,
  Service,
  type Plugin,
} from "../src/index.ts";

const run = Effect.runSync;
const DIGEST = `sha256:${"a".repeat(64)}`;
const CHANGED = `sha256:${"b".repeat(64)}`;

function extension(plugin: Plugin, digest: string): Plugin {
  return bindPluginAuthority(plugin, {
    source: "extension",
    pointNamespace: "ext.source",
    digest,
    replacements: [],
    defaults: [],
  });
}

for (const host of KERNEL_HOSTS) {
  describe(`${host} provenance`, () => {
    test("inherits the host binding across children and differing namespaces", () => {
      const kernel = makeKernel({ host });
      const child = extension(
        definePlugin({
          name: "child",
          namespace: "unrelated.prefix",
          apply: (ctx) => ctx.plugin(definePlugin({ name: "leaf", apply: () => Effect.void })),
        }),
        CHANGED,
      );
      const root = extension(
        definePlugin({ name: "source", apply: (ctx) => ctx.plugin(child) }),
        DIGEST,
      );
      run(kernel.load(root));
      for (const owner of ["source", "source/child", "source/child/leaf"])
        expect(kernel.provenance(owner)).toEqual({
          root: "source",
          source: "extension",
          digest: DIGEST,
        });
      expect(kernel.provenance("unrelated.prefix")).toBeUndefined();
      expect(kernel.provenance("source/not-loaded")).toBeUndefined();
      const reading = kernel.provenance("source/child");
      if (reading === undefined) throw new Error("Expected active provenance");
      Object.assign(reading, { digest: "forged" });
      expect(kernel.provenance("source/child")?.digest).toBe(DIGEST);
      run(kernel.shutdown);
      expect(kernel.provenance("source")).toBeUndefined();
      expect(kernel.provenance("source/child/leaf")).toBeUndefined();
    });

    test("ordinary plugin fields cannot forge a code origin or digest", () => {
      const kernel = makeKernel({ host });
      const forged = {
        ...definePlugin({ name: "ordinary", apply: () => Effect.void }),
        source: "extension",
        digest: DIGEST,
        owner: "trusted",
      };
      run(kernel.load(forged));
      expect(kernel.provenance("ordinary")).toEqual({ root: "ordinary", source: "bundled" });
      expect(kernel.provenance("trusted")).toBeUndefined();
      run(kernel.shutdown);
    });

    test("withdraws on pending/closing and re-reads replacement loads", () => {
      const kernel = makeKernel({ host });
      const Ready = Service<boolean>()("provenance.ready");
      let duringApply: ReturnType<typeof kernel.provenance>;
      let duringClose: ReturnType<typeof kernel.provenance> = {
        root: "sentinel",
        source: "bundled",
      };
      const provider = definePlugin({ name: "ready", apply: (ctx) => ctx.provide(Ready, true) });
      const root = extension(
        definePlugin({
          name: "source",
          inject: [Ready],
          apply: (ctx) =>
            Effect.gen(function* () {
              duringApply = kernel.provenance(ctx.name);
              yield* ctx.plugin(definePlugin({ name: "child", apply: () => Effect.void }));
              yield* Effect.acquireRelease(Effect.void, () =>
                Effect.sync(() => {
                  duringClose = kernel.provenance(ctx.name);
                }),
              );
            }),
        }),
        DIGEST,
      );
      run(kernel.load(root));
      expect(kernel.provenance("source")).toBeUndefined();
      run(kernel.load(provider));
      expect(duringApply).toBeUndefined();
      expect(kernel.provenance("source/child")?.digest).toBe(DIGEST);
      run(kernel.unload("ready"));
      expect(duringClose).toBeUndefined();
      expect(kernel.provenance("source")).toBeUndefined();
      expect(kernel.provenance("source/child")).toBeUndefined();
      run(kernel.load(provider));
      expect(kernel.provenance("source/child")?.digest).toBe(DIGEST);
      run(kernel.unload("source"));
      run(
        kernel.load(extension(definePlugin({ name: "source", apply: () => Effect.void }), CHANGED)),
      );
      expect(kernel.provenance("source")?.digest).toBe(CHANGED);
      expect(kernel.provenance("source/child")).toBeUndefined();
      run(kernel.shutdown);
    });

    test("a failed activation never authenticates its partially applied children", () => {
      const kernel = makeKernel({ host });
      const root = extension(
        definePlugin({
          name: "broken",
          apply: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.plugin(definePlugin({ name: "child", apply: () => Effect.void }));
              return yield* Effect.die(new Error("broken"));
            }),
        }),
        DIGEST,
      );
      expect(Exit.isFailure(run(Effect.exit(kernel.load(root))))).toBe(true);
      expect(kernel.provenance("broken")).toBeUndefined();
      expect(kernel.provenance("broken/child")).toBeUndefined();
      run(kernel.shutdown);
    });
  });
}
