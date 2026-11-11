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
import {
  mergeNodeSets,
  present,
  refValuesOf,
  SYSTEM_IDS,
  tagViewsOf,
  type KbNode,
} from "@kb/model";
import { backlinksQuery } from "@kb/query";
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

/** A plain `node.add` that hand-makes a `#day` keyed `key` (the day `2026-11-10` unless said). */
function keyedAdd(id: string, key = "2026-11-10", tag: string = DAYS_IDS.dayTag) {
  return {
    id: "node.add",
    input: {
      id,
      text: id,
      parent: null,
      props: [
        { field: SYSTEM_IDS.typeField, value: { t: "ref", v: tag } },
        { field: DAYS_IDS.keyField, value: { t: "str", v: key } },
      ],
    },
  };
}

/** A `node.add` minting the field `id` of the built-in type option `type`. */
function fieldAdd(id: string, type: string) {
  return {
    id: "node.add",
    input: {
      id,
      text: id,
      props: [
        { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.field } },
        { field: SYSTEM_IDS.fieldTypeField, value: { t: "ref", v: type } },
      ],
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

    test("a date in any date field references its day, which lists it among its backlinks", async () => {
      const ctx = await freshKb();
      output(await invoke(ctx, fieldAdd("f.due", SYSTEM_IDS.ftDate)));
      output(await invoke(ctx, fieldAdd("f.note", SYSTEM_IDS.ftText)));
      const dated = async (text: string, fieldId: string) =>
        output(
          await invoke(ctx, {
            id: "node.add",
            input: { text, props: [{ field: fieldId, value: { t: "str", v: "2026-11-12" } }] },
          }),
        ).id;
      // Dated before the day exists: the reference holds once it does.
      const due = await dated("Call the plumber", "f.due");
      const note = await dated("Says the date in text", "f.note");
      const { id: day } = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-12" } }),
      );
      const back = output(
        await invoke(ctx, { id: "graph.query", input: { query: backlinksQuery(day) } }),
      ) as unknown as { rows: unknown[][] };
      const referrers = back.rows.map((row) => row[0]);
      expect(referrers).toContain(due);
      expect(referrers).not.toContain(note);
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
      const copy = await invoke(ctx, keyedAdd("copy"));
      expect(copy.status === "failed" && copy.message).toContain("is already");
    });

    test("a key is a real period on a period node, and a day may be re-keyed to a free date", async () => {
      const ctx = await freshKb();
      const refused = async (add: ReturnType<typeof keyedAdd>, says: string) => {
        const receipt = await invoke(ctx, add);
        expect(receipt.status === "failed" && receipt.message).toContain(says);
      };
      await refused(keyedAdd("bad-date", "2026-02-30"), "“2026-02-30” is not a day");
      await refused(keyedAdd("bad-week", "2026-W60", DAYS_IDS.weekTag), "is not a week");
      await refused(keyedAdd("no-period", "2026-11-10", SYSTEM_IDS.tag), "only a node that is one");
      const { id } = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      const rekeyed = await invoke(ctx, {
        id: "node.update",
        input: {
          id,
          unsetProps: [{ field: DAYS_IDS.keyField }],
          setProps: [{ field: DAYS_IDS.keyField, value: { t: "str", v: "2026-11-09" } }],
        },
      });
      expect(rekeyed.status).toBe("succeeded");
      expect(
        output(await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-09" } })).id,
      ).toBe(id);
    });

    test("a key is judged as stored, and a tag that stops extending #day takes its holders' period away", async () => {
      const ctx = await freshKb();
      const failed = async (call: { id: string; input: unknown }, says: string) => {
        const receipt = await invoke(ctx, call);
        expect(receipt.status === "failed" && receipt.message).toContain(says);
      };
      await failed(keyedAdd("blank", "   "), "“   ” is not a day");
      await failed(keyedAdd("padded", " 2026-11-10"), "is not a day");

      const extendsDay = {
        field: SYSTEM_IDS.extendsField,
        value: { t: "ref" as const, v: DAYS_IDS.dayTag },
      };
      const made = await invoke(ctx, {
        id: "node.add",
        input: {
          id: "t.myday",
          text: "my day",
          parent: null,
          props: [
            { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.tag } },
            extendsDay,
          ],
        },
      });
      expect(made.status).toBe("succeeded");
      expect((await invoke(ctx, keyedAdd("mine", "2026-11-10", "t.myday"))).status).toBe(
        "succeeded",
      );
      await failed(
        {
          id: "node.update",
          input: { id: "t.myday", unsetProps: [{ field: SYSTEM_IDS.extendsField }] },
        },
        "“mine” holds the period “2026-11-10”, but only a node that is one",
      );
      expect(
        ctx.nodes.find((node) => node.id === "t.myday")?.props[SYSTEM_IDS.extendsField],
      ).toEqual([extendsDay.value]);
    });

    test("a day keeps its period: the key comes off only with #day", async () => {
      const ctx = await freshKb();
      const { id } = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      const removed = await invoke(ctx, {
        id: "node.update",
        input: { id, unsetProps: [{ field: DAYS_IDS.keyField }] },
      });
      expect(removed.status === "failed" && removed.message).toContain(
        "is a day, so its period can be changed but not removed",
      );
      const day = present(
        ctx.nodes.find((node) => node.id === id),
        "the day",
      );
      expect(day.props[DAYS_IDS.keyField]).toEqual([{ t: "str", v: "2026-11-10" }]);
      const ordinary = await invoke(ctx, {
        id: "node.update",
        input: {
          id,
          unsetProps: [{ field: DAYS_IDS.keyField }, { field: SYSTEM_IDS.typeField }],
        },
      });
      expect(ordinary.status).toBe("succeeded");
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

    test("a day tag of the person's that extends #day is what a new day carries", async () => {
      const ctx = await freshKb();
      const myDay = output(
        await invoke(ctx, {
          id: "node.add",
          input: {
            id: "my-day",
            text: "my day",
            props: [
              { field: "sys.f.type", value: { t: "ref", v: "sys.tag" } },
              { field: "sys.f.extends", value: { t: "ref", v: DAYS_IDS.dayTag } },
            ],
          },
        }),
      ).id;
      const point = (tag: string) =>
        invoke(ctx, {
          id: "node.update",
          input: {
            id: DAYS_IDS.family,
            setProps: [{ field: DAYS_IDS.dayTagField, value: { t: "ref", v: tag } }],
          },
        });
      expect((await point(myDay)).status).toBe("succeeded");
      const { id } = output(
        await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }),
      );
      const day = present(
        ctx.nodes.find((n) => n.id === id),
        "the day",
      );
      expect(refValuesOf(day, "sys.f.type")).toEqual([myDay]);
      // The day opens in the day page through #my day's chain to #day.
      expect(tagViewsOf(day, "default", (n) => ctx.index.getNode(n))[0]?.tag).toBe(DAYS_IDS.dayTag);
    });

    test("a day tag that does not extend #day is refused with why", async () => {
      const ctx = await freshKb();
      await invoke(ctx, {
        id: "node.add",
        input: {
          id: "other",
          text: "other",
          props: [{ field: "sys.f.type", value: { t: "ref", v: "sys.tag" } }],
        },
      });
      const refused = await invoke(ctx, {
        id: "node.update",
        input: {
          id: DAYS_IDS.family,
          setProps: [{ field: DAYS_IDS.dayTagField, value: { t: "ref", v: "other" } }],
        },
      });
      expect(refused).toMatchObject({ status: "failed" });
      expect(JSON.stringify(refused)).toContain("does not extend #day");
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
