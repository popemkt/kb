/**
 * The theme-family contract (DESIGN-UI.md → Themes): a whole theme is one
 * family's, its design system with its art and the page heads it brings.
 * Every family that brings one, each bundled one and a test family declared
 * and contributed like them, holds to the same promises, so a theme family
 * kb adds is checked with no list to update:
 *
 * - its system pairs with one of its own heads, and each head belongs to
 *   its system (both data its declaration seeds);
 * - its browser half contributes exactly the system and the heads it
 *   declares, the system with its art, and so the Settings gallery offers it;
 * - switched off alone, it takes its system and its heads with it and
 *   leaves every other family's;
 * - a store that chose any id it retired chooses its replacement on open.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import {
  NO_SWITCHES,
  declarationPlugin,
  defineExtension,
  familyOn,
  type ExtensionDeclaration,
} from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  SYSTEM_IDS,
  declaredIdOf,
  ensureSystemSeed,
  foldSeed,
  retiredOption,
  themeBackdrop,
  themeSystem,
  type DeclaredOptions,
  type KbNode,
} from "@kb/model";
import { definePlugin, makeKernel, syncPlugins, type Plugin } from "@kb/plugin";
import { BackdropPoint, DesignSystemPoint, provideBackdrop, provideDesignSystem } from "@kb/ui-sdk";
import { BROWSER_EXTENSIONS } from "@/ui-plugins";

/** A theme family of the test's own, declared and contributed as the bundled ones are. */
const PROBE_SYSTEM = themeSystem("probe.theme", "Probe", "probe.head", {
  intensity: "subtle",
  style: "clean",
  speed: "normal",
  effects: {},
});
const PROBE_HEAD = themeBackdrop("probe.head", "Probe head", PROBE_SYSTEM.id);
const probeExtension = defineExtension({
  name: "probe",
  label: "Probe",
  tags: ["themes"],
  optional: { byDefault: "on" },
  declaredOptions: [
    { kind: DESIGN_SYSTEM_OPTIONS, options: [PROBE_SYSTEM] },
    { kind: BACKDROP_OPTIONS, options: [PROBE_HEAD] },
  ],
  retires: [
    retiredOption(DESIGN_SYSTEM_OPTIONS, "themes.probe", PROBE_SYSTEM.id),
    retiredOption(BACKDROP_OPTIONS, "themes.probe-head", PROBE_HEAD.id),
  ],
});
const Nothing = () => null;
const probeUiPlugin = definePlugin({
  name: probeExtension.name,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(declarationPlugin(probeExtension)),
        ctx.contribute(
          DesignSystemPoint,
          provideDesignSystem(PROBE_SYSTEM, { stylesheet: "", Art: Nothing }),
        ),
        ctx.contribute(
          BackdropPoint,
          provideBackdrop(PROBE_HEAD, {
            presentation: {
              space: 160,
              directions: [],
              height: 180,
              span: { reach: "content", maxWidth: 1080 },
              offset: -10,
              opacity: { subtle: 0.72, soft: 0.86, vivid: 1 },
            },
            Component: Nothing,
          }),
        ),
      ],
      { discard: true },
    ),
});

/** The options of `kind` that `declaration` declares. */
const declared = (declaration: ExtensionDeclaration, kind: DeclaredOptions) =>
  (declaration.declaredOptions ?? [])
    .filter((set) => set.kind === kind)
    .flatMap((set) => set.options);

/** A family that brings a whole theme: a design system that pairs with a head. */
const bringsTheme = (declaration: ExtensionDeclaration) =>
  declared(declaration, DESIGN_SYSTEM_OPTIONS).some((option) =>
    (option.chooses ?? []).some((ref) => ref.kind === BACKDROP_OPTIONS),
  );

/** Every family's page entry, on in a store with no switch written, and the probe's. */
const ENTRIES: ReadonlyMap<string, Plugin> = new Map([
  ...(await Promise.all(
    BUNDLED_FAMILIES.filter((family) => familyOn(family, NO_SWITCHES, () => {})).flatMap(
      (family) =>
        BROWSER_EXTENSIONS[family.name]?.load().then((plugin) => [family.name, plugin] as const) ??
        [],
    ),
  )),
  [probeExtension.name, probeUiPlugin] as const,
]);

const THEME_FAMILIES = [...BUNDLED_FAMILIES, probeExtension].filter(bringsTheme);

