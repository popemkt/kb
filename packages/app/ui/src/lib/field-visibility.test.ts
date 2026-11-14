import {
  isFieldHidden,
  resolveVisibleProps,
  wireToOutlineMap,
  type NodeMap,
  type SchemaIndex,
  schemaOfGraph,
} from "@kb/ui-sdk";
import { describe, expect, it } from "vitest";
import { present, type PropValue } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import { fixtureGraph } from "@/api/fixture-graph";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  return schemaOfGraph(nodes);
}

function mapFromFixture() {
  return wireToOutlineMap(fixtureGraph.nodes, new Set());
}

/** A field node's show option, as props. */
const show = (option: string): Record<string, PropValue[]> => ({
  "sys.f.show": [{ t: "ref", v: option }],
});

describe("field visibility", () => {
  it("hides the fields whose nodes say hidden, a system field's as much as a person's", () => {
    const nodes = mapFromFixture();
    const node = present(nodes.get("n.root-a"), "n.root-a");
    const visible = resolveVisibleProps(node, schemaFor(nodes));
    expect(visible.map((p) => p.fieldId)).toEqual(["field.status"]);
    expect(isFieldHidden("sys.f.type", schemaFor(nodes))).toBe(true);
    expect(isFieldHidden("sys.f.color", schemaFor(nodes))).toBe(false);
    expect(isFieldHidden("field.noisy", schemaFor(nodes))).toBe(true);
  });

  it("draws a hidden field a node's display reveals as any other, and leaves the rest hidden", () => {
    const nodes = mapFromFixture();
    const node = present(nodes.get("n.root-a"), "n.root-a");
    const revealed = resolveVisibleProps(node, schemaFor(nodes), {
      revealed: new Set(["field.noisy"]),
    });
    const noisy = revealed.find((p) => p.fieldId === "field.noisy");
    expect(noisy?.debug).toBe(false);
    expect(revealed.map((p) => p.fieldId)).not.toContain("sys.f.type");
  });

  it("draws a system field its node does not hide, with no list in the page", () => {
    // The gap this closes: an allow-list of five sys fields decided what a
    // person saw, so a field's cardinality and inverse, which sys.field
    // templates, were hidden on every field page.
    const wire = [
      ...fixtureGraph.nodes.filter((n) => n.id !== "sys.field"),
      ...bundledSeed("2026-10-21T00:00:00.000Z").filter((n) =>
        ["sys.field", "sys.f.cardinality", "sys.f.relation.inverse", "sys.f.query"].includes(n.id),
      ),
      {
        id: "n.with-query",
        text: "a query node",
        children: [],
        props: { "sys.f.query": [{ t: "str" as const, v: "[:find ?n :where [?n :node/id]]" }] },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const field = resolveVisibleProps(
      present(nodes.get("field.status"), "field.status"),
      schemaFor(nodes),
    );
    expect(field.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining(["sys.f.cardinality", "sys.f.relation.inverse"]),
    );
    // A query node's query is its builder's to draw: its field node says hidden.
    const query = present(nodes.get("n.with-query"), "n.with-query");
    expect(resolveVisibleProps(query, schemaFor(nodes)).map((p) => p.fieldId)).toEqual([]);
    expect(
      resolveVisibleProps(query, schemaFor(nodes), { showDebugFields: true }).find(
        (p) => p.fieldId === "sys.f.query",
      )?.debug,
    ).toBe(true);
  });

  it("reveals hidden + sys props in debug mode with debug flag", () => {
    const nodes = mapFromFixture();
    const node = present(nodes.get("n.root-a"), "n.root-a");
    const visible = resolveVisibleProps(node, schemaFor(nodes), { showDebugFields: true });
    expect(visible.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining(["sys.f.type", "field.status", "field.noisy"]),
    );
    const noisy = visible.find((p) => p.fieldId === "field.noisy");
    expect(noisy?.debug).toBe(true);
    const type = visible.find((p) => p.fieldId === "sys.f.type");
    expect(type?.debug).toBe(true);
  });

  it("surfaces a supertag's fields on its members even when unset", () => {
    // The gap this closes: the rule used to consult only sys.tag's template,
    // and only for tag nodes, so adding a field to a supertag changed nothing
    // visible on anything tagged with it until someone set a value by hand.
    const wire = [
      ...fixtureGraph.nodes.filter((n) => n.id !== "tag.todo" && n.id !== "n.root-b"),
      {
        ...present(
          fixtureGraph.nodes.find((n) => n.id === "tag.todo"),
          "tag.todo",
        ),
        props: {
          "sys.f.type": [{ t: "ref" as const, v: "sys.tag" }],
          "sys.f.fields": [{ t: "ref" as const, v: "field.status" }],
        },
      },
      {
        id: "n.member",
        text: "tagged member",
        children: [],
        props: { "sys.f.type": [{ t: "ref" as const, v: "tag.todo" }] },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const visible = resolveVisibleProps(
      present(nodes.get("n.member"), "n.member"),
      schemaFor(nodes),
    );

    const status = present(
      visible.find((p) => p.fieldId === "field.status"),
      "field.status",
    );
    expect(status.empty).toBe(true);
    expect(status.values).toEqual([]);
  });

  it("surfaces a field node's own type and constraints, so no panel is needed", () => {
    // sys.field templates fieldType/targetTag/targetQuery, and the same rule
    // that serves tags serves field pages — which is what replaced the bespoke
    // FieldTypeConfig panel.
    const wire = [
      ...fixtureGraph.nodes,
      {
        id: "sys.field",
        text: "sys.field",
        children: [],
        props: {
          "sys.f.fields": [
            { t: "ref" as const, v: "sys.f.fieldType" },
            { t: "ref" as const, v: "sys.f.targetTag" },
            { t: "ref" as const, v: "sys.f.targetQuery" },
          ],
        },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const visible = resolveVisibleProps(
      present(nodes.get("field.status"), "field.status"),
      schemaFor(nodes),
    );
    expect(visible.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining(["sys.f.fieldType", "sys.f.targetTag", "sys.f.targetQuery"]),
    );
  });

  it("surfaces the color template slot on tag nodes even when unset", () => {
    const nodes = mapFromFixture();
    const tag = present(nodes.get("tag.todo"), "tag.todo");
    const visible = resolveVisibleProps(tag, schemaFor(nodes));
    expect(visible.map((p) => p.fieldId)).toEqual(expect.arrayContaining(["sys.f.color"]));
  });

  describe("show and pinned (DESIGN.md → Data model → field display)", () => {
    const at = "";
    const fieldNode = (id: string, props: Record<string, PropValue[]> = {}) => ({
      id,
      text: id,
      children: [],
      props: { "sys.f.type": [{ t: "ref" as const, v: "sys.field" }], ...props },
      createdAt: at,
      updatedAt: at,
    });
    const pinned: Record<string, PropValue[]> = { "sys.f.pinned": [{ t: "bool", v: true }] };
    const graph = (member: Record<string, PropValue[]>) =>
      wireToOutlineMap(
        [
          fieldNode("sys.f.type", show("sys.show.never")),
          fieldNode("f.plain"),
          fieldNode("f.filled", show("sys.show.filled")),
          fieldNode("f.never", show("sys.show.never")),
          fieldNode("f.pinned", pinned),
          {
            id: "t.task",
            text: "task",
            children: [],
            props: {
              "sys.f.type": [{ t: "ref" as const, v: "sys.tag" }],
              "sys.f.fields": ["f.plain", "f.filled", "f.never", "f.pinned"].map((v) => ({
                t: "ref" as const,
                v,
              })),
            },
            createdAt: at,
            updatedAt: at,
          },
          {
            id: "n.task",
            text: "a task",
            children: [],
            props: { "sys.f.type": [{ t: "ref" as const, v: "t.task" }], ...member },
            createdAt: at,
            updatedAt: at,
          },
        ],
        new Set(),
      );
    const resolve = (member: Record<string, PropValue[]>, debug = false) => {
      const nodes = graph(member);
      return resolveVisibleProps(present(nodes.get("n.task"), "n.task"), schemaFor(nodes), {
        showDebugFields: debug,
      });
    };

    it("puts pinned fields first, the rest in template order, and leaves out never", () => {
      expect(resolve({}).map((p) => p.fieldId)).toEqual(["f.pinned", "f.plain", "f.filled"]);
    });

    it("folds an empty field shown when filled, and draws it once it holds a value", () => {
      expect(resolve({}).find((p) => p.fieldId === "f.filled")?.folded).toBe(true);
      const filled = resolve({ "f.filled": [{ t: "str", v: "x" }] }).find(
        (p) => p.fieldId === "f.filled",
      );
      expect(filled?.folded).toBeUndefined();
      expect(filled?.values).toEqual([{ t: "str", v: "x" }]);
    });

    it("folds nothing while debug fields show, and draws never as a debug row", () => {
      const debug = resolve({ "f.never": [{ t: "str", v: "y" }] }, true);
      expect(debug.some((p) => p.folded === true)).toBe(false);
      expect(debug.find((p) => p.fieldId === "f.never")?.debug).toBe(true);
    });

    it("reads hidden as show never, and an absent or unknown show as always", () => {
      const nodes = graph({});
      expect(isFieldHidden("f.never", schemaFor(nodes))).toBe(true);
      expect(isFieldHidden("f.filled", schemaFor(nodes))).toBe(false);
      expect(isFieldHidden("f.plain", schemaFor(nodes))).toBe(false);
    });
  });
});
