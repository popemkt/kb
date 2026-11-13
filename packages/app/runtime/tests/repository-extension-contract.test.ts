/**
 * A repository extension is a family like a bundled one: a module in
 * `.kb/extensions` that exports its declaration keeps the one extension
 * contract, the registry its host, over a root that holds it. Its node, its
 * switch and its setting are that store's nodes, seeded from its
 * declaration.
 */
import { beforeEach, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BACKDROP_OPTIONS, backdropOptionId } from "@kb/appearance";
import { FIELD_TYPE_OPTION_IDS, SYSTEM_IDS, extensionNodeId } from "@kb/model";
import {
  extensionContract,
  extensionModule,
  writeExtension,
  writeTrustedExtension,
  trustExtension,
  type SwitchingHost,
} from "@kb/test-kit";
import { rootFamilies } from "../src/families.ts";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

const SETTING = "sys.f.fixture.greeting";

/** The fixture: an optional family with one setting on its node and one template. */
const FIXTURE = extensionModule("fixture", {
  declaration: `{
  name: "fixture",
  label: "Fixture",
  optional: { byDefault: "on" },
  seed: (at) => [
    {
      id: ${JSON.stringify(SETTING)},
      text: "greeting",
      props: {
        ${JSON.stringify(SYSTEM_IDS.typeField)}: [{ t: "ref", v: ${JSON.stringify(SYSTEM_IDS.field)} }],
        ${JSON.stringify(SYSTEM_IDS.fieldTypeField)}: [{ t: "ref", v: ${JSON.stringify(FIELD_TYPE_OPTION_IDS.text)} }],
        ${JSON.stringify(SYSTEM_IDS.configuresField)}: [{ t: "ref", v: ${JSON.stringify(extensionNodeId("fixture"))} }],
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    },
  ],
}`,
  templates: `[{ id: "hello", template: () => "hello" }]`,
});

/** A module named `name` declaring one backdrop, `id`, with the knobs `knobs`. */
const declaring = (name: string, id: string, knobs = "[]") =>
  extensionModule(name, {
    declaration: `{ name: ${JSON.stringify(name)}, label: "Mine", declaredOptions: [{ kind: ${JSON.stringify(BACKDROP_OPTIONS)}, options: [{ id: ${JSON.stringify(id)}, label: "Mine", knobs: ${knobs} }] }] }`,
  });

/** A fresh root whose `.kb/extensions` holds `modules`, by file name, each trusted here. */
async function rootWith(modules: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
  for (const [file, text] of Object.entries(modules)) {
    await writeTrustedExtension(root, file, text);
  }
  return root;
}

const FIXTURE_ROOT = await rootWith({ "fixture.ts": FIXTURE });
afterAll(() => rm(FIXTURE_ROOT, { recursive: true, force: true }));

const discovered = await Effect.runPromise(
  rootFamilies(FIXTURE_ROOT).pipe(Effect.provide(bunFileSystemLayer)),
);
const fixture = discovered.families.find(({ declaration }) => declaration.name === "fixture");
if (fixture === undefined)
  throw new Error(`the fixture was not discovered: ${JSON.stringify(discovered.failures)}`);

/** The registry over a root that holds the fixture, as its host. */
const repositoryHost: SwitchingHost = {
  source: "registry",
  root: Effect.acquireRelease(
    Effect.promise(() => rootWith({ "fixture.ts": FIXTURE })),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  ),
  compose: (nodeOf) =>
    registryFor(FIXTURE_ROOT, nodeOf).pipe(
      Effect.map(({ families, kernel }) => ({
        row: families.find((family) => family.name === "fixture"),
        kernel,
      })),
      Effect.provide(bunFileSystemLayer),
    ),
};

const MANIFEST = { description: "Greets", author: "Ada", capabilities: { page: "none" } };
const inventoryOf = async (root: string) =>
  Effect.runPromise(rootFamilies(root).pipe(Effect.provide(bunFileSystemLayer)));
/** A root holding `hello`, untrusted, with `manifest` beside it when it is not null. */
async function untrusted(manifest: string | null): Promise<string> {
  resetRegistryCache();
  const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
  await writeExtension(root, "hello.ts", extensionModule("hello"));
  if (manifest !== null)
    await writeFile(join(root, ".kb", "extensions", "hello.manifest.json"), manifest);
  return root;
}

describe("trusted repository fixture contract", () => {
  beforeEach(async () => {
    await trustExtension(FIXTURE_ROOT, "fixture.ts");
  });
  extensionContract(fixture.declaration, fixture.entry, repositoryHost);
});

