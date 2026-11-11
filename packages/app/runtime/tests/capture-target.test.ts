/**
 * Where a node written with no chosen place goes (DESIGN.md → Provider roles,
 * the capture target), over every store backend: `node.add` and
 * `node.addTree` take an omitted parent to mean the registry's
 * `ui.capture-target`, and `parent: null` to mean the top level. What the
 * target makes for its place lands with the node, in one transaction.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  bundledPlugin,
  CapturePlannerService,
  CaptureTarget,
  kernelCaptureTarget,
  topLevelPlan,
  type ActionHandlerEnv,
  type ActionReceipt,
  type CapturePlanner,
  type KbContext,
} from "@kb/contracts";
import { domainError, present, type KbNode } from "@kb/model";
import { daysExtension } from "@kb/days";
import { coreExtension, nodeAddEffect, nodeAddTreeEffect } from "@kb/operations";
import { definePlugin, makeKernel, type Kernel } from "@kb/plugin";
import { invoke } from "../src/invoke.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { openKb } from "../src/session.ts";
import { STORE_BACKENDS, createStore, type StoreBackend } from "../src/store-selection.ts";

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

async function freshRoot(backend: StoreBackend): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-capture-"));
  roots.push(root);
  await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
  return root;
}

/** What a call answered, refusing a failed one. */
function answered(receipt: ActionReceipt): unknown {
  if (receipt.status !== "succeeded")
    throw new Error(`${receipt.status}: ${JSON.stringify(receipt)}`);
  return receipt.output;
}

/** The id a succeeded `node.add` made. */
function addedId(receipt: ActionReceipt): string {
  return (answered(receipt) as { id: string }).id;
}

/** The ids a succeeded `node.addTree` made, in tree order. */
function treeIds(receipt: ActionReceipt): string[] {
  return (answered(receipt) as { ids: string[] }).ids;
}

/** The id of the node `id` is filed under, or null at the top level. */
function parentOf(ctx: KbContext, id: string): string | null {
  return ctx.nodes.find((node) => node.children.includes(id))?.id ?? null;
}

const AT = "2026-11-11T00:00:00.000Z";
const PLACE: KbNode = {
  id: "place",
  text: "Place",
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
};

/** A target that answers `place`, making it the first time. */
const placeTarget: CapturePlanner = (nodes) =>
  Effect.succeed({
    parent: PLACE.id,
    upserts: nodes.some((node) => node.id === PLACE.id) ? [] : [PLACE],
  });

/** A target that refuses, so a call that asks it fails. */
const refusingTarget: CapturePlanner = () =>
  Effect.fail(domainError("internal", "the capture target was asked"));

/** Run `effect` as a handler runs, with `target` as the capture target. */
function withTarget<A, E>(
  ctx: KbContext,
  target: CapturePlanner,
  effect: Effect.Effect<A, E, ActionHandlerEnv>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provideService(CaptureTarget, target), Effect.provide(kbRuntimeLayer(ctx))),
  );
}

function captureContract(backend: StoreBackend) {
  describe(`node.add's capture target (${backend})`, () => {
    test("with core's answer alone, an omitted parent and null both mean the top level", async () => {
      const ctx = await openKb(await freshRoot(backend));
      answered(await invoke(ctx, { id: "extension.switch", input: { name: "days", on: false } }));
      const omitted = addedId(await invoke(ctx, { id: "node.add", input: { text: "omitted" } }));
      const top = addedId(
        await invoke(ctx, { id: "node.add", input: { text: "top", parent: null } }),
      );
      const tree = treeIds(
        await invoke(ctx, { id: "node.addTree", input: { outline: "- a tree" } }),
      );
      for (const id of [omitted, top, ...tree]) expect(parentOf(ctx, id)).toBeNull();
    });

    test("an omitted parent goes where the target says, with what it made, in one transaction", async () => {
      const root = await freshRoot(backend);
      const ctx = await openKb(root);
      const before = ctx.log.head;
      const { id } = await withTarget(ctx, placeTarget, nodeAddEffect({ text: "captured" }));
      expect(ctx.log.head).toBe(before + 1);
      const again = await withTarget(ctx, placeTarget, nodeAddEffect({ text: "again" }));
      const reopened = await openKb(root);
      const place = present(
        reopened.nodes.find((node) => node.id === PLACE.id),
        "the place the target made",
      );
      expect(place.children).toEqual([id, again.id]);
      expect(reopened.nodes.filter((node) => node.id === PLACE.id)).toHaveLength(1);
    });

    test("an outline's top-level items go where the target says, in one transaction", async () => {
      const ctx = await openKb(await freshRoot(backend));
      const before = ctx.log.head;
      const { ids } = await withTarget(
        ctx,
        placeTarget,
        nodeAddTreeEffect({ outline: "- first\n  - nested\n- second" }),
      );
      expect(ctx.log.head).toBe(before + 1);
      const [first, nested, second] = ids;
      expect(parentOf(ctx, present(first, "first"))).toBe(PLACE.id);
      expect(parentOf(ctx, present(nested, "nested"))).toBe(first ?? null);
      expect(parentOf(ctx, present(second, "second"))).toBe(PLACE.id);
    });

    test("a parent given, or null, never asks the target", async () => {
      const ctx = await openKb(await freshRoot(backend));
      const top = await withTarget(
        ctx,
        refusingTarget,
        nodeAddEffect({ text: "top", parent: null }),
      );
      const under = await withTarget(
        ctx,
        refusingTarget,
        nodeAddEffect({ text: "under", parent: top.id }),
      );
      expect(parentOf(ctx, top.id)).toBeNull();
      expect(parentOf(ctx, under.id)).toBe(top.id);
      const refused = await withTarget(
        ctx,
        refusingTarget,
        nodeAddEffect({ text: "nowhere" }).pipe(Effect.flip),
      );
      expect(refused.message).toBe("the capture target was asked");
    });
  });
}

for (const backend of STORE_BACKENDS) captureContract(backend);

/** A plugin named `name` that provides `planner` as the registry's capture target. */
function provider(name: string, planner: CapturePlanner) {
  return definePlugin({ name, apply: (ctx) => ctx.provide(CapturePlannerService, planner) });
}

/** A registry kernel holding core's default and, unless null, days' `planner` as its replacement. */
function registryWith(days: CapturePlanner | null): Kernel {
  const kernel = makeKernel({ host: "registry" });
  Effect.runSync(kernel.load(bundledPlugin(coreExtension, provider("core", topLevelPlan))));
  if (days !== null)
    Effect.runSync(kernel.load(bundledPlugin(daysExtension, provider("days", days))));
  return kernel;
}

const answer = (kernel: Kernel) => Effect.runPromise(kernelCaptureTarget(kernel)([]));

describe("the registry's ui.capture-target", () => {
  test("core's default answers the top level, with nothing to make", async () => {
    expect(await answer(registryWith(null))).toEqual({ parent: null, upserts: [] });
  });

  test("days' manifest claim is elected over core's default, and choosing core elects core", async () => {
    const kernel = registryWith(placeTarget);
    expect(await answer(kernel)).toEqual({ parent: PLACE.id, upserts: [PLACE] });
    Effect.runSync(kernel.configureRoles(new Map([["ui.capture-target", "core"]])));
    expect(await answer(kernel)).toEqual({ parent: null, upserts: [] });
  });

  test("a provider that dies is demoted and core's default answers", async () => {
    expect(await answer(registryWith(() => Effect.die(new Error("broken"))))).toEqual({
      parent: null,
      upserts: [],
    });
  });
});
