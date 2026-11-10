/**
 * Tag extension (DESIGN.md → Data model → Tags): a tag's chain is breadth
 * first in declared order, each tag once, and cycle-safe; a node is every
 * tag of its chains, so membership, a template, a tag's views, a ref
 * field's targets and an ontology's tag members all reach a subtype's
 * nodes; and the seed grows a seeded tag's additive lists without dropping
 * what a person put there.
 */
import { describe, expect, test } from "bun:test";
import { allowedRefIdsOf } from "../src/field-type.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "../src/model.ts";
import { resolveOntology } from "../src/ontology.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/seed.ts";
import { foldSeed } from "../src/seed-fold.ts";
import { systemWriteRefusal } from "../src/system-write.ts";
import { isA, kindsOf, tagAncestors, templateFieldsOf } from "../src/tag-kinds.ts";
import { tagViewsOf } from "../src/view-node.ts";

const AT = "2026-11-11T00:00:00.000Z";
const refs = (...ids: NodeId[]) => ids.map((v) => ({ t: "ref" as const, v }));

function node(id: NodeId, props: KbNode["props"] = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT };
}
const tag = (id: NodeId, extend: NodeId[] = [], fields: NodeId[] = []) =>
  node(id, {
    [SYSTEM_IDS.typeField]: refs(SYSTEM_IDS.tag),
    ...(extend.length > 0 ? { [SYSTEM_IDS.extendsField]: refs(...extend) } : {}),
    ...(fields.length > 0 ? { [SYSTEM_IDS.fieldsField]: refs(...fields) } : {}),
  });
const tagged = (id: NodeId, ...tags: NodeId[]) =>
  node(id, { [SYSTEM_IDS.typeField]: refs(...tags) });

// #habit and #reminder both reach #event; #reminder also reaches #task. #loop closes on itself.
const GRAPH = [
  tag("event", [], ["at", "repeat"]),
  tag("task", [], ["status"]),
  tag("reminder", ["event", "task"], ["remind"]),
  tag("habit", ["reminder", "event"], ["streak", "at"]),
  tag("loop", ["loop2"]),
  tag("loop2", ["loop"]),
  tagged("walk", "habit"),
  tagged("call", "event"),
  tagged("chore", "task"),
];
const byId = new Map(GRAPH.map((n) => [n.id, n]));
const nodeOf = (id: NodeId) => byId.get(id);

describe("a tag's chain", () => {
  test("is the tag, then its parents breadth first in declared order, each once", () => {
    expect(tagAncestors("habit", nodeOf)).toEqual(["habit", "reminder", "event", "task"]);
    expect(tagAncestors("event", nodeOf)).toEqual(["event"]);
  });

  test("ends where a cycle closes, and reaches past a missing tag", () => {
    expect(tagAncestors("loop", nodeOf)).toEqual(["loop", "loop2"]);
    expect(tagAncestors("gone", nodeOf)).toEqual(["gone"]);
  });
});

describe("a node of a tag that extends another", () => {
  test("is each of its chain's tags, its own first", () => {
    expect(kindsOf(nodeOf("walk"), nodeOf)).toEqual(["habit", "reminder", "event", "task"]);
    expect(isA(nodeOf("walk"), "event", nodeOf)).toBe(true);
    expect(isA(nodeOf("call"), "habit", nodeOf)).toBe(false);
  });

  test("shows its own fields, then each ancestor's it does not have, each once", () => {
    expect(templateFieldsOf(["habit"], nodeOf)).toEqual([
      "streak",
      "at",
      "remind",
      "repeat",
      "status",
    ]);
  });

  test("opens in its own tag's view, else the nearest ancestor's", () => {
    const withView = (n: KbNode, option: NodeId) => ({
      ...n,
      props: { ...n.props, [SYSTEM_IDS.viewDefaultField]: refs(option) },
    });
    const event = withView(tag("event"), "calendar");
    const viewsOf = (habit: KbNode) => {
      const graph = new Map([...byId, ["event", event] as const, ["habit", habit] as const]);
      return tagViewsOf(tagged("x", "habit"), "default", (id) => graph.get(id));
    };
    const habit = tag("habit", ["reminder", "event"]);
    expect(viewsOf(habit)).toEqual([{ tag: "event", option: "calendar" }]);
    expect(viewsOf(withView(habit, "board")).map((view) => view.option)).toEqual([
      "board",
      "calendar",
    ]);
  });

  test("is a target of a ref field that targets the ancestor, and a member of its ontology", () => {
    const field = node("f.when", { [SYSTEM_IDS.targetTagField]: refs("event") });
    expect([...(allowedRefIdsOf(field, byId) ?? [])].toSorted()).toEqual(["call", "walk"]);
    const onto = node("onto", {
      [SYSTEM_IDS.typeField]: refs(SYSTEM_IDS.ontologyTag),
      [SYSTEM_IDS.ontoIncludeField]: refs("event"),
    });
    const members = resolveOntology([...GRAPH, onto], "onto").members;
    expect(["walk", "call"].every((id) => members.has(id))).toBe(true);
    expect(members.has("chore")).toBe(false);
  });
});

describe("a seeded tag's additive lists", () => {
  const fold = (fields: NodeId[]) =>
    foldSeed(
      [
        { name: "core", label: "Core", seed: systemSeedNodes },
        {
          name: "fam",
          label: "Fam",
          seed: () => [tag("sys.tag.fam", [], fields), node("sys.f.fam.a"), node("sys.f.fam.b")],
        },
      ],
      AT,
    );

  test("take a person's parent and field without force, and keep what the family ships", () => {
    const seeded = tag("sys.tag.fam", [], ["sys.f.fam.a"]);
    const mine = tag("sys.tag.fam", ["n.mine"], ["sys.f.fam.a", "f.mine"]);
    expect(systemWriteRefusal(seeded, mine, () => undefined)).toBeNull();
    const dropped = tag("sys.tag.fam", ["n.mine"], ["f.mine"]);
    expect(systemWriteRefusal(mine, dropped, () => undefined)).toMatch(/keeps the sys.f.fields/);
  });

  test("gain a field the family adds later after the person's, in one open, then hold", () => {
    const store = ensureSystemSeed([], fold(["sys.f.fam.a"])).nodes.map((n) =>
      n.id === "sys.tag.fam" ? tag("sys.tag.fam", ["n.mine"], ["sys.f.fam.a", "f.mine"]) : n,
    );
    const opened = ensureSystemSeed(store, fold(["sys.f.fam.a", "sys.f.fam.b"]));
    expect(opened.seeded).toBe(true);
    const fam = opened.nodes.find((n) => n.id === "sys.tag.fam");
    expect(fam?.props[SYSTEM_IDS.fieldsField]).toEqual(
      refs("sys.f.fam.a", "f.mine", "sys.f.fam.b"),
    );
    expect(fam?.props[SYSTEM_IDS.extendsField]).toEqual(refs("n.mine"));
    expect(ensureSystemSeed(opened.nodes, fold(["sys.f.fam.a", "sys.f.fam.b"])).seeded).toBe(false);
  });
});
