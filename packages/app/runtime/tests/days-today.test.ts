/**
 * `ext.days.today` through the invoke core (DESIGN.md → Days), over every
 * store backend: a day's node and whatever is missing above it in one
 * transaction, found again by its key, and one node per key from every
 * surface and every caller, two at once on one root included. The pure plan
 * is `@kb/days`' `plan.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { join } from "node:path";
import type { ActionReceipt } from "@kb/contracts";
import { DAYS_IDS, periodNodeId } from "@kb/days";
import { mergeNodeSets, present, refValuesOf, type KbNode } from "@kb/model";
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

async function freshRoot(backend: StoreBackend): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-days-"));
  roots.push(root);
  await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
  return root;
}

/** Whether `node` holds the period key `key`. */
function holds(node: KbNode, key: string): boolean {
  return (node.props[DAYS_IDS.keyField] ?? []).some(
    (value) => value.t === "str" && value.v === key,
  );
}

/** The nodes holding `key`, as a fresh open of `root` reads them. */
async function holdersOf(root: string, key: string): Promise<KbNode[]> {
  const reopened = await openKb(root);
  return reopened.nodes.filter((node) => holds(node, key));
}

function output(receipt: ActionReceipt): { id: string; made: string[] } {
  if (receipt.status !== "succeeded")
    throw new Error(`${receipt.status}: ${JSON.stringify(receipt)}`);
  return receipt.output as { id: string; made: string[] };
}

/** A plain `node.add` that hand-keys its node as the day `2026-11-10`. */
function keyedAdd(id: string) {
  return {
    id: "node.add",
    input: {
      id,
      text: id,
      props: [{ field: DAYS_IDS.keyField, value: { t: "str", v: "2026-11-10" } }],
    },
  };
}

function daysContract(backend: StoreBackend) {
  const freshKb = async () => openKb(await freshRoot(backend));
  describe(`ext.days.today (${backend})`, () => {
    test("makes journal, year, week and day in one transaction, then finds the day again", async () => {
      const ctx = await freshKb();
      const before = ctx.nodes.length;
      const first = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      expect(first.made).toHaveLength(4);
      expect(ctx.nodes.length).toBe(before + 4);
      const day = present(
        ctx.nodes.find((n) => n.id === first.id),
        "the day",
      );
      expect(day.text).toBe("Tue, Nov 10");
      expect(day.props[DAYS_IDS.keyField]).toEqual([{ t: "str", v: "2026-11-10" }]);
      expect(refValuesOf(day, "sys.f.type")).toEqual([DAYS_IDS.dayTag]);
      const family = present(
        ctx.nodes.find((n) => n.id === DAYS_IDS.family),
        "the family node",
      );
      expect(refValuesOf(family, DAYS_IDS.journalField)).toEqual(first.made.slice(0, 1));

      const again = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      expect(again).toEqual({ id: first.id, made: [] });
      const nextDay = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-11" } }),
      );
      expect(nextDay.made).toHaveLength(1);
    });

    test("a renamed, moved day is still that day", async () => {
      const ctx = await freshKb();
      const { id } = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      const home = output(await invoke(ctx, { id: "node.add", input: { text: "Elsewhere" } })).id;
      const moved = await invoke(ctx, {
        id: "node.update",
        input: { id, text: "my birthday", parent: home },
      });
      expect(moved.status).toBe("succeeded");
      expect(
        output(await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } })),
      ).toEqual({
        id,
        made: [],
      });
    });

    test("a second node holding a day's key is refused from any surface", async () => {
      const ctx = await freshKb();
      output(await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }));
      const copy = await invoke(ctx, {
        id: "node.add",
        input: {
          text: "copy",
          props: [{ field: DAYS_IDS.keyField, value: { t: "str", v: "2026-11-10" } }],
        },
      });
      expect(copy.status).toBe("failed");
    });

    test("a value that is not a calendar date is refused", async () => {
      const ctx = await freshKb();
      expect((await invoke(ctx, { id: "ext.days.today", input: { day: "Nov 10" } })).status).toBe(
        "failed",
      );
    });

    test("two callers asking for one day at once on one root get one hierarchy", async () => {
      const root = await freshRoot(backend);
      const [a, b] = await Promise.all([openKb(root), openKb(root)]);
      const ask = { id: "ext.days.today", input: { day: "2026-11-10" } };
      const [first, second] = (await Promise.all([invoke(a, ask), invoke(b, ask)])).map(output);
      expect(second?.id).toBe(first?.id);
      expect(
        [first?.made.length ?? -1, second?.made.length ?? -1].toSorted((x, y) => x - y),
      ).toEqual([0, 4]);
      for (const key of ["2026-11-10", "2026-W46", "2026"]) {
        expect(await holdersOf(root, key)).toHaveLength(1);
      }
      const family = present(
        (await openKb(root)).nodes.find((n) => n.id === DAYS_IDS.family),
        "the family node",
      );
      const [journal] = refValuesOf(family, DAYS_IDS.journalField);
      const made = present(first?.made.length === 4 ? first : second, "the call that made the day");
      expect(journal).toBe(made.made[0]);
    });

    test("two callers hand-keying one day at once on one root: one lands, one is refused", async () => {
      const root = await freshRoot(backend);
      const [a, b] = await Promise.all([openKb(root), openKb(root)]);
      const receipts = await Promise.all([
        invoke(a, keyedAdd("manual.a")),
        invoke(b, keyedAdd("manual.b")),
      ]);
      expect(receipts.map((r) => r.status).toSorted()).toEqual(["failed", "succeeded"]);
      expect(await holdersOf(root, "2026-11-10")).toHaveLength(1);
    });

    test("two clones that each made one day merge into one node per period", async () => {
      const ours = await freshRoot(backend);
      const base = (await openKb(ours)).nodes;
      const theirs = await mkdtemp(join(tmpdir(), "kb-days-clone-"));
      roots.push(theirs);
      await cp(ours, theirs, { recursive: true });
      const ask = { id: "ext.days.today", input: { day: "2026-11-10" } };
      expect(output(await invoke(await openKb(ours), ask)).id).toBe(periodNodeId("2026-11-10"));
      expect(output(await invoke(await openKb(theirs), ask)).id).toBe(periodNodeId("2026-11-10"));
      const merged = mergeNodeSets(base, (await openKb(ours)).nodes, (await openKb(theirs)).nodes);
      for (const key of ["2026-11-10", "2026-W46", "2026"]) {
        const holders = merged.nodes.filter((node) => holds(node, key));
        expect(holders.map((node) => node.id)).toEqual([periodNodeId(key)]);
      }
    });
  });
}

for (const backend of STORE_BACKENDS) daysContract(backend);
