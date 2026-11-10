/**
 * `ext.days.today` through the invoke core (DESIGN.md → Days): a day's node
 * and whatever is missing above it in one transaction, found again by its
 * key, and one node per key from every surface. The pure plan is
 * `@kb/days`' `plan.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionReceipt } from "@kb/contracts";
import { DAYS_IDS } from "@kb/days";
import { present, refValuesOf } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

async function freshKb() {
  const root = await mkdtemp(join(tmpdir(), "kb-days-"));
  roots.push(root);
  return openKb(root);
}

function output(receipt: ActionReceipt): { id: string; made: string[] } {
  if (receipt.status !== "succeeded")
    throw new Error(`${receipt.status}: ${JSON.stringify(receipt)}`);
  return receipt.output as { id: string; made: string[] };
}

describe("ext.days.today", () => {
  test("makes journal, year, week and day in one transaction, then finds the day again", async () => {
    const ctx = await freshKb();
    const before = ctx.nodes.length;
    const first = output(await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }));
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

    const again = output(await invoke(ctx, { id: "ext.days.today", input: { day: "2026-11-10" } }));
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
});
