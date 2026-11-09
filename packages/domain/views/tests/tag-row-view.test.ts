/**
 * A tag's row view (DESIGN-UI.md → Row views), as data: a declaration
 * claims it for its tags (`tagRowViews`) and the fold writes it as the tag
 * node's `sys.f.view.row`, a rival claim on the same tag does not fold, and
 * the first of a node's tags naming one a host holds is the node's, read
 * apart from the view the node opens in.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  claimedTagViews,
  foldSeed,
  isWritableField,
  present,
  tagViewsOf,
  viewOptionId,
  type KbNode,
  type NodeProps,
  type SeedSource,
} from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { heldTagViewOf, ignoreReport, NoParams, viewCatalogOf, viewKey } from "@kb/views";

const AT = "2026-11-09T00:00:00.000Z";
const TAG = "notes.tag.callout";
const core = BUNDLED_DECLARATIONS.filter((declaration) => declaration.name === "core");

const ref = (v: string) => [{ t: "ref" as const, v }];

/** A source named `name` with a page and a row view of its own, seeding the tag when it is `notes`. */
function source(
  name: string,
  claims: Partial<Pick<SeedSource, "tagRowViews" | "tagDefaultViews">>,
) {
  return {
    name,
    label: name,
    views: [
      { key: { id: `${name}.page`, label: `${name} page` } },
      { key: { id: `${name}.row`, label: `${name} row` } },
    ],
    ...claims,
    seed: (at: string) =>
      name === "notes"
        ? [
            {
              id: TAG,
              text: "callout",
              props: { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) },
              children: [],
              createdAt: at,
              updatedAt: at,
            } satisfies KbNode,
          ]
        : [],
  } satisfies SeedSource;
}

/** A node carrying `tags`, in that order. */
function carrying(...tags: string[]): { props: NodeProps } {
  return { props: { [SYSTEM_IDS.typeField]: tags.map((v) => ({ t: "ref" as const, v })) } };
}

const row = (name: string) => ({ [TAG]: { id: `${name}.row`, label: `${name} row` } });
const page = (name: string) => ({ [TAG]: { id: `${name}.page`, label: `${name} page` } });

describe("a tag's row view as data", () => {
  test("the fold writes a claim as the tag's sys.f.view.row, beside its default view type", () => {
    const notes = source("notes", { tagRowViews: row("notes"), tagDefaultViews: page("notes") });
    expect(claimedTagViews(notes).map(({ role, tag }) => [role, tag])).toEqual([
      ["default", TAG],
      ["row", TAG],
    ]);
    const tag = foldSeed([...core, notes], AT).nodes.find((node) => node.id === TAG);
    expect(tag?.props[SYSTEM_IDS.viewRowField]).toEqual(ref(viewOptionId("notes.row")));
    expect(tag?.props[SYSTEM_IDS.viewDefaultField]).toEqual(ref(viewOptionId("notes.page")));
  });

  test("a tag two sources claim a row view for does not fold, nor one naming a view not its own", () => {
    expect(() =>
      foldSeed(
        [
          ...core,
          source("notes", { tagRowViews: row("notes") }),
          source("rival", { tagRowViews: row("rival") }),
        ],
        AT,
      ),
    ).toThrow(/the row view of notes\.tag\.callout is provided twice \(notes, rival\)/);
    expect(() =>
      foldSeed([...core, source("notes", { tagRowViews: row("elsewhere") })], AT),
    ).toThrow(/provides no such view/);
  });

  test("one source's row view and another's default view type on one tag both fold", () => {
    const folded = foldSeed(
      [
        ...core,
        source("notes", { tagRowViews: row("notes") }),
        source("pages", { tagDefaultViews: page("pages") }),
      ],
      AT,
    );
    const tag = folded.nodes.find((node) => node.id === TAG);
    expect(tag?.props[SYSTEM_IDS.viewRowField]).toEqual(ref(viewOptionId("notes.row")));
    expect(tag?.props[SYSTEM_IDS.viewDefaultField]).toEqual(ref(viewOptionId("pages.page")));
  });

  test("every tag templates the field, a person's to write on a seeded tag", () => {
    const seed = new Map(foldSeed(core, AT).nodes.map((node) => [node.id, node]));
    const field = seed.get(SYSTEM_IDS.viewRowField);
    expect(seed.get(SYSTEM_IDS.tag)?.props[SYSTEM_IDS.fieldsField]).toContainEqual({
      t: "ref",
      v: SYSTEM_IDS.viewRowField,
    });
    expect(
      isWritableField(
        { id: "sys.tag.any", props: { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) } },
        SYSTEM_IDS.viewRowField,
        field,
      ),
    ).toBe(true);
  });
});

describe("a node's row view", () => {
  const Row = viewKey("notes.row", "Callout", NoParams);
  const Other = viewKey("other.row", "Other", NoParams);
  const catalog = viewCatalogOf([{ key: Row }, { key: Other }]);
  const graph = new Map<string, { props: NodeProps }>([
    ["tag.plain", { props: { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) } }],
    ["tag.unheld", { props: { [SYSTEM_IDS.viewRowField]: ref(viewOptionId("gone.row")) } }],
    ["tag.callout", { props: { [SYSTEM_IDS.viewRowField]: ref(Row.option) } }],
    ["tag.other", { props: { [SYSTEM_IDS.viewRowField]: ref(Other.option) } }],
  ]);
  const lookup = (id: string) => graph.get(id);
  const keyOf = (view: string) => catalog.keyOf(view);

  test("is the first of its tags' row views the host holds, in the order it carries them", () => {
    const n = carrying("tag.plain", "tag.unheld", "tag.callout", "tag.other");
    expect(tagViewsOf(n, "row", lookup).map(({ tag }) => tag)).toEqual([
      "tag.unheld",
      "tag.callout",
      "tag.other",
    ]);
    expect(heldTagViewOf(n, "row", keyOf, lookup, ignoreReport)).toEqual({
      tag: "tag.callout",
      key: Row,
    });
  });

  test("is read apart from the view the node opens in", () => {
    const n = carrying("tag.callout");
    expect(tagViewsOf(n, "default", lookup)).toEqual([]);
    expect(heldTagViewOf(n, "default", keyOf, lookup, ignoreReport)).toBeNull();
    expect(present(heldTagViewOf(n, "row", keyOf, lookup, ignoreReport), "held").key).toBe(Row);
  });
});
