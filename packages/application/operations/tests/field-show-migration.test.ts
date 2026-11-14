/**
 * Core's `core.field-show` (DESIGN.md → Data model → field display): what a
 * person hid with the retired checkbox is shown never, and the checkbox
 * leaves the graph. The procedure that runs it is every migration's, proven
 * by `migration-contract.test.ts`; this holds the plan.
 */
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeKernel, type KernelHost } from "@kb/plugin";
import { KeybindingPoint, MigrationPoint, ViewKeyPoint, declarationPlugin } from "@kb/contracts";
import { SYSTEM_IDS, type KbNode, type PropValue } from "@kb/model";
import type { MigrationGraph } from "@kb/contracts";
import { RETIRED_HIDDEN_FIELD, fieldShowMigration } from "../src/field-show-migration.ts";
import { coreExtension } from "../src/core-extension.ts";

const AT = "2026-11-14T00:00:00.000Z";

const node = (id: string, props: Record<string, PropValue[]> = {}, children: string[] = []) =>
  ({ id, text: id, props, children, createdAt: "", updatedAt: "" }) satisfies KbNode;

const graphOf = (nodes: readonly KbNode[]): MigrationGraph => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, nodeOf: (id) => byId.get(id), at: AT };
};

const HIDDEN: PropValue[] = [{ t: "bool", v: true }];
const NEVER: PropValue[] = [{ t: "ref", v: SYSTEM_IDS.showNever }];

const before = [
  node(RETIRED_HIDDEN_FIELD),
  node("f.hid", { [RETIRED_HIDDEN_FIELD]: HIDDEN }),
  node("f.unhid", { [RETIRED_HIDDEN_FIELD]: [{ t: "bool", v: false }] }),
  node("f.both", {
    [RETIRED_HIDDEN_FIELD]: HIDDEN,
    [SYSTEM_IDS.showField]: [{ t: "ref", v: SYSTEM_IDS.showFilled }],
  }),
  node("sys.tag", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.colorField },
      { t: "ref", v: RETIRED_HIDDEN_FIELD },
    ],
  }),
  node("f.untouched", { [SYSTEM_IDS.showField]: NEVER }),
];

/** What a kernel of `host` holds once it loads core's declaration. */
const loaded = (host: KernelHost) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kernel = makeKernel({ host });
      yield* kernel.load(declarationPlugin(coreExtension));
      const read = {
        status: kernel.plugins().find((p) => p.name === coreExtension.name)?.status,
        views: kernel.contributions(ViewKeyPoint).length,
        keys: kernel.contributions(KeybindingPoint).length,
        migrations: kernel.contributions(MigrationPoint).map((c) => c.id),
      };
      yield* kernel.shutdown;
      return read;
    }),
  );

describe("core.field-show", () => {
  it("is core's declared migration, which reaches the registry while core loads on the page", async () => {
    expect(coreExtension.migrations?.map((m) => m.id)).toContain(fieldShowMigration.id);
    const page = await loaded("page");
    expect(page.status).toBe("active");
    expect(page.views).toBeGreaterThan(0);
    expect(page.keys).toBeGreaterThan(0);
    expect(page.migrations).toEqual([]);
    expect((await loaded("registry")).migrations).toEqual(["core.field-show"]);
  });

  it("moves a hidden field to show never, keeps a show already said, and drops the checkbox", () => {
    const plan = fieldShowMigration.run(graphOf(before));
    const by = new Map(plan.upserts.map((n) => [n.id, n]));
    expect(plan.deletes).toEqual([RETIRED_HIDDEN_FIELD]);
    expect(by.get("f.hid")?.props).toEqual({ [SYSTEM_IDS.showField]: NEVER });
    expect(by.get("f.unhid")?.props).toEqual({});
    expect(by.get("f.both")?.props[SYSTEM_IDS.showField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.showFilled },
    ]);
    expect(by.get("sys.tag")?.props[SYSTEM_IDS.fieldsField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.colorField },
    ]);
    expect(by.has("f.untouched")).toBe(false);
    expect(fieldShowMigration.check?.(graphOf(before)).length).toBeGreaterThan(0);
  });

  it("plans nothing on a migrated graph, and its check finds nothing there", () => {
    const plan = fieldShowMigration.run(graphOf(before));
    const written = new Map(plan.upserts.map((n) => [n.id, n]));
    const after = before
      .filter((n) => !plan.deletes.includes(n.id))
      .map((n) => written.get(n.id) ?? n);
    expect(fieldShowMigration.run(graphOf(after))).toEqual({ upserts: [], deletes: [] });
    expect(fieldShowMigration.check?.(graphOf(after))).toEqual([]);
  });
});
