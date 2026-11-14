/**
 * Which view owns which path, as the UI plugins a page loads by default
 * resolve it — the route table that used to be a closed union in
 * `lib/router`, now asserted over the contributions that replaced it — and
 * which families' browser entries the page loads for what the server reports.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { present, extensionNodeId } from "@kb/model";
import { Effect, Schema } from "effect";
import {
  SHORTCUT_IDS,
  admitKeymaps,
  keyContextOf,
  chordData,
  chordFromText,
  chordToText,
  keyTargetNodeId,
  ChordDataSchema,
  matchesChord,
  type KeyChordEvent,
  type Keybinding,
} from "@kb/keybindings";
import { describe, expect, it } from "vitest";
import { definePlugin, makeKernel, syncPlugins, type Contribution } from "@kb/plugin";
import { BUNDLED_FAMILIES, HOSTED_FAMILIES, bundledSeed } from "@kb/bundled";
import { NO_SWITCHES, extensionRow, familyOn, type ExtensionRow } from "@kb/contracts";
import { agentExtension } from "@kb/agent";
import { LAB_SCENE_IDS, labExtension } from "@kb/lab";
import { LAB_STUDIES, LabStudyPoint } from "@kb/lab-ui";
import {
  findView,
  matchRoute,
  pageFootprint,
  ontologyPath,
  RoutePoint,
  KeybindingPoint,
  KeyContextPoint,
  SidebarSectionPoint,
} from "@kb/ui-sdk";
import { NoParams, viewKey, type OntologyView } from "@kb/views";
import { BROWSER_EXTENSIONS, CORE_UI_PLUGINS, familiesToLoad, importPageHalf } from "@/ui-plugins";

/** The browser entries of the families on in a store with no switch written, as the resolver loads them. */
const ALWAYS_ON = await Promise.all(
  BUNDLED_FAMILIES.filter((declaration) => familyOn(declaration, NO_SWITCHES, () => {})).flatMap(
    (declaration) => BROWSER_EXTENSIONS[declaration.name]?.load() ?? [],
  ),
);

function kernelWithBuiltins() {
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(
    Effect.forEach([...CORE_UI_PLUGINS, ...ALWAYS_ON], (plugin) => kernel.load(plugin)),
  );
  return kernel;
}

function route(path: string): { surface: string; params: unknown } | null {
  const matched = matchRoute(kernelWithBuiltins().contributions(RoutePoint), path);
  return matched === null ? null : { surface: matched.view.id, params: matched.params };
}

const CatalogRow = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  value: Schema.Unknown,
});
const CatalogSnapshot = Schema.Struct({
  contexts: Schema.Array(CatalogRow),
  bindings: Schema.Array(CatalogRow),
  cycles: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      offStatus: Schema.String,
      onStatus: Schema.String,
      off: Schema.Array(CatalogRow),
      on: Schema.Array(CatalogRow),
    }),
  ),
});

