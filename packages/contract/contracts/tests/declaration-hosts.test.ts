/**
 * Every host loads a family's declaration through one plugin, and each part
 * reaches only a kernel its point accepts (DESIGN.md → Point
 * specifications): a declaration's migrations are the registry's and the
 * server's, and the page loads its views and keys all the same.
 */
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { KERNEL_HOSTS, makeKernel, type KernelHost } from "@kb/plugin";
import { defineExtension, declarationPlugin } from "../src/declaration.ts";
import { KeybindingPoint } from "../src/keybindings.ts";
import { MigrationPoint } from "../src/migration.ts";
import { ProcedurePoint } from "../src/procedure.ts";
import { ViewKeyPoint, viewDef } from "../src/view-catalog.ts";
import { provideKeybinding } from "@kb/keybindings";
import { HomeView } from "@kb/views";

const family = defineExtension({
  name: "fam",
  label: "Family",
  views: [viewDef(HomeView)],
  keyboard: {
    bindings: [
      provideKeybinding("hello", {
        context: "core.page",
        chord: "Mod-Shift-H",
        run: { command: "x" },
      }),
    ],
  },
  migrations: [{ id: "move", title: "Move", run: () => ({ upserts: [], deletes: [] }) }],
});

const loadedOn = (host: KernelHost) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kernel = makeKernel({ host });
      yield* kernel.load(declarationPlugin(family));
      const read = {
        status: kernel.plugins().find((p) => p.name === family.name)?.status,
        views: kernel.contributions(ViewKeyPoint).length,
        keys: kernel.contributions(KeybindingPoint).length,
        migrations: kernel.contributions(MigrationPoint).map((c) => c.id),
        procedures: kernel.contributions(ProcedurePoint).map((c) => c.id),
      };
      yield* kernel.shutdown;
      return read;
    }),
  );

test("a family that declares a migration loads on every host, its views and keys intact", async () => {
  for (const host of KERNEL_HOSTS) {
    const read = await loadedOn(host);
    expect(read.status).toBe("active");
    expect(read.views).toBe(1);
    // Keys are the registry's and the page's, by their point's own spec.
    expect(read.keys).toBe(host === "server" ? 0 : 1);
  }
});

test("its migration and the procedure that runs it reach the registry and the server, not the page", async () => {
  for (const host of ["registry", "server"] as const) {
    const read = await loadedOn(host);
    expect(read.migrations).toEqual(["fam.move"]);
    expect(read.procedures).toEqual(["migration.fam.move"]);
  }
  const page = await loadedOn("page");
  expect(page.migrations).toEqual([]);
  expect(page.procedures).toEqual([]);
});
