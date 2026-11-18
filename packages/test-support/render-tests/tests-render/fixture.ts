import { SYSTEM_IDS, viewOptionId } from "@kb/model";

const LEAF_IDS = Array.from({ length: 28 }, (_, index) => `render.fixture.node.${index + 1}`);
const ROOT_ID = "render.fixture.root";
const PERSPECTIVE_ID = "lens.all-mentions";
const LENS_TAG_ID = "render.fixture.tag";

/** The lens belongs to this fixture. Application seed changes must not move its layout. */
const LENS_IDS = [ROOT_ID, ...LEAF_IDS, PERSPECTIVE_ID];
const members = LENS_IDS.map((id) => `[?n :node/id ${JSON.stringify(id)}]`).join(" ");
const LENS_QUERY = `[:find ?id :where (or ${members}) [?n :node/id ?id]]`;
export const FIXTURE_SIZE = LENS_IDS.length;

type PropValue = { t: "str" | "ref" | "num"; v: string | number };

export interface FixtureNode {
  id: string;
  text: string;
  children: string[];
  order: string;
  props: Record<string, PropValue[]>;
  createdAt: string;
  updatedAt: string;
}

/** Every fixture and seed node is stamped with this, so the store is the same on every run. */
export const FIXTURE_TIMESTAMP = "2026-08-24T00:00:00.000Z";

function node(
  id: string,
  text: string,
  children: string[] = [],
  props: Record<string, PropValue[]> = {},
): FixtureNode {
  return {
    id,
    text,
    children,
    order: id,
    props,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

/**
 * A stable single-cluster graph with one root and its 28 children. Keeping `cluster-by` at
 * `none` matches the production failure that used to collapse ForceGraph3D.
 * The perspective is intentionally part of its own lens: it remains editable
 * when renderer switching persists to this scratch data root. Its `max-nodes`
 * is the lens population, so no spec runs against a capped graph.
 */
export function renderFixtureNodes(): FixtureNode[] {
  const leaves = LEAF_IDS.map((id, index) =>
    node(id, `Fixture node ${index + 1} [[${ROOT_ID}|fixture root]]`, [], {}),
  );

  return [
    node(ROOT_ID, "Fixture root", LEAF_IDS),
    ...leaves,
    // A tag of its own, so a legend has one category to toggle (the graph
    // elides the tag node itself).
    node(LENS_TAG_ID, "lens", [], { "sys.f.type": [{ t: "ref", v: "sys.tag" }] }),
    // Preserve the seed id so opening the scratch root does not add a second
    // default graph beside this fixture. A graph view node: its view is the
    // 2D renderer.
    node(PERSPECTIVE_ID, "Render fixture", [], {
      "sys.f.type": [{ t: "ref", v: LENS_TAG_ID }],
      "sys.f.view": [{ t: "ref", v: viewOptionId("graph.force2d") }],
      "sys.f.lens.edge-kinds": [
        { t: "str", v: "mention" },
        { t: "str", v: "child" },
      ],
      "sys.f.lens.cluster-by": [{ t: "str", v: "none" }],
      [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: LENS_QUERY }],
      "sys.f.lens.max-nodes": [{ t: "num", v: FIXTURE_SIZE }],
    }),
  ];
}
