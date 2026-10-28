/**
 * One family per whole theme (DESIGN-UI.md → Themes; DESIGN.md → Extension
 * families → the seed retires what it renames). ZZZ, Transistor and YoRHa
 * were the themes family's, under `themes.*` ids, before each became a
 * family of its own; each retires its old ids, so a store that chose one
 * chooses its family's id when it is opened. `.kb/nodes.jsonl` is
 * committed and hosts pin different releases, so the table must also hold
 * when an older build meets a remapped store, and when such a store is
 * merged with a clone that was never remapped.
 *
 * The older build is rebuilt here from the families' own rows: the themes
 * family declaring every theme's options under the ids each family retires,
 * and no theme family, which is what kb folded before the split.
 */
import { describe, expect, test } from "bun:test";
import { defineExtension, type ExtensionDeclaration } from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  SYSTEM_IDS,
  backdropOptionId,
  declaredIdOf,
  declaredOptionId,
  designSystemOptionId,
  ensureSystemSeed,
  extensionNodeId,
  foldSeed,
  mergeNodeSets,
  present,
  type DeclaredOptions,
  type KbNode,
  type SeedOption,
} from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledFold } from "@kb/bundled";
import { themesExtension } from "@kb/themes";
import { transistorExtension } from "@kb/transistor";
import { yorhaExtension } from "@kb/yorha";
import { zzzExtension } from "@kb/zzz";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const THEME_FAMILIES: readonly ExtensionDeclaration[] = [
  zzzExtension,
  transistorExtension,
  yorhaExtension,
];

/** Each theme family's option ids, by the id it retired for each. */
const WAS = new Map(
  THEME_FAMILIES.flatMap(({ retires }) => (retires ?? []).map(({ from, to }) => [to, from])),
);

/** Every id a theme family retired. */
const WAS_FROM = new Set(WAS.values());

/** `id` of `kind` as the older build declared it. */
function before(kind: DeclaredOptions, id: string): string {
  const was = WAS.get(declaredOptionId(kind, id));
  return was === undefined ? id : present(declaredIdOf(kind, was), `the old id of ${id}`);
}

/** `option` of `kind` as the older build declared it: its id and what it chooses, renamed back. */
function optionBefore(kind: DeclaredOptions, option: SeedOption): SeedOption {
  return {
    ...option,
    id: before(kind, option.id),
    ...(option.chooses === undefined
      ? {}
      : { chooses: option.chooses.map((ref) => ({ ...ref, id: before(ref.kind, ref.id) })) }),
  };
}

/** Every option of `kind` the themes family and the theme families declare now. */
function declaredOf(kind: DeclaredOptions): SeedOption[] {
  return [themesExtension, ...THEME_FAMILIES].flatMap((declaration) =>
    (declaration.declaredOptions ?? [])
      .filter((set) => set.kind === kind)
      .flatMap((set) => set.options),
  );
}

/** The themes family before the split: every theme's options, under the old ids. */
const OLDER_THEMES = defineExtension({
  ...themesExtension,
  declaredOptions: [DESIGN_SYSTEM_OPTIONS, BACKDROP_OPTIONS].map((kind) => ({
    kind,
    options: declaredOf(kind).map((option) => optionBefore(kind, option)),
  })),
});

/** What the older build folds. */
const OLDER_FOLD = foldSeed(
  BUNDLED_DECLARATIONS.filter((declaration) => !THEME_FAMILIES.includes(declaration)).map(
    (declaration) => (declaration === themesExtension ? OLDER_THEMES : declaration),
  ),
  AT,
);
const NEWER_FOLD = bundledFold(AT);

const CORE = extensionNodeId("core");
/** A page of the owner's whose head chooses YoRHa's Arena. */
const PAGE = "page-with-arena";

/** `nodes` with core choosing `system` and the owner's page choosing the head `head`. */
function choosing(nodes: readonly KbNode[], system: string, head: string): KbNode[] {
  const page: KbNode = {
    id: PAGE,
    text: "A page",
    props: { [SYSTEM_IDS.backdropField]: [{ t: "ref", v: head }] },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  };
  return [
    ...nodes.map((node) =>
      node.id === CORE
        ? {
            ...node,
            props: {
              ...node.props,
              [SYSTEM_IDS.designSystemField]: [{ t: "ref" as const, v: system }],
            },
          }
        : node,
    ),
    page,
  ];
}

const refOf = (nodes: readonly KbNode[], id: string, field: string) =>
  nodes.find((node) => node.id === id)?.props[field];
