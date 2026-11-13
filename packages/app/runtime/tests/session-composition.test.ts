/** A seed can change files; one invocation still uses one schema/registry snapshot. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { ExtensionStorage } from "@kb/contracts";
import { extensionStorageLayer } from "@kb/workspace-fs";
import { extensionModule, writeTrustedExtension } from "@kb/test-kit";
import { openKb, bunFileSystemLayer, sessionRegistry, resetRegistryCache } from "../src/index.ts";

test("a lock changed while seeding takes effect on the next composition, never with the previous schema", async () => {
  const at = await mkdtemp(join(tmpdir(), "kb-composition-snapshot-"));
  const root = join(at, "root");
  const before = join(at, "before");
  const after = join(at, "after");
  const beta = join(root, "beta");
  const actions = `[{id:"version",title:"Version",description:"Synthetic",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>1}]`;
  const withSelection = (dir: string) =>
    Effect.runPromise(
      Effect.flatMap(ExtensionStorage, (storage) =>
        storage.mutate((tx) =>
          tx.update(root, "local", (held) => ({
            ...held,
            links: [join(dir, ".kb", "extensions")],
          })),
        ),
      ).pipe(Effect.provide(extensionStorageLayer.pipe(Layer.provide(bunFileSystemLayer)))),
    );
  try {
    await writeTrustedExtension(before, "alpha.ts", extensionModule("alpha", { actions }));
    await writeTrustedExtension(
      beta,
      "beta.ts",
      extensionModule("beta", {
        declaration: `{name:"beta",label:"Beta",seed:at=>[{id:"beta.seed",text:"Synthetic",props:{},children:[],createdAt:at,updatedAt:at}]}`,
        actions,
      }),
    );
    const lock = JSON.stringify({
      version: 1,
      extensions: {},
      marketplaces: {},
      links: ["beta/.kb/extensions"],
    });
    await writeTrustedExtension(
      after,
      "alpha.ts",
      extensionModule("alpha", {
        prelude: `import {writeFileSync} from "node:fs";`,
        declaration: `{name:"alpha",label:"Alpha",seed:at=>{writeFileSync(${JSON.stringify(join(root, ".kb", "extensions.lock.json"))},${JSON.stringify(lock)});return [];}}`,
        actions,
      }),
    );
    await withSelection(before);
    const ctx = await openKb(root);
    await withSelection(after);
    const first = await Effect.runPromise(
      sessionRegistry(ctx).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(first.manifestEntries().some((action) => action.id === "ext.beta.version")).toBe(false);
    expect(ctx.index.getNode("beta.seed")).toBeUndefined();
    const next = await Effect.runPromise(
      sessionRegistry(ctx).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(next.manifestEntries().some((action) => action.id === "ext.beta.version")).toBe(true);
    expect(ctx.index.getNode("beta.seed")).toBeDefined();
  } finally {
    resetRegistryCache();
    await rm(at, { recursive: true, force: true });
  }
});
