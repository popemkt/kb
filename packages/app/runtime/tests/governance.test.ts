/**
 * Governance is a family, built on the guard point (DESIGN.md → Action
 * registry → Interception, Core boundary & extensions → governance): its
 * plugin holds approval and the owner's `force`; core decides nothing
 * about a call. The deployment, never the graph, says whether it is
 * composed (`deployGovernance`, the CLI's `--governance`): required, no
 * store can switch it off; off, no policy node is in the store it opens.
 * For now it ships no rule that bites (DESIGN.md → Approval → Current
 * stance): composed, it contributes no guard and seeds no policy, so every
 * call runs, whoever makes it.
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
import { extensionNodeId } from "@kb/model";
import { approvalPoliciesOf, governanceExtension } from "@kb/governance";

const AT = "2026-10-20T00:00:00.000Z";
/** Every node the family's declaration seeds. */
const governanceSeedNodes = (at: string) => governanceExtension.seed?.(at) ?? [];

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
  test("its plugin is loaded and, while policies are deferred, contributes no guard", async () => {
    const registry = await Effect.runPromise(
      registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(registry.interception.missing()).toEqual([]);
    const guards = registry.interception.guards({ id: "node.delete", mode: { kind: "write" } });
    expect(guards).toEqual([]);
  });

  test("nothing bites: an agent deletes, sets force, switches an extension and trusts code, and every action is listed as allowed", async () => {
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
    expect(
      await invoke(ctx, {
        id: "sandbox.trust",
        input: { digest: `sha256:${"0".repeat(64)}` },
        actor: "agent",
      }),
    ).toMatchObject({ status: "succeeded" });
    const listed = await invoke(ctx, { id: "kb.manifest", input: {}, actor: "agent" });
    const decisions = new Set(
      (listed.status === "succeeded"
        ? (listed.output as { actions: { decision: string }[] }).actions
        : []
      ).map(({ decision }) => decision),
    );
    expect([...decisions]).toEqual(["allow"]);
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
  test("a store opened without it holds no policy node, nor anything else of the family's", async () => {
    deployGovernance("off");
    const ctx = await openKb(root);
    const ids = new Set(ctx.nodes.map((node) => node.id));
    const familyNodes = governanceSeedNodes(AT).map((node) => node.id);
    expect(familyNodes.filter((id) => ids.has(id))).toEqual([]);
    expect(ids.has(extensionNodeId("governance"))).toBe(false);
    expect(approvalPoliciesOf(ctx.nodes)).toEqual([]);
    // Nothing core seeds names one: the lists the family files into hold none of its nodes.
    for (const list of Object.keys(governanceExtension.files ?? {})) {
      expect(ctx.index.getNode(list)?.children ?? []).toEqual([]);
    }
  });

  test("and the same store opened with it is seeded with them", async () => {
    deployGovernance("off");
    await openKb(root);
    deployGovernance("required");
    resetRegistryCache();
    const ctx = await openKb(root);
    const ids = new Set(ctx.nodes.map((node) => node.id));
    expect(governanceSeedNodes(AT).every((node) => ids.has(node.id))).toBe(true);
    // No policy among them while policies are deferred. GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
    expect(approvalPoliciesOf(ctx.nodes)).toEqual([]);
  });

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
