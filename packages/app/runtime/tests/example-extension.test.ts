/**
 * The example repository extension (`@kb/test-kit`), whose two halves each
 * use what a bundled family's do: its server entry provides a service, a
 * child plugin injects it to answer an action, and its declaration's view
 * reaches the catalog; its page half is served at the path its row names.
 * It keeps the one extension contract, the registry its host, as every
 * family does. The page loading that half is `@kb/ui`'s
 * `repository-extension.acceptance.test.tsx`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { NO_SWITCHES, extensionPagePath, switchWrites, type NodeLookup } from "@kb/contracts";
import {
  EXAMPLE,
  examplePageHalf,
  extensionContract,
  writeTrustedExample,
  type SwitchingHost,
} from "@kb/test-kit";
import { rootFamilies, servedPage } from "../src/families.ts";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

async function exampleRoot(): Promise<{ root: string; digest: string }> {
  const root = await mkdtemp(join(tmpdir(), "kb-example-extension-"));
  return { root, digest: await writeTrustedExample(root) };
}

const { root: ROOT, digest: DIGEST } = await exampleRoot();
afterAll(() => rm(ROOT, { recursive: true, force: true }));

const discovered = await Effect.runPromise(
  rootFamilies(ROOT).pipe(Effect.provide(bunFileSystemLayer)),
);
const example = discovered.families.find(({ declaration }) => declaration.name === EXAMPLE);
if (example === undefined)
  throw new Error(`the example was not discovered: ${JSON.stringify(discovered.failures)}`);

/** The registry over a root that holds the example, as its host. */
const registryHost: SwitchingHost = {
  source: "registry",
  root: Effect.acquireRelease(
    Effect.promise(async () => (await exampleRoot()).root),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  ),
  compose: (nodeOf) =>
    registryFor(ROOT, nodeOf).pipe(
      Effect.map(({ families, kernel }) => ({
        row: families.find((family) => family.name === EXAMPLE),
        kernel,
      })),
      Effect.provide(bunFileSystemLayer),
    ),
};

extensionContract(example.declaration, example.entry, registryHost);

describe("the example extension's server half", () => {
  test("its action answers through the service its entry provides", async () => {
    const ctx = await openKb(ROOT);
    const greeted = await invoke(ctx, { id: "ext.example.greet", input: { name: "kb" } });
    expect(greeted).toEqual({
      status: "succeeded",
      id: "ext.example.greet",
      output: { message: "hello kb" },
    });
  });

  test("its view is the catalog's, and its row names where its page half is served", async () => {
    const registry = await Effect.runPromise(
      registryFor(ROOT).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(registry.views.entries().map(({ id }) => id)).toContain("example.board");
    expect(registry.families.find(({ name }) => name === EXAMPLE)).toEqual({
      name: EXAMPLE,
      label: "Example",
      optional: true,
      enabled: true,
      source: join(ROOT, ".kb", "extensions", "example.ts"),
      page: extensionPagePath(DIGEST),
      digest: DIGEST,
    });
  });

  test("what is served at that path is its closure's page half while it is on, and nothing else is", async () => {
    const served = (path: string, nodeOf: NodeLookup = NO_SWITCHES) =>
      Effect.runPromise(servedPage(ROOT, path, nodeOf).pipe(Effect.provide(bunFileSystemLayer)));
    expect(await served(extensionPagePath(DIGEST))).toBe(
      await Effect.runPromise(examplePageHalf()),
    );
    expect(await served(extensionPagePath(`sha256:${"0".repeat(64)}`))).toBeNull();
    const [off] = switchWrites(example.declaration, false, NO_SWITCHES, new Date(0).toISOString());
    expect(
      await served(extensionPagePath(DIGEST), (id) => (id === off?.id ? off : undefined)),
    ).toBeNull();
  });
});
