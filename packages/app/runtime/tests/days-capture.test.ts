/**
 * Days' answer to the capture target through the invoke core (DESIGN.md →
 * Days, Provider roles), over every store backend: a `node.add` with no
 * parent lands in today's node, made with whatever is missing above it in
 * the add's own transaction; `parent: null` stays at the top level; the
 * `captures` setting can send captures to the top level; and the `time zone`
 * setting says what today is. The mechanism is `capture-target.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ActionReceipt, KbContext } from "@kb/contracts";
import { DAYS_IDS, dayKeyAt } from "@kb/days";
import { present, strValueOf } from "@kb/model";
import { invoke } from "../src/invoke.ts";
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

async function freshKb(backend: StoreBackend): Promise<KbContext> {
  const root = await mkdtemp(join(tmpdir(), "kb-days-capture-"));
  roots.push(root);
  await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
  return openKb(root);
}

/** The id a succeeded `node.add` made. */
function addedId(receipt: ActionReceipt): string {
  if (receipt.status !== "succeeded")
    throw new Error(`${receipt.status}: ${JSON.stringify(receipt)}`);
  return (receipt.output as { id: string }).id;
}

/** The node `id` is filed under, or undefined at the top level. */
function parentOf(ctx: KbContext, id: string) {
  return ctx.nodes.find((node) => node.children.includes(id));
}

/** Set one of the days family's settings to `value`. */
async function setting(ctx: KbContext, field: string, value: { t: "ref" | "str"; v: string }) {
  const receipt = await invoke(ctx, {
    id: "node.update",
    input: { id: DAYS_IDS.family, setProps: [{ field, value }] },
  });
  expect(receipt.status).toBe("succeeded");
}

/** A zone where it is a different day than in most others for much of every day. */
const FAR_EAST = "Pacific/Kiritimati";

function capture(ctx: KbContext, input: Record<string, unknown>) {
  return invoke(ctx, { id: "node.add", input: { text: "captured", ...input } });
}

function daysCaptureContract(backend: StoreBackend) {
  describe(`days' capture target (${backend})`, () => {
    test("an omitted parent lands in today, made with what is missing above it, in one transaction", async () => {
      const ctx = await freshKb(backend);
      await setting(ctx, DAYS_IDS.timeZoneField, { t: "str", v: FAR_EAST });
      const before = ctx.log.head;
      const first = addedId(await capture(ctx, {}));
      expect(ctx.log.head).toBe(before + 1);
      const day = present(parentOf(ctx, first), "the day it landed in");
      // The store's zone says what today is, wherever this process runs.
      expect(strValueOf(day, DAYS_IDS.keyField)).toBe(dayKeyAt(Date.now(), FAR_EAST));
      const second = addedId(await capture(ctx, {}));
      expect(parentOf(ctx, second)?.id).toBe(day.id);
      expect(
        ctx.nodes.filter(
          (node) => strValueOf(node, DAYS_IDS.keyField) === strValueOf(day, DAYS_IDS.keyField),
        ),
      ).toHaveLength(1);
    });

    test("an outline with no parent lands in today too", async () => {
      const ctx = await freshKb(backend);
      const receipt = await invoke(ctx, {
        id: "node.addTree",
        input: { outline: "- first\n  - nested" },
      });
      if (receipt.status !== "succeeded") throw new Error(JSON.stringify(receipt));
      const [first] = (receipt.output as { ids: string[] }).ids;
      const day = present(parentOf(ctx, present(first, "the first item")), "its day");
      expect(day.props[DAYS_IDS.keyField]).toBeDefined();
    });

    test("parent null stays at the top level and makes no day", async () => {
      const ctx = await freshKb(backend);
      const top = addedId(await capture(ctx, { parent: null }));
      expect(parentOf(ctx, top)).toBeUndefined();
      expect(ctx.nodes.some((node) => node.props[DAYS_IDS.keyField] !== undefined)).toBe(false);
    });

    test("the captures setting can send captures to the top level, days still on", async () => {
      const ctx = await freshKb(backend);
      await setting(ctx, DAYS_IDS.capturesField, { t: "ref", v: DAYS_IDS.capturesTop });
      const top = addedId(await capture(ctx, {}));
      expect(parentOf(ctx, top)).toBeUndefined();
      expect(ctx.nodes.some((node) => node.props[DAYS_IDS.keyField] !== undefined)).toBe(false);
      const made = await invoke(ctx, { id: "ext.days.today", input: {} });
      expect(made.status).toBe("succeeded");
    });

    test("ext.days.today without a day makes today in the store's zone", async () => {
      const ctx = await freshKb(backend);
      await setting(ctx, DAYS_IDS.timeZoneField, { t: "str", v: FAR_EAST });
      const made = addedId(await invoke(ctx, { id: "ext.days.today", input: {} }));
      const day = present(
        ctx.nodes.find((node) => node.id === made),
        "today's node",
      );
      expect(strValueOf(day, DAYS_IDS.keyField)).toBe(dayKeyAt(Date.now(), FAR_EAST));
    });
  });
}

for (const backend of STORE_BACKENDS) daysCaptureContract(backend);
