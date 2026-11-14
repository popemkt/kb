/**
 * How a tag shapes the nodes it is on (DESIGN.md → Data model → tag
 * behaviours), read by `tag-behaviour.ts` and acted on by the write plans:
 * an add takes its parent's child tags, a gained tag fills its fields from
 * the node's ancestors, and a node is named by its kind's title.
 */
import { describe, expect, test } from "bun:test";
import {
  IndexedNodes,
  SYSTEM_IDS,
  nodeTitleOf,
  planNodeAdd,
  present,
  projectPropEdits,
  seededField,
  seededTag,
  type KbNode,
  type PropValue,
} from "../src/index.ts";

const AT = "2026-11-14T00:00:00.000Z";
const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });

const node = (id: string, text: string, props: KbNode["props"] = {}, children: string[] = []) =>
  ({ id, text, props, children, createdAt: AT, updatedAt: AT }) satisfies KbNode;

/** A tag's settings, written on the seeded tag. */
const tagWith = (id: string, fields: string[], props: KbNode["props"]): KbNode => {
  const tag = seededTag(id, id, fields, AT);
  return { ...tag, props: { ...tag.props, ...props } };
};

/** A field that fills from `source`. */
const filling = (id: string, type: "date" | "ref" | "text", source: string, one = true) =>
  seededField(id, id, type, AT, { one, props: { [SYSTEM_IDS.fillFromField]: [ref(source)] } });

const graph = () =>
  IndexedNodes.of([
    seededField(SYSTEM_IDS.fillFromField, "fill from", "ref", AT, { one: true }),
    seededField(SYSTEM_IDS.tagChildTagField, "child tag", "ref", AT),
    seededField(SYSTEM_IDS.tagTitleField, "title", "text", AT, { one: true }),
    seededField("f.key", "period", "text", AT, { one: true }),
    seededField("f.lead", "lead", "ref", AT),
    filling("f.due", "date", "f.key"),
    filling("f.owner", "ref", "f.lead", false),
    filling("f.area", "text", "f.area"),
    tagWith("t.project", ["f.lead", "f.area"], {
      [SYSTEM_IDS.tagChildTagField]: [ref("t.task")],
    }),
    tagWith("t.task", ["f.due", "f.owner", "f.area"], {
      [SYSTEM_IDS.tagTitleField]: [str("[[sys.f.node.text]] — [[f.owner]]")],
    }),
    node("ann", "Ann"),
    node("bo", "Bo"),
    node("year", "2026", { "f.key": [str("2026")] }, ["day"]),
    node("day", "Sat", { "f.key": [str("2026-11-14")] }, ["proj"]),
    node(
      "proj",
      "Launch",
      {
        [SYSTEM_IDS.typeField]: [ref("t.project")],
        "f.lead": [ref("ann"), ref("bo")],
        "f.area": [str("ops")],
      },
      ["plain"],
    ),
    node("plain", "plain"),
  ]);

describe("child tag", () => {
  test("a node added under a node of the tag gets its child tags, after its own, each once", () => {
    const g = graph();
    const { node: added } = planNodeAdd(g, { text: "ship", parent: "proj" }, "n1", AT);
    expect(added.props[SYSTEM_IDS.typeField]).toEqual([ref("t.task")]);
    const named = planNodeAdd(
      g,
      { text: "again", parent: "proj", tags: ["t.project", "t.task"] },
      "n2",
      AT,
    );
    expect(named.node.props[SYSTEM_IDS.typeField]).toEqual([ref("t.project"), ref("t.task")]);
  });

  test("an add under a node with no such tag, or at the roots, gets none", () => {
    const g = graph();
    expect(planNodeAdd(g, { text: "x", parent: "plain" }, "n1", AT).node.props).toEqual({});
    expect(planNodeAdd(g, { text: "y" }, "n2", AT).node.props).toEqual({});
  });
});

describe("fill from", () => {
  test("an add that gains a tag fills its fields from the nearest ancestor holding a value it can hold", () => {
    const { node: added } = planNodeAdd(graph(), { text: "ship", parent: "proj" }, "n1", AT);
    // The year's key is not a date, so the walk goes on past it… the day's is.
    expect(added.props["f.due"]).toEqual([str("2026-11-14")]);
    // Many-valued: every value of the nearest holder.
    expect(added.props["f.owner"]).toEqual([ref("ann"), ref("bo")]);
    // A field that names itself copies its own value down.
    expect(added.props["f.area"]).toEqual([str("ops")]);
  });

  test("a value the add names is kept, and nothing fills a field that names no field to fill from", () => {
    const { node: added } = planNodeAdd(
      graph(),
      { text: "ship", parent: "proj", props: [{ field: "f.area", value: str("dev") }] },
      "n1",
      AT,
    );
    expect(added.props["f.area"]).toEqual([str("dev")]);
    expect(added.props["f.lead"]).toBeUndefined();
  });

  test("an update that gains the tag fills; one that keeps it fills nothing", () => {
    const g = graph();
    const plain = present(g.get("plain"), "plain");
    const tagged = projectPropEdits(g, plain, {
      setProps: [{ field: SYSTEM_IDS.typeField, value: ref("t.task") }],
    });
    expect(tagged["f.due"]).toEqual([str("2026-11-14")]);
    const kept = projectPropEdits(
      g,
      { id: "plain", props: { [SYSTEM_IDS.typeField]: [ref("t.task")] } },
      { setProps: [{ field: "f.lead", value: ref("ann") }] },
    );
    expect(kept["f.due"]).toBeUndefined();
  });
});

describe("title", () => {
  const nodeOf = (id: string) => graph().get(id);

  test("a node is named by its kind's template once every field it names holds a value", () => {
    const task = node("t", "ship", {
      [SYSTEM_IDS.typeField]: [ref("t.task")],
      "f.owner": [ref("ann"), ref("bo")],
    });
    expect(nodeTitleOf("t", task, nodeOf)).toBe("ship — Ann, Bo");
  });

  test("until then, and with no template, it is the node's text", () => {
    const bare = node("t", "ship", { [SYSTEM_IDS.typeField]: [ref("t.task")] });
    expect(nodeTitleOf("t", bare, nodeOf)).toBe("ship");
    expect(nodeTitleOf("proj", present(nodeOf("proj"), "proj"), nodeOf)).toBe("Launch");
  });

  test("a ref value is shown by its target's title, and a cycle of titles ends at a text", () => {
    const a = node("a", "A", { [SYSTEM_IDS.typeField]: [ref("t.task")], "f.owner": [ref("b")] });
    const b = node("b", "B", { [SYSTEM_IDS.typeField]: [ref("t.task")], "f.owner": [ref("a")] });
    const lookup = (id: string) => (id === "a" ? a : id === "b" ? b : nodeOf(id));
    expect(nodeTitleOf("a", a, lookup)).toBe("A — B — A");
  });
});
