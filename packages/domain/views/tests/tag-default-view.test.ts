/**
 * A tag's default view type (DESIGN.md → View nodes): a node that names no
 * view opens in its tags' default before the store's, the canvas family
 * claims `#canvas`'s, a person may change it on the tag node, and a family
 * switched off leaves the node to the store's default, never an error.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import {
  SYSTEM_IDS,
  foldSeed,
  isWritableField,
  present,
  viewOptionId,
  type KbNode,
  type NodeProps,
  type SeedSource,
} from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import {
  HomeView,
  OutlineSnippetView,
  OutlineView,
  nodeOpenings,
  resolveNodeView,
  viewCatalogOf,
} from "@kb/views";

const AT = "2026-10-31T00:00:00.000Z";
const CANVAS_TAG = "sys.tag.canvas";
const CANVAS_PAGE = "canvas.page";

const catalog = viewCatalogOf(
  BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []),
);
/** The bundled catalog with the canvas family switched off. */
const canvasOff = viewCatalogOf(
  BUNDLED_DECLARATIONS.filter((declaration) => declaration.name !== "canvas").flatMap(
    (declaration) => declaration.views ?? [],
  ),
);
const canvasKey = present(catalog.keyOf(CANVAS_PAGE), "the canvas family provides canvas.page");

const ref = (v: string) => [{ t: "ref" as const, v }];
const tagged = (...tags: string[]): NodeProps => ({
  [SYSTEM_IDS.typeField]: tags.map((v) => ({ t: "ref" as const, v })),
});

/** The bundled seed as a graph, with `extra` nodes over it. */
function graphOf(extra: Record<string, NodeProps> = {}) {
  const graph = new Map<string, { props: NodeProps; text?: string }>(
    bundledSeed(AT).map((node) => [node.id, { props: node.props, text: node.text }]),
  );
  for (const [id, props] of Object.entries(extra)) graph.set(id, { props, text: id });
  return graph;
}

/** `graph` with tag `tag`'s default view type set to `option`. */
function withTagDefault(graph: ReturnType<typeof graphOf>, tag: string, option: string) {
  const node = present(graph.get(tag), `the graph holds ${tag}`);
  return new Map([
    ...graph,
    [tag, { ...node, props: { ...node.props, [SYSTEM_IDS.viewDefaultField]: ref(option) } }],
  ]);
}

function open(
  graph: ReturnType<typeof graphOf>,
  node: string,
  on: Parameters<typeof resolveNodeView>[1] = catalog,
) {
  const warnings: string[] = [];
  const target = resolveNodeView(
    { node },
    on,
    (id) => graph.get(id),
    (w) => warnings.push(w),
  );
  return { target, warnings };
}

describe("a tag's default view type", () => {
  test("the seed names #canvas's: a canvas node opens in its canvas", () => {
    const graph = graphOf({ "n.board": tagged(CANVAS_TAG) });
    expect(graph.get(CANVAS_TAG)?.props[SYSTEM_IDS.viewDefaultField]).toEqual(
      ref(viewOptionId(CANVAS_PAGE)),
    );
    expect(open(graph, "n.board")).toEqual({
      target: Result.succeed({ key: canvasKey, input: { id: "n.board" }, subject: "n.board" }),
      warnings: [],
    });
  });

  test("with its family off, the node opens in the store's default, quietly", () => {
    const graph = graphOf({ "n.board": tagged(CANVAS_TAG), "n.plain": {} });
    expect(open(graph, "n.board", canvasOff)).toEqual({
      target: Result.succeed({ key: OutlineView, input: { root: "n.board" }, subject: "n.board" }),
      warnings: [],
    });
  });

  test("a node's own view still comes first", () => {
    const graph = graphOf({
      "n.board": { ...tagged(CANVAS_TAG), [SYSTEM_IDS.viewsField]: ref("v.snippet") },
      "v.snippet": { [SYSTEM_IDS.viewField]: ref(OutlineSnippetView.option) },
    });
    const opened = Result.getOrThrow(open(graph, "n.board").target);
    expect(opened.key).toBe(OutlineSnippetView);
    expect("viewNode" in opened ? opened.viewNode : null).toBe("v.snippet");
  });

  test("a person's choice on the tag node is what its nodes open in", () => {
    const graph = withTagDefault(
      graphOf({ "n.board": tagged(CANVAS_TAG) }),
      CANVAS_TAG,
      OutlineSnippetView.option,
    );
    expect(Result.getOrThrow(open(graph, "n.board").target).key).toBe(OutlineSnippetView);
  });

  test("the first of a node's tags whose default is held wins, in the order it carries them", () => {
    const graph = withTagDefault(
      graphOf({
        "n.both": tagged("sys.tag.other", CANVAS_TAG),
        "sys.tag.other": tagged(SYSTEM_IDS.tag),
      }),
      "sys.tag.other",
      OutlineSnippetView.option,
    );
    expect(Result.getOrThrow(open(graph, "n.both").target).key).toBe(OutlineSnippetView);
    // The first tag's family off: the next tag's default.
    const snippetOff = viewCatalogOf(catalog.items.filter(({ key }) => key !== OutlineSnippetView));
    expect(Result.getOrThrow(open(graph, "n.both", snippetOff).target).key).toBe(canvasKey);
  });

  test("a tag default that is no view a node opens in is reported and passed over", () => {
    for (const option of [HomeView.option, "n.not-a-view"]) {
      const graph = withTagDefault(graphOf({ "n.board": tagged(CANVAS_TAG) }), CANVAS_TAG, option);
      const { target, warnings } = open(graph, "n.board");
      expect(Result.getOrThrow(target).key).toBe(OutlineView);
      expect(warnings).toEqual([
        `${CANVAS_TAG}'s default view type ${option} is no view a node opens in (${SYSTEM_IDS.viewDefaultField})`,
      ]);
    }
  });
});