const byId = (a: string, b: string) => a.localeCompare(b);

/** The design systems' and the heads' ids `plugins` contribute. */
function contributedBy(plugins: readonly Plugin[]) {
  const kernel = makeKernel();
  Effect.runSync(syncPlugins(kernel, plugins));
  return {
    systems: kernel.contributions(DesignSystemPoint).map(({ value }) => value.key.id),
    heads: kernel.contributions(BackdropPoint).map(({ value }) => value.key.id),
    art: kernel
      .contributions(DesignSystemPoint)
      .filter(({ value }) => value.Art !== undefined)
      .map(({ value }) => value.key.id),
  };
}

const SEED = foldSeed([...BUNDLED_DECLARATIONS, probeExtension], "2026-01-01T00:00:00.000Z");

describe("the theme-family contract", () => {
  it("holds the bundled theme families and the probe", () => {
    expect(THEME_FAMILIES.map(({ name }) => name)).toEqual(["zzz", "transistor", "yorha", "probe"]);
  });

  for (const family of THEME_FAMILIES) {
    const systems = declared(family, DESIGN_SYSTEM_OPTIONS);
    const heads = declared(family, BACKDROP_OPTIONS);
    const entry = ENTRIES.get(family.name);

    describe(family.name, () => {
      it("pairs its system with a head of its own, and each head belongs to its system", () => {
        const own = new Set(heads.map(({ id }) => id));
        for (const system of systems) {
          const pairs = (system.chooses ?? []).filter((ref) => ref.kind === BACKDROP_OPTIONS);
          expect(pairs.map(({ id }) => own.has(id))).toEqual([true]);
        }
        for (const head of heads) {
          expect(head.chooses?.map(({ kind, id }) => [kind, id])).toEqual(
            systems.map(({ id }) => [DESIGN_SYSTEM_OPTIONS, id]),
          );
        }
      });

      it("contributes exactly the system, with its art, and the heads it declares", () => {
        expect(entry).toBeDefined();
        const own = contributedBy(entry === undefined ? [] : [entry]);
        expect(own.systems).toEqual(systems.map(({ id }) => id));
        expect(own.art).toEqual(own.systems);
        expect(own.heads.toSorted(byId)).toEqual(heads.map(({ id }) => id).toSorted(byId));
      });

      it("switched off alone, takes its system and heads and leaves every other family's", () => {
        const all = contributedBy([...ENTRIES.values()]);
        const without = contributedBy(
          [...ENTRIES].filter(([name]) => name !== family.name).map(([, plugin]) => plugin),
        );
        expect(all.systems.filter((id) => !without.systems.includes(id))).toEqual(
          systems.map(({ id }) => id),
        );
        expect(all.heads.filter((id) => !without.heads.includes(id)).toSorted(byId)).toEqual(
          heads.map(({ id }) => id).toSorted(byId),
        );
        expect(without.systems.every((id) => all.systems.includes(id))).toBe(true);
      });

      it("remaps every id it retired, in a store that chose it, to its replacement", () => {
        const rows = family.retires ?? [];
        expect(rows.length).toBe(systems.length + heads.length);
        const chooser: KbNode = {
          id: "chooser",
          text: "chooses every retired id",
          props: {
            [SYSTEM_IDS.designSystemField]: rows
              .filter(({ from }) => declaredIdOf(DESIGN_SYSTEM_OPTIONS, from) !== undefined)
              .map(({ from }) => ({ t: "ref" as const, v: from })),
            [SYSTEM_IDS.backdropField]: rows
              .filter(({ from }) => declaredIdOf(BACKDROP_OPTIONS, from) !== undefined)
              .map(({ from }) => ({ t: "ref" as const, v: from })),
          },
          children: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const opened = ensureSystemSeed([...SEED.nodes, chooser], SEED).nodes;
        const after = opened.find(({ id }) => id === "chooser");
        const chosen = [
          ...(after?.props[SYSTEM_IDS.designSystemField] ?? []),
          ...(after?.props[SYSTEM_IDS.backdropField] ?? []),
        ].flatMap((value) => (value.t === "ref" ? [value.v] : []));
        const replacements = rows.flatMap(({ to }) => (to === undefined ? [] : [to]));
        expect(chosen.toSorted(byId)).toEqual(replacements.toSorted(byId));
      });
    });
  }
});
