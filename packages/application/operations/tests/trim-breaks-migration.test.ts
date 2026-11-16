/**
 * Core's `core.trim-trailing-breaks` (DESIGN.md → Plugin data migrations,
 * "Core's own migration"): the line breaks that end a node's text come off,
 * and those inside it stay. The procedure that runs it is every
 * migration's, proven by `migration-contract.test.ts`; this holds the plan.
 */
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeKernel, type KernelHost } from "@kb/plugin";
import { MigrationPoint, declarationPlugin, type MigrationGraph } from "@kb/contracts";
import type { KbNode } from "@kb/model";
import { trimBreaksMigration, withoutTrailingBreaks } from "../src/trim-breaks-migration.ts";
import { coreExtension } from "../src/core-extension.ts";

const AT = "2026-11-16T00:00:00.000Z";

const node = (id: string, text: string) =>
  ({ id, text, props: {}, children: [], createdAt: "", updatedAt: "" }) satisfies KbNode;

const graphOf = (nodes: readonly KbNode[]): MigrationGraph => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, nodeOf: (id) => byId.get(id), at: AT };
};

/** The stray kinds the owner's and the trial store hold, and text that must stay. */
const before = [
  node("n.placeholder", "\n"),
  node("n.trailing", "Read the paper\n"),
  node("n.carried", "cc\n\n"),
  node("n.inner", "first line\nsecond line"),
  node("n.both", "a\nb\n"),
  node("n.plain", "untouched"),
  node("n.empty", ""),
];

/** `nodes` with `plan` applied. */
function applied(
  nodes: readonly KbNode[],
  plan: ReturnType<typeof trimBreaksMigration.run>,
): readonly KbNode[] {
  const written = new Map(plan.upserts.map((n) => [n.id, n]));
  return nodes.filter((n) => !plan.deletes.includes(n.id)).map((n) => written.get(n.id) ?? n);
}

/** The migrations a kernel of `host` holds once it loads core's declaration. */
const loaded = (host: KernelHost) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kernel = makeKernel({ host });
      yield* kernel.load(declarationPlugin(coreExtension));
      const ids = kernel.contributions(MigrationPoint).map((c) => c.id);
      yield* kernel.shutdown;
      return ids;
    }),
  );

describe("core.trim-trailing-breaks", () => {
  it("is core's declared migration, which reaches the registry", async () => {
    expect(coreExtension.migrations?.map((m) => m.id)).toEqual([trimBreaksMigration.id]);
    expect(await loaded("registry")).toEqual(["core.trim-trailing-breaks"]);
  });

  it("takes every line break off the end of a text, and keeps those inside it", () => {
    expect(withoutTrailingBreaks("\n")).toBe("");
    expect(withoutTrailingBreaks("cc\n\n")).toBe("cc");
    expect(withoutTrailingBreaks("a\nb\n")).toBe("a\nb");
    expect(withoutTrailingBreaks("a\nb")).toBe("a\nb");
  });

  it("writes only the nodes whose text ends in a line break, stamped at the plan's instant", () => {
    const plan = trimBreaksMigration.run(graphOf(before));
    expect(plan.deletes).toEqual([]);
    expect(plan.upserts.map((n) => [n.id, n.text, n.updatedAt])).toEqual([
      ["n.placeholder", "", AT],
      ["n.trailing", "Read the paper", AT],
      ["n.carried", "cc", AT],
      ["n.both", "a\nb", AT],
    ]);
    expect(trimBreaksMigration.check?.(graphOf(before))).toEqual([
      "n.placeholder's text still ends in a line break",
      "n.trailing's text still ends in a line break",
      "n.carried's text still ends in a line break",
      "n.both's text still ends in a line break",
    ]);
  });

  it("plans nothing on a migrated graph, and its check finds nothing there", () => {
    const after = applied(before, trimBreaksMigration.run(graphOf(before)));
    expect(trimBreaksMigration.run(graphOf(after))).toEqual({ upserts: [], deletes: [] });
    expect(trimBreaksMigration.check?.(graphOf(after))).toEqual([]);
  });

  it("plans nothing on core's own seed, so a fresh store has nothing pending", () => {
    const seeded = coreExtension.seed?.(AT) ?? [];
    expect(seeded.length).toBeGreaterThan(0);
    expect(trimBreaksMigration.run(graphOf(seeded))).toEqual({ upserts: [], deletes: [] });
  });
});