/** The ways `node` opens over `graph` through catalog `on`, each without its key. */
function ways(graph: ReturnType<typeof graphOf>, node: string, on = catalog) {
  return nodeOpenings(node, on, (id) => graph.get(id)).map(({ key: _key, ...way }) => way);
}

describe("the ways a node opens", () => {
  test("a canvas lists its tag's default first among the view types, marked the default", () => {
    const listed = ways(graphOf({ "n.board": tagged(CANVAS_TAG) }), "n.board");
    expect(listed[0]).toEqual({ label: "Default view", default: false });
    expect(listed[1]).toEqual({
      view: viewOptionId(CANVAS_PAGE),
      label: "Canvas",
      tag: CANVAS_TAG,
      default: true,
    });
    const outline = listed.find(({ view }) => view === OutlineView.option);
    expect(outline).toEqual({
      view: OutlineView.option,
      label: OutlineView.label,
      default: false,
    });
  });

  test("with the canvas off, the outline is the default and no tag's is listed", () => {
    const listed = ways(graphOf({ "n.board": tagged(CANVAS_TAG) }), "n.board", canvasOff);
    expect(listed.filter(({ tag }) => tag !== undefined)).toEqual([]);
    expect(listed.filter(({ default: d }) => d).map(({ view }) => view)).toEqual([
      OutlineView.option,
    ]);
  });
});

/** A claim of `name`'s page on the shared tag. */
function claim(name: string) {
  return { "sys.tag.shared": { id: `${name}.page`, label: name } };
}

describe("a tag's default as data", () => {
  const source = (name: string, tagDefaultViews: SeedSource["tagDefaultViews"]): SeedSource => ({
    name,
    label: name,
    views: [{ key: { id: `${name}.page`, label: name } }],
    ...(tagDefaultViews === undefined ? {} : { tagDefaultViews }),
    seed: (at) =>
      name === "first"
        ? [
            {
              id: "sys.tag.shared",
              text: "shared",
              props: { [SYSTEM_IDS.typeField]: ref(SYSTEM_IDS.tag) },
              children: [],
              createdAt: at,
              updatedAt: at,
            } satisfies KbNode,
          ]
        : [],
  });
  const core = BUNDLED_DECLARATIONS.filter((declaration) => declaration.name === "core");

  test("the fold refuses a tag two sources claim, a tag it does not seed, and a view not their own", () => {
    expect(() =>
      foldSeed([...core, source("first", claim("first")), source("second", claim("second"))], AT),
    ).toThrow(/sys.tag.shared is provided twice \(first, second\)/);
    expect(() => foldSeed([...core, source("second", claim("second"))], AT)).toThrow(
      /which the seed does not hold/,
    );
    expect(() =>
      foldSeed(
        [...core, source("first", { "sys.tag.shared": { id: "other.page", label: "x" } })],
        AT,
      ),
    ).toThrow(/provides no such view/);
  });

  test("a tag's default is a person's to write on a seeded tag, and no other system node's", () => {
    const field = graphOf().get(SYSTEM_IDS.viewDefaultField);
    const canvasTag = present(graphOf().get(CANVAS_TAG), "seeded");
    expect(
      isWritableField(
        { id: CANVAS_TAG, props: canvasTag.props },
        SYSTEM_IDS.viewDefaultField,
        field,
      ),
    ).toBe(true);
    const views = present(graphOf().get(SYSTEM_IDS.viewsRoot), "seeded");
    expect(
      isWritableField(
        { id: SYSTEM_IDS.viewsRoot, props: views.props },
        SYSTEM_IDS.viewDefaultField,
        field,
      ),
    ).toBe(false);
  });

  test("every tag templates the field, so its row is there to set", () => {
    const tagKind = present(graphOf().get(SYSTEM_IDS.tag), "seeded");
    expect(tagKind.props[SYSTEM_IDS.fieldsField]).toContainEqual({
      t: "ref",
      v: SYSTEM_IDS.viewDefaultField,
    });
  });
});
