/**
 * Governance is a family, built on the guard point (DESIGN.md → Action
 * registry → Interception, Core boundary & extensions → governance): its
 * plugin contributes approval and the owner's `force`; core decides
 * nothing about a call. The deployment, never the graph, says whether it is
 * composed (`deployGovernance`, the CLI's `--governance`): required, its
 * guards decide every call and no store can switch it off; off, there is
 * no guard and every call runs. The approval suites themselves
 * (`approval.test.ts`, the surface contract) run unchanged over the family.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { bunFileSystemLayer } from "../src/platform.ts";
import { deployGovernance } from "../src/deployment.ts";
import { invoke } from "../src/invoke.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-governance-"));
  resetRegistryCache();
});
afterEach(async () => {
  deployGovernance("required");
  resetRegistryCache();
  await rm(root, { recursive: true, force: true });
});

const remove = (id: string) => ({
  id: "node.delete",
  input: { id },
  actor: "agent" as const,
});

describe("governance, required", () => {
  test("its plugin holds the guard point, in the order calls meet it, and nothing is missing", async () => {
    const registry = await Effect.runPromise(
      registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(registry.interception.missing()).toEqual([]);
    const guards = registry.interception.guards({ id: "node.delete", mode: { kind: "write" } });
    expect(guards.map(({ owner, id }) => [owner, id])).toEqual([
      ["governance", "ext.governance.approval"],
      ["governance", "ext.governance.force"],
    ]);
  });

  test("while its plugin is gone from the registry, every call is denied rather than run unguarded", async () => {
    const ctx = await openKb(root);
    const registry = await Effect.runPromise(
      registryFor(root, (id) => ctx.index.getNode(id)).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await Effect.runPromise(registry.kernel.unload("governance"));
    expect(registry.interception.missing()).toEqual(["governance"]);
    expect(
      await invoke(ctx, { id: "node.get", input: { id: "sys.views" }, actor: "cli" }),
    ).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { decidedBy: { plugin: "governance", rule: "required-guard-missing" } },
    });
  });

  test("a store cannot switch it off", async () => {
    const ctx = await openKb(root);
    expect(
      await invoke(ctx, {
        id: "extension.switch",
        input: { name: "governance", on: false },
        actor: "cli",
      }),
    ).toMatchObject({ status: "failed", code: "invalid_input" });
  });
});

describe("governance, off by the deployment", () => {
  test("no guard decides: what the policies ask, and an agent's force, run", async () => {
    deployGovernance("off");
    const ctx = await openKb(root);
    await invoke(ctx, { id: "node.add", input: { id: "n.a", text: "a" } });
    expect(await invoke(ctx, remove("n.a"))).toMatchObject({ status: "succeeded" });
    expect(
      await invoke(ctx, {
        id: "node.update",
        input: { id: "sys.views", text: "renamed", force: true },
        actor: "agent",
      }),
    ).toMatchObject({ status: "succeeded" });
    const listed = await invoke(ctx, { id: "kb.manifest", input: {}, actor: "agent" });
    expect(listed.status).toBe("succeeded");
    const decisions = new Set(
      (listed.status === "succeeded"
        ? (listed.output as { actions: { decision: string }[] }).actions
        : []
      ).map(({ decision }) => decision),
    );
    expect([...decisions]).toEqual(["allow"]);
  });
});