const ids = (nodes: readonly KbNode[]) => new Set(nodes.map((node) => node.id));

/** A store an older build seeded, with YoRHa and its Arena chosen under their old ids. */
const OLDER_STORE = choosing(
  ensureSystemSeed([], OLDER_FOLD).nodes,
  designSystemOptionId("themes.yorha"),
  backdropOptionId("themes.arena"),
);

describe("one family per whole theme", () => {
  test("the older build is the themes family holding every theme, as the retired ids say", () => {
    const seeded = ids(OLDER_STORE);
    const rows = NEWER_FOLD.retired.filter((row) => WAS_FROM.has(row.from));
    expect(rows).toHaveLength(9);
    for (const { from, to } of rows) {
      expect(seeded.has(from)).toBe(true);
      expect(seeded.has(present(to, from))).toBe(false);
    }
  });

  test("a store that chose a theme by its themes.* id chooses its family's on open, then opening is a no-op", () => {
    const opened = ensureSystemSeed(OLDER_STORE, NEWER_FOLD);
    expect(refOf(opened.nodes, CORE, SYSTEM_IDS.designSystemField)).toEqual([
      { t: "ref", v: designSystemOptionId("yorha.theme") },
    ]);
    expect(refOf(opened.nodes, PAGE, SYSTEM_IDS.backdropField)).toEqual([
      { t: "ref", v: backdropOptionId("yorha.arena") },
    ]);
    expect([...ids(opened.nodes)].filter((id) => WAS_FROM.has(id))).toEqual([]);
    expect(opened.deletes.toSorted()).toEqual([...WAS_FROM].toSorted());

    const again = ensureSystemSeed(opened.nodes, NEWER_FOLD);
    expect(again.seeded).toBe(false);
    expect(again.deletes).toEqual([]);
  });

  test("an older build re-seeds the old options but writes no choice; the next newer open retires them again", () => {
    const remapped = ensureSystemSeed(OLDER_STORE, NEWER_FOLD).nodes;
    const older = ensureSystemSeed(remapped, OLDER_FOLD);
    expect(older.seeded).toBe(true);
    for (const id of WAS_FROM) expect(ids(older.nodes).has(id)).toBe(true);
    expect(refOf(older.nodes, CORE, SYSTEM_IDS.designSystemField)).toEqual([
      { t: "ref", v: designSystemOptionId("yorha.theme") },
    ]);
    expect(refOf(older.nodes, PAGE, SYSTEM_IDS.backdropField)).toEqual([
      { t: "ref", v: backdropOptionId("yorha.arena") },
    ]);

    const newer = ensureSystemSeed(older.nodes, NEWER_FOLD);
    expect(newer.deletes.toSorted()).toEqual([...WAS_FROM].toSorted());
    expect(refOf(newer.nodes, CORE, SYSTEM_IDS.designSystemField)).toEqual([
      { t: "ref", v: designSystemOptionId("yorha.theme") },
    ]);
    expect(ensureSystemSeed(newer.nodes, NEWER_FOLD).seeded).toBe(false);
  });

  test("a remapped store merged with a clone that never was converges on the next newer open", () => {
    const ours = ensureSystemSeed(OLDER_STORE, NEWER_FOLD).nodes;
    // The clone, still on the older build, chose ZZZ's Hollow for the page, later.
    const hollow = { t: "ref" as const, v: backdropOptionId("themes.hollow") };
    const theirs = OLDER_STORE.map((node) =>
      node.id === PAGE
        ? { ...node, props: { [SYSTEM_IDS.backdropField]: [hollow] }, updatedAt: LATER }
        : node,
    );
    const merged = mergeNodeSets(OLDER_STORE, ours, theirs);
    expect(merged.conflicts).toEqual([]);

    const opened = ensureSystemSeed(merged.nodes, NEWER_FOLD);
    expect([...ids(opened.nodes)].filter((id) => WAS_FROM.has(id))).toEqual([]);
    expect(refOf(opened.nodes, CORE, SYSTEM_IDS.designSystemField)).toEqual([
      { t: "ref", v: designSystemOptionId("yorha.theme") },
    ]);
    expect(refOf(opened.nodes, PAGE, SYSTEM_IDS.backdropField)).toEqual([
      { t: "ref", v: backdropOptionId("zzz.hollow") },
    ]);
    expect(ensureSystemSeed(opened.nodes, NEWER_FOLD).seeded).toBe(false);
  });
});