describe("a repository extension's node", () => {
  test("is its store's: seeded with its setting, switched and configured like a bundled family's", async () => {
    const root = await rootWith({ "fixture.ts": FIXTURE });
    try {
      const ctx = await openKb(root);
      const node = ctx.index.getNode(extensionNodeId("fixture"));
      expect(node).toMatchObject({ text: "Fixture", props: {} });
      expect(ctx.index.getNode(SYSTEM_IDS.extensionsRoot)?.children).toContain(node?.id);
      // Its setting is written on its node like any field, though the node is `sys.*`.
      const set = await invoke(ctx, {
        id: "node.update",
        input: {
          id: extensionNodeId("fixture"),
          setProps: [{ field: SETTING, value: { t: "str", v: "hi" } }],
        },
      });
      expect(set.status).toBe("succeeded");
      const off = await invoke(ctx, {
        id: "extension.switch",
        input: { name: "fixture", on: false },
      });
      expect(off.status).toBe("succeeded");
      expect(ctx.index.getNode(extensionNodeId("fixture"))?.props).toEqual({
        [SETTING]: [{ t: "str", v: "hi" }],
        [SYSTEM_IDS.extensionEnabledField]: [{ t: "bool", v: false }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module no one trusted here seeds nothing of its declaration: only its own node, by its name, empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
    try {
      await writeExtension(root, "fixture.ts", FIXTURE);
      const ctx = await openKb(root);
      // Its label is its declaration's, which no one has read: the node is named by its file.
      expect(ctx.index.getNode(extensionNodeId("fixture"))).toMatchObject({
        text: "fixture",
        props: {},
      });
      expect(ctx.index.getNode(SETTING)).toBeUndefined();
      // Trusted, its declaration seeds the rest; the node keeps its text, as every seeded node does.
      await trustExtension(root, "fixture.ts");
      resetRegistryCache();
      const reopened = await openKb(root);
      expect(reopened.index.getNode(extensionNodeId("fixture"))?.text).toBe("fixture");
      expect(reopened.index.getNode(SETTING)).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module that claims what core holds is refused as a unit, and core's stays core's", async () => {
    resetRegistryCache();
    const root = await rootWith({
      "claims.ts": extensionModule("claims", {
        actions: `[
  {
    id: "own",
    title: "Own",
    description: "an action of its own, refused with the plugin",
    mode: { kind: "read" },
    inputSchema: { parse: (input) => input },
    outputSchema: { parse: (output) => output },
    handler: async () => ({}),
  },
  {
    id: "add",
    aliases: ["node.add"],
    title: "Add",
    description: "claims core's node.add",
    mode: { kind: "write" },
    inputSchema: { parse: (input) => input },
    outputSchema: { parse: (output) => output },
    handler: async () => ({ replaced: true }),
  },
]`,
      }),
    });
    try {
      const registry = await Effect.runPromise(
        registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(registry.failures).toEqual([
        {
          file: join(root, ".kb", "extensions", "claims.ts"),
          error: expect.stringContaining("node.add"),
        },
      ]);
      expect(registry.byId.get("node.add")?.source).toBe("core");
      expect(registry.byId.has("ext.claims.own")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module that declares itself required is refused: only kb's build is required", async () => {
    resetRegistryCache();
    const root = await rootWith({
      "keeper.ts": extensionModule("keeper", {
        declaration: '{ name: "keeper", label: "Keeper", required: "it says so" }',
      }),
    });
    try {
      const { families, failures } = await Effect.runPromise(
        rootFamilies(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(families.filter(({ source }) => source !== "bundled")).toEqual([]);
      expect(failures).toContainEqual({
        file: "keeper.ts",
        error: expect.stringContaining("can always be switched off"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe("what it says about itself, its manifest", () => {
    test("is read before anyone trusts the code, and its bytes are in the digest", async () => {
      const bare = await untrusted(null);
      const said = await untrusted(JSON.stringify(MANIFEST));
      try {
        const plain = (await inventoryOf(bare)).inventory.find(({ name }) => name === "hello");
        const row = (await inventoryOf(said)).inventory.find(({ name }) => name === "hello");
        expect(row).toMatchObject({ trusted: false, manifest: MANIFEST });
        expect(row?.reach?.files.map(({ path }) => path)).toContain("hello.manifest.json");
        expect(plain?.manifest).toBeUndefined();
        expect(row?.digest).not.toBe(plain?.digest);
      } finally {
        await rm(bare, { recursive: true, force: true });
        await rm(said, { recursive: true, force: true });
      }
    });

    test.each([
      ["not JSON", "{ description: nope", "is not JSON"],
      ["a field it does not know", '{"licence":"MIT"}', "does not match the manifest's shape"],
      [
        "a page tier its files contradict",
        '{"capabilities":{"page":"full"}}',
        "page tier is full, but it ships no page half",
      ],
    ])("with %s, refuses the extension and says why", async (_case, manifest, why) => {
      const root = await untrusted(manifest);
      try {
        const { inventory, failures } = await inventoryOf(root);
        expect(inventory.find(({ name }) => name === "hello")?.digest).toBeUndefined();
        expect(failures).toContainEqual({
          file: expect.stringContaining("hello.ts"),
          error: expect.stringContaining(why),
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("a manifest with no extension beside it is a failure, not a file nobody read", async () => {
      resetRegistryCache();
      const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
      try {
        await writeExtension(root, "hello.ts", extensionModule("hello"));
        await writeFile(join(root, ".kb", "extensions", "stray.manifest.json"), "{}");
        const { failures } = await inventoryOf(root);
        expect(failures).toContainEqual({
          file: expect.stringContaining("stray.manifest.json"),
          error: expect.stringContaining("which has no stray.ts"),
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("trusted, the extension loads with it, and its row reports it", async () => {
      resetRegistryCache();
      const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
      try {
        await writeExtension(root, "hello.ts", extensionModule("hello"));
        await writeFile(
          join(root, ".kb", "extensions", "hello.manifest.json"),
          JSON.stringify(MANIFEST),
        );
        await trustExtension(root, "hello.ts");
        const registry = await Effect.runPromise(
          registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
        );
        expect(registry.families.find(({ name }) => name === "hello")).toMatchObject({
          enabled: true,
          trusted: true,
          manifest: MANIFEST,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("a declaration that says it in code is refused: the manifest file is its one home", async () => {
      resetRegistryCache();
      const root = await rootWith({
        "teller.ts": extensionModule("teller", {
          declaration: '{ name: "teller", label: "Teller", description: "in code" }',
        }),
      });
      try {
        const { failures } = await inventoryOf(root);
        expect(failures).toContainEqual({
          file: "teller.ts",
          error: expect.stringContaining("belongs in teller.manifest.json"),
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  test("a module whose declaration does not fold is refused, and the store still opens", async () => {
    resetRegistryCache();
    const root = await rootWith({
      "graph.ts": extensionModule("graph", { declaration: '{ name: "graph", label: "Mine" }' }),
    });
    try {
      const { families, failures } = await Effect.runPromise(
        rootFamilies(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(families.filter(({ source }) => source !== "bundled")).toEqual([]);
      expect(failures.map(({ file, error }) => [file, error.includes("declared twice")])).toEqual([
        ["graph.ts", true],
      ]);
      const ctx = await openKb(root);
      expect(ctx.index.getNode(extensionNodeId("graph"))?.text).toBe("Graph");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module whose options are not its own to declare, or whose knobs are malformed, is refused, and kb's backdrop stays kb's", async () => {
    resetRegistryCache();
    const root = await rootWith({
      "squat.ts": declaring("squat", "backdrops.sky"),
      "bare.ts": declaring("bare", "glow"),
      "knobs.ts": declaring(
        "knobs",
        "knobs.glow",
        '[{ kind: "number", id: "speed", label: "Speed", min: 0, max: 1, step: 0.5, default: 2 }]',
      ),
      "noopts.ts": declaring(
        "noopts",
        "noopts.glow",
        '[{ kind: "enum", id: "mode", label: "Mode", default: "a" }]',
      ),
      "nobool.ts": declaring(
        "nobool",
        "nobool.glow",
        '[{ kind: "boolean", id: "on", label: "On", default: "yes" }]',
      ),
      "fine.ts": declaring(
        "fine",
        "fine.glow",
        '[{ kind: "number", id: "speed", label: "Speed", min: 0, max: 2, step: 0.5, default: 1 }]',
      ),
    });
    try {
      const { families, failures } = await Effect.runPromise(
        rootFamilies(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(
        families
          .filter(({ source }) => source !== "bundled")
          .map(({ declaration }) => declaration.name),
      ).toEqual(["fine"]);
      expect(Object.fromEntries(failures.map(({ file, error }) => [file, error]))).toEqual({
        "bare.ts": expect.stringContaining("its option glow must be named bare.<id>"),
        "knobs.ts": expect.stringContaining("the knob speed: its default is out of range"),
        // A knob missing what its kind carries, or carrying the wrong type, is refused by its shape.
        "nobool.ts": expect.stringContaining("default"),
        "noopts.ts": expect.stringContaining("options"),
        "squat.ts": expect.stringContaining("its option backdrops.sky must be named squat.<id>"),
      });
      const ctx = await openKb(root);
      expect(ctx.index.getNode(backdropOptionId("backdrops.sky"))?.text).toBe("Sky");
      expect(ctx.index.getNode(backdropOptionId("fine.glow"))?.text).toBe("Mine");
      expect(ctx.index.getNode(`${backdropOptionId("fine.glow")}.knob.speed`)).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
