/**
 * The core-only run (DESIGN.md → Plugin organisation): core and the
 * `core`-tagged families alone, with governance not deployed and every
 * optional family switched off. kb still opens, composes, answers every read
 * the registry holds and writes nodes, so nothing core does depends at run
 * time on a family a deployment may leave out. The harness's
 * `plugin-organisation` check holds the derived dependencies to the same
 * rule; this holds what the registry runs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { deployGovernance } from "../src/deployment.ts";
import { invoke } from "../src/invoke.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { resetRegistryCache, sessionRegistry } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-core-only-"));
  deployGovernance("off");
  resetRegistryCache();
});
afterEach(async () => {
  deployGovernance("required");
  resetRegistryCache();
  await rm(root, { recursive: true, force: true });
});

/** A root with every optional family switched off, and the registry it composes. */
async function coreOnly() {
  const ctx = await openKb(root);
  for (const { name, optional } of BUNDLED_FAMILIES) {
    if (optional === undefined) continue;
    const switched = await invoke(ctx, {
      id: "extension.switch",
      input: { name, on: false },
      actor: "cli",
    });
    expect(switched.status).toBe("succeeded");
  }
  const registry = await Effect.runPromise(
    sessionRegistry(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
  return { ctx, registry };
}

describe("kb with core alone", () => {
  test("composes core-tagged plugins only, each active", async () => {
    const { registry } = await coreOnly();
    const plugins = registry.kernel.plugins();
    expect(
      plugins.filter((plugin) => !plugin.tags.includes("core")).map(({ name }) => name),
    ).toEqual([]);
    expect(plugins.filter((plugin) => plugin.status !== "active")).toEqual([]);
    expect(registry.failures).toEqual([]);
    expect(registry.families.filter((row) => row.enabled).map(({ name }) => name)).toEqual(
      BUNDLED_FAMILIES.filter((family) => family.tags?.includes("core") === true).map(
        ({ name }) => name,
      ),
    );
  });

  test("answers every read it holds, none with an internal failure", async () => {
    const { ctx, registry } = await coreOnly();
    // A read that needs input refuses `{}` as invalid; any refusal but an internal one is an answer.
    const reads = registry.actions.filter(({ def }) => def.mode.kind === "read");
    expect(reads.length).toBeGreaterThan(0);
    for (const { def } of reads) {
      const receipt = await invoke(ctx, { id: def.id, input: {}, actor: "cli" });
      expect([def.id, receipt.status === "failed" ? receipt.code : "ok"]).not.toEqual([
        def.id,
        "internal",
      ]);
    }
  });

  test("writes, moves and deletes nodes", async () => {
    const { ctx } = await coreOnly();
    const added = await invoke(ctx, { id: "node.add", input: { text: "core only" }, actor: "cli" });
    expect(added.status).toBe("succeeded");
    const id = added.status === "succeeded" ? (added.output as { id: string }).id : "";
    const updated = await invoke(ctx, {
      id: "node.update",
      input: { id, text: "core alone" },
      actor: "agent",
    });
    expect(updated.status).toBe("succeeded");
    const removed = await invoke(ctx, { id: "node.delete", input: { id }, actor: "agent" });
    expect(removed.status).toBe("succeeded");
  });
});