function registryKeyboardSnapshot() {
  const scratch = mkdtempSync(join(tmpdir(), "kb-keyboard-parity-"));
  try {
    const root = resolve(import.meta.dirname, "../../../..");
    const output = execFileSync(
      "bun",
      [resolve(root, "packages/app/test-kit/tests/registry-keyboard.fixture.ts")],
      {
        cwd: root,
        env: { ...process.env, KB_HOME: join(scratch, "home"), KB_DATA: join(scratch, "data") },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return Schema.decodeUnknownSync(CatalogSnapshot)(JSON.parse(output));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const catalogData = (rows: readonly { id: string; value: unknown }[]) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe("keyboard publication on both hosts", () => {
  it("publishes the same native catalog and preserves owner relationships", () => {
    const registry = registryKeyboardSnapshot();
    const page = kernelWithBuiltins();
    const contexts = page.contributions(KeyContextPoint);
    const bindings = page.contributions(KeybindingPoint);
    expect(catalogData(contexts)).toEqual(catalogData(registry.contexts));
    expect(catalogData(bindings)).toEqual(catalogData(registry.bindings));
    const all = [...contexts, ...bindings];
    const remote = new Map(
      [...registry.contexts, ...registry.bindings].map((row) => [row.id, row]),
    );
    // Hosts nest their entry plugins differently. Family authority and same-owner
    // relations must agree even when one host adds a declaration scope segment.
    for (const left of all) {
      expect(left.owner.split("/")[0], left.id).toBe(remote.get(left.id)?.owner.split("/")[0]);
      for (const right of all)
        expect(left.owner === right.owner, `${left.id} / ${right.id}`).toBe(
          remote.get(left.id)?.owner === remote.get(right.id)?.owner,
        );
    }
    expect(bindings.filter(({ id }) => id === "core.page.palette")).toHaveLength(1);
    for (const cycle of registry.cycles) {
      expect([cycle.offStatus, cycle.onStatus]).toEqual(["succeeded", "succeeded"]);
      expect(cycle.off.some(({ owner }) => owner.split("/")[0] === cycle.name)).toBe(false);
      expect(catalogData(cycle.off)).toEqual(
        catalogData(registry.bindings.filter(({ owner }) => owner.split("/")[0] !== cycle.name)),
      );
      expect(catalogData(cycle.on)).toEqual(catalogData(registry.bindings));
      expect(new Set(cycle.on.map(({ id }) => id)).size).toBe(cycle.on.length);
    }
  }, 40_000);

  it("withdraws and republishes one native copy across unload/reload", () => {
    const kernel = kernelWithBuiltins();
    const before = kernel.contributions(KeybindingPoint);
    for (const family of ["canvas", "outline", "days", "core"]) {
      Effect.runSync(kernel.unload(family));
      expect(
        kernel.contributions(KeybindingPoint).some(({ owner }) => owner.split("/")[0] === family),
      ).toBe(false);
      Effect.runSync(syncPlugins(kernel, [...CORE_UI_PLUGINS, ...ALWAYS_ON]));
      expect(
        kernel
          .contributions(KeybindingPoint)
          .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ).toEqual(before.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    }
  });

  it("keeps installed page-only contributions live without inventing registry authority", () => {
    const kernel = kernelWithBuiltins();
    const extension = definePlugin({
      name: "installed",
      apply: (ctx) =>
        ctx.contribute(KeybindingPoint, {
          id: "page-only",
          value: {
            context: "core.page",
            chord: { physicalKey: "F8", mod: true },
            run: { command: "installed.command" },
          },
        }),
    });
    Effect.runSync(kernel.load(extension));
    expect(
      kernel.contributions(KeybindingPoint).find(({ id }) => id === "installed.page-only"),
    ).toMatchObject({ owner: "installed" });
    const keymaps = admitKeymaps(
      kernel.contributions(KeyContextPoint).map(keyContextOf),
      kernel.contributions(KeybindingPoint),
      () => false,
    );
    expect(
      keymaps.get("core.page")?.resolve({ key: "F8", physicalKey: "F8", ctrlKey: true })?.id,
    ).toBe("installed.page-only");
    Effect.runSync(kernel.unload("installed"));
    expect(
      kernel.contributions(KeybindingPoint).some(({ id }) => id === "installed.page-only"),
    ).toBe(false);
    Effect.runSync(kernel.load(extension));
    expect(
      kernel.contributions(KeybindingPoint).filter(({ id }) => id === "installed.page-only"),
    ).toHaveLength(1);
  });
});

const groupOf = (binding: Contribution<Keybinding>) =>
  present(binding.value.shortcut, "native shortcut description");

describe("shipped keybinding data", () => {
  it("derives exactly one graph description for every runtime default from the same declaration", () => {
    const graph = new Map(bundledSeed("2026-11-11T00:00:00.000Z").map((node) => [node.id, node]));
    const kernel = kernelWithBuiltins();
    const bindings = kernel.contributions(KeybindingPoint);
    const familyOf = (binding: (typeof bindings)[number]) =>
      present(kernel.provenance(binding.owner), "loaded native owner").root;
    const ids = [...new Set(bindings.map(groupOf))];
    const descriptions = [...graph.values()].filter(
      (node) =>
        node.props["sys.f.type"]?.some(
          (value) => value.t === "ref" && value.v === SHORTCUT_IDS.tag,
        ) === true,
    );
    expect(descriptions.map(({ id }) => id).toSorted()).toEqual(ids.toSorted());
    expect(graph.get(SHORTCUT_IDS.parent)?.children.toSorted()).toEqual(ids.toSorted());
    for (const binding of bindings) {
      const row = graph.get(groupOf(binding));
      expect(binding.value.shortcut, binding.id).toBe(row?.id);
      for (const text of row?.props[SHORTCUT_IDS.keys] ?? [])
        expect(text.t === "str" && !text.v.startsWith("{")).toBe(true);
      if (binding.id === "core.page.palette")
        expect(row?.props[SHORTCUT_IDS.keys]).toEqual([{ t: "str", v: "Mod-K" }]);
      if (binding.id === "outline.editing.soft-break")
        expect(row?.props[SHORTCUT_IDS.keys]).toEqual([{ t: "str", v: "Shift-Enter" }]);
      if ("intent" in binding.value.run)
        expect(graph.get(extensionNodeId(familyOf(binding)))?.children).toContain(
          keyTargetNodeId(familyOf(binding), binding.value.context, binding.value.run),
        );
      const chords = row?.props[SHORTCUT_IDS.keys]?.map((value) =>
        value.t === "str" ? chordFromText(value.v) : null,
      );
      expect(chords, binding.id).toContainEqual(chordData(binding.value.chord));
      expect(row?.props[SHORTCUT_IDS.runs]).toEqual([
        {
          t: "ref",
          v: keyTargetNodeId(familyOf(binding), binding.value.context, binding.value.run),
        },
      ]);
      expect(
        graph.has(keyTargetNodeId(familyOf(binding), binding.value.context, binding.value.run)),
      ).toBe(true);
    }
  });
  it("round-trips every loaded binding without losing constraints or matching behavior", () => {
    const bindings = kernelWithBuiltins().contributions(KeybindingPoint);
    expect(bindings.length).toBeGreaterThan(100);
    const read = Schema.decodeUnknownSync(ChordDataSchema);
    for (const {
      id,
      value: { chord },
    } of bindings) {
      const stored: unknown = JSON.parse(JSON.stringify(chord));
      const decoded = read(stored);
      const textDecoded = chordFromText(chordToText(chord));
      expect(textDecoded, id).toEqual(chordData(chord));
      if (textDecoded === null) throw new Error(`Missing text chord: ${id}`);
      // Matching alone cannot notice a callback JSON serialization discarded.
      expect(decoded, id).toEqual(chord);
      const keys = new Set([
        "a",
        "A",
        "o",
        "O",
        " ",
        "ø",
        "Enter",
        "Escape",
        "ArrowUp",
        ...(typeof chord.key === "string"
          ? [chord.key]
          : Array.isArray(chord.key)
            ? chord.key
            : []),
      ]);
      for (const key of keys) {
        for (const physicalKey of new Set(["KeyA", "Enter", "NumpadEnter", chord.physicalKey])) {
          for (let flags = 0; flags < 16; flags++) {
            const event: KeyChordEvent = {
              key,
              ...(physicalKey === undefined ? {} : { physicalKey }),
              metaKey: (flags & 1) !== 0,
              ctrlKey: (flags & 2) !== 0,
              shiftKey: (flags & 4) !== 0,
              altKey: (flags & 8) !== 0,
            };
            expect(matchesChord(event, decoded), id).toBe(matchesChord(event, chord));
            expect(matchesChord(event, textDecoded), id).toBe(matchesChord(event, chord));
          }
        }
      }
    }
  });
});

describe("built-in routes", () => {
  it("match the canvas, graph and home paths", () => {
    expect(route("/canvas")).toEqual({ surface: "canvas.list", params: {} });
    expect(route("/canvas/abc")).toEqual({ surface: "canvas.page", params: { id: "abc" } });
    expect(route("/graph")).toEqual({ surface: "graph.page", params: {} });
    expect(route("/graph/p%201")).toEqual({
      surface: "graph.page",
      params: { perspective: "p 1" },
    });
    // The home is core's, whatever view draws it: the outline, while it is loaded.
    expect(route("/")).toEqual({ surface: "layout.home", params: {} });
    expect(route("/outline/n.a")).toEqual({ surface: "layout.home", params: {} });
  });

  it("match the ontology list, page, outline and graph views", () => {
    expect(route("/o")?.surface).toBe("ontology.list");
    expect(route("/o/")?.surface).toBe("ontology.list");
    expect(route("/o/abc")).toEqual({
      surface: "ontology.scope",
      params: { id: "abc", view: "page" },
    });
    expect(route("/o/abc/")?.params).toEqual({ id: "abc", view: "page" });
    expect(route("/o/abc/outline")?.params).toEqual({ id: "abc", view: "outline" });
    expect(route("/o/abc/graph")?.params).toEqual({ id: "abc", view: "graph" });
    expect(route("/o/a%2Fb")?.params).toEqual({ id: "a/b", view: "page" });
  });

  it("leave unknown sub-views and deeper paths unowned, which is not found", () => {
    expect(route("/")?.surface).toBe("layout.home");
    expect(route("/o/abc/schema")).toBeNull();
    expect(route("/o/abc/graph/extra")).toBeNull();
    expect(route("/other")).toBeNull();
  });

  it("round-trip an ontology through ontologyPath", () => {
    for (const view of ["page", "outline", "graph"] satisfies OntologyView[]) {
      expect(route(ontologyPath("a b", view))?.params).toEqual({ id: "a b", view });
    }
  });

  it("each lead to themselves from one sidebar section, in order", () => {
    const sections = kernelWithBuiltins()
      .contributions(SidebarSectionPoint)
      .toSorted((a, b) => a.value.order - b.value.order)
      .map((section) => section.id);
    expect(sections).toEqual([
      "layout.home",
      "days.section",
      "graph.section",
      "ontology.section",
      "canvas.section",
      "outline.pinned",
      "locations.section",
    ]);
  });

  it("each render a registered view that offers the page placement", () => {
    const kernel = kernelWithBuiltins();
    const paths = ["/", "/graph", "/o", "/o/abc/graph", "/canvas", "/canvas/abc"];
    for (const path of paths) {
      const matched = matchRoute(kernel.contributions(RoutePoint), path);
      expect(matched, path).not.toBeNull();
      expect(
        findView(kernel, matched?.view ?? viewKey("none.none", "None", NoParams))?.placements,
      ).toContain("page");
    }
  });

  it("disappear with the plugin that contributed them", () => {
    const kernel = kernelWithBuiltins();
    Effect.runSync(kernel.unload("canvas"));
    expect(matchRoute(kernel.contributions(RoutePoint), "/canvas/abc")).toBeNull();
    expect(kernel.contributions(SidebarSectionPoint).map((s) => s.id)).not.toContain(
      "canvas.section",
    );
  });
});

/** Every bundled family as a server reports it, each loaded or not as `loaded` says. */
function reported(loaded: (name: string) => boolean): ExtensionRow[] {
  return BUNDLED_FAMILIES.map((declaration) =>
    extensionRow(declaration, "bundled", loaded(declaration.name)),
  );
}

describe("the families the page loads", () => {
  const AGENT = extensionRow(agentExtension, "host", true);

  it("are each family the server reports loaded that the resolver has, in its order", () => {
    expect(familiesToLoad([...reported(() => true), AGENT])).toEqual([
      "governance",
      "outline",
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
      "themes",
      "zzz",
      "transistor",
      "yorha",
      "gallery",
      "days",
      "agent",
    ]);
  });

  it("leave out a family the server reports not loaded: the lab while it is off", () => {
    expect(labExtension.optional).toEqual({ byDefault: "off" });
    expect(familiesToLoad(reported((name) => name !== "lab"))).toEqual([
      "governance",
      "outline",
      "collections",
      "graph",
      "canvas",
      "code",
      "chart",
      "locations",
      "backdrops",
      "themes",
      "zzz",
      "transistor",
      "yorha",
      "gallery",
      "days",
    ]);
  });

  it("leave out a family the server does not report: the agent of a server that hosts none", () => {
    expect(familiesToLoad(reported(() => true))).not.toContain("agent");
    expect(familiesToLoad([...reported(() => true), { ...AGENT, enabled: false }])).not.toContain(
      "agent",
    );
  });

  it("leave out a family the page has no browser entry for", () => {
    const rows = [
      ...reported(() => true),
      extensionRow({ name: "remote", label: "R" }, { source: "x", origin: { kind: "own" } }, true),
    ];
    expect(familiesToLoad(rows)).toEqual([
      "governance",
      "outline",
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
      "themes",
      "zzz",
      "transistor",
      "yorha",
      "gallery",
      "days",
    ]);
  });

  it("load each entry under the name it was resolved by", async () => {
    for (const [name, extension] of Object.entries(BROWSER_EXTENSIONS)) {
      if (extension !== null) expect((await extension.load()).name).toBe(name);
    }
  });
});

/** Every family kb declares: the registry's bundled ones, and those a host composes. */
// GAP [[01M53M9Y6BZFMT08EHNRNFG7Y9]] no one coverage property holds every family to all three hosts
const EVERY_FAMILY = [...BUNDLED_FAMILIES, ...HOSTED_FAMILIES];

describe("the resolver", () => {
  it("names every family, bundled or hosted: an entry, or null for one with no browser half", () => {
    const missing = EVERY_FAMILY.filter(({ name }) => !Object.hasOwn(BROWSER_EXTENSIONS, name));
    expect(missing.map(({ name }) => name)).toEqual([]);
  });

  it("has an entry for every family that provides a view, since the page draws its views", () => {
    const viewless = EVERY_FAMILY.filter(({ views }) => (views ?? []).length > 0).filter(
      ({ name }) => BROWSER_EXTENSIONS[name] === null,
    );
    expect(viewless.map(({ name }) => name)).toEqual([]);
  });

  it("declares exactly the server-only families as having no browser half", () => {
    const serverOnly = Object.entries(BROWSER_EXTENSIONS)
      .filter(([, extension]) => extension === null)
      .map(([name]) => name);
    expect(serverOnly.toSorted()).toEqual(["check", "docs"]);
  });

  it("names nothing beyond the families kb declares", () => {
    const known = new Set(EVERY_FAMILY.map(({ name }) => name));
    expect(Object.keys(BROWSER_EXTENSIONS).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe("an optional family switched off on the server", () => {
  const SWITCHABLE = [...BUNDLED_FAMILIES, agentExtension].filter(
    ({ name, optional }) => optional !== undefined && BROWSER_EXTENSIONS[name] !== null,
  );

  it("is any family that can be switched and has a browser half", () => {
    expect(SWITCHABLE.map(({ name }) => name)).toEqual([
      "outline",
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
      "themes",
      "zzz",
      "transistor",
      "yorha",
      "gallery",
      "days",
      "agent",
    ]);
  });

  for (const family of SWITCHABLE) {
    it(`${family.name}: the page drops its browser half and everything it contributed, and takes it back when switched on`, async () => {
      const kernel = makeKernel({ host: "page" });
      for (const on of [true, false, true]) {
        const rows = [
          ...reported((name) => name !== family.name || on),
          extensionRow(agentExtension, "host", agentExtension.name !== family.name || on),
        ];
        const entries = await Promise.all(
          familiesToLoad(rows).flatMap((name) => BROWSER_EXTENSIONS[name]?.load() ?? []),
        );
        const failures = await Effect.runPromise(
          syncPlugins(kernel, [...CORE_UI_PLUGINS, ...entries]),
        );
        expect(failures).toEqual([]);
        expect({ on, holds: pageFootprint(family.name, kernel).length > 0 }).toEqual({
          on,
          holds: on,
        });
      }
      await Effect.runPromise(kernel.shutdown);
    });
  }

  it("the lab, on, shows every study while the graph is off but Sky, which reads the graph", async () => {
    const kernel = makeKernel({ host: "page" });
    for (const graphOn of [false, true]) {
      const rows = reported((name) => name !== "graph" || graphOn);
      const entries = await Promise.all(
        familiesToLoad(rows).flatMap((name) => BROWSER_EXTENSIONS[name]?.load() ?? []),
      );
      const failures = await Effect.runPromise(
        syncPlugins(kernel, [...CORE_UI_PLUGINS, ...entries]),
      );
      expect(failures).toEqual([]);
      expect(pageFootprint("lab", kernel).length).toBeGreaterThan(0);
      const offered = kernel.contributions(LabStudyPoint).map(({ value }) => value.scene);
      const graphStudies = LAB_SCENE_IDS.filter((id) => LAB_STUDIES[id].readsGraph === true);
      expect(graphStudies).toEqual(["sky"]);
      expect(offered.toSorted()).toEqual(
        LAB_SCENE_IDS.filter((id) => graphOn || id !== "sky").toSorted(),
      );
    }
    await Effect.runPromise(kernel.shutdown);
  });
});

describe("a family's footprint on the page", () => {
  it("is what its browser entry, children included, holds in the page kernel, each row from the page", () => {
    const kernel = kernelWithBuiltins();
    for (const name of familiesToLoad(reported(() => true))) {
      const rows = pageFootprint(name, kernel);
      expect({ name, rows: rows.map(({ kind, id }) => [kind, id]) }).toEqual({
        name,
        rows: kernel.contributionsOf(name).map(({ point, id }) => [point, id]),
      });
      expect(rows.every((row) => row.family === name && row.source === "page" && row.enabled)).toBe(
        true,
      );
    }
    // The canvas's page half: its routes, its sidebar section and its views.
    const canvas = pageFootprint("canvas", kernel).map(({ kind, id }) => `${kind} ${id}`);
    expect(canvas).toContain("ui.routes canvas.page");
    expect(canvas).toContain("ui.sidebar canvas.section");
    Effect.runSync(kernel.unload("canvas"));
    expect(pageFootprint("canvas", kernel)).toEqual([]);
  });
});

it("refuses an unknown replacement before attempting the page import", async () => {
  await expect(
    importPageHalf("/this-module-must-not-be-imported.js", "hijack", {
      digest: "test-code",
      manifest: {
        replaces: [{ role: "ui.host", why: "take host" }],
        capabilities: { page: "full" },
      },
    }),
  ).rejects.toThrow("no replaceable role");
});

it("refuses unsupported native point requests before attempting the page import", async () => {
  for (const point of ["kb.future", "ui.future", "outline.future"])
    await expect(
      importPageHalf("/this-module-must-not-be-imported.js", "consumer", {
        digest: "test-code",
        manifest: { uses: [{ point, kernel: "page" }], capabilities: { page: "full" } },
      }),
    ).rejects.toThrow("no point declared");
});
