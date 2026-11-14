/**
 * How a tag shapes the nodes it is on (DESIGN.md → Data model → tag
 * behaviours), through the actions every surface calls (the CLI, MCP and
 * the page reach the same `node.add`, `node.update` and `graph.search`):
 * settings written as data on a person's tag and field, a child added under
 * a tagged node taking the child tag and filling from its ancestors, a
 * tagging filling, and search answering a node's title.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkEdits,
  checkOf,
  fieldTypeValue,
  present,
  SYSTEM_IDS,
  type KbNode,
  type PropValue,
} from "@kb/model";
import { DAYS_IDS } from "@kb/days";
import { invoke } from "../src/invoke.ts";
import type { KbContext } from "@kb/contracts";
import { openKb } from "../src/session.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-tag-behaviour-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });

/** The output of a call that must succeed. */
async function ok<T>(ctx: KbContext, id: string, input: Record<string, unknown>): Promise<T> {
  const result = await invoke(ctx, { id, input });
  if (result.status !== "succeeded") throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.output as T;
}

const add = async (ctx: KbContext, input: Record<string, unknown>) =>
  (await ok<{ id: string; node: KbNode }>(ctx, "node.add", input)).node;

test("a child added under a tagged node takes its child tag and fills, and search answers the title", async () => {
  const ctx = await openKb(root);
  // A field that copies its own value down, and the tags that use it.
  const who = await add(ctx, {
    text: "who",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(SYSTEM_IDS.field) },
      { field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") },
    ],
  });
  await ok(ctx, "node.update", {
    id: who.id,
    setProps: [{ field: SYSTEM_IDS.fillFromField, value: ref(who.id) }],
  });
  const task = await add(ctx, {
    text: "task",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(SYSTEM_IDS.tag) },
      { field: SYSTEM_IDS.fieldsField, value: ref(who.id) },
      { field: SYSTEM_IDS.tagTitleField, value: str(`[[sys.f.node.text]] for [[${who.id}]]`) },
    ],
  });
  const project = await add(ctx, {
    text: "project",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(SYSTEM_IDS.tag) },
      { field: SYSTEM_IDS.tagChildTagField, value: ref(task.id) },
    ],
  });
  const ann = await add(ctx, { text: "Ann" });
  const launch = await add(ctx, {
    text: "Launch",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(project.id) },
      { field: who.id, value: ref(ann.id) },
    ],
  });

  const ship = await add(ctx, { text: "ship", parent: launch.id });
  expect(ship.props[SYSTEM_IDS.typeField]).toEqual([ref(task.id)]);
  expect(ship.props[who.id]).toEqual([ref(ann.id)]);

  // The stored text stays the person's; search finds and answers the title.
  expect(ship.text).toBe("ship");
  const found = await ok<{ rows: unknown[][] }>(ctx, "graph.search", { text: "for ann" });
  expect(found.rows).toEqual([[ship.id, "ship for Ann"]]);

  // A node moved in from elsewhere gains the tag by an update, and fills.
  const loose = await add(ctx, { text: "loose", parent: launch.id });
  const bare = await add(ctx, { text: "bare" });
  await ok(ctx, "node.update", { id: bare.id, parent: loose.id });
  const tagged = await ok<{ node: KbNode }>(ctx, "node.update", {
    id: bare.id,
    setProps: [{ field: SYSTEM_IDS.typeField, value: ref(task.id) }],
  });
  expect(tagged.node.props[who.id]).toEqual([ref(ann.id)]);
});

test("the settings are a person's to write on a family's tag and field", async () => {
  const ctx = await openKb(root);
  await ok(ctx, "node.update", {
    id: DAYS_IDS.dayTag,
    setProps: [
      { field: SYSTEM_IDS.tagTitleField, value: str("[[sys.f.node.text]]") },
      { field: SYSTEM_IDS.tagChildTagField, value: ref(DAYS_IDS.weekTag) },
    ],
  });
  await ok(ctx, "node.update", {
    id: DAYS_IDS.keyField,
    setProps: [
      { field: SYSTEM_IDS.pinnedField, value: { t: "bool", v: true } },
      { field: SYSTEM_IDS.showField, value: ref(SYSTEM_IDS.showFilled) },
      { field: SYSTEM_IDS.fillFromField, value: ref(DAYS_IDS.keyField) },
    ],
  });
});

test("a tag's box is its field: a value set anywhere checks it, and its edit is node.update's", async () => {
  const ctx = await openKb(root);
  const done = await add(ctx, {
    text: "done",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(SYSTEM_IDS.field) },
      { field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("checkbox") },
      { field: SYSTEM_IDS.cardinalityField, value: ref(SYSTEM_IDS.cardinalityOne) },
    ],
  });
  const item = await add(ctx, {
    text: "item",
    props: [
      { field: SYSTEM_IDS.typeField, value: ref(SYSTEM_IDS.tag) },
      { field: SYSTEM_IDS.tagCheckField, value: ref(done.id) },
    ],
  });
  const milk = await add(ctx, { text: "milk", tags: [item.id] });
  const nodeOf = (id: string) => ctx.index.getNode(id);
  expect(checkOf(milk, nodeOf)?.checked).toBe(false);

  // The field set the way `kb set` and an agent set it checks the box…
  const set = await ok<{ node: KbNode }>(ctx, "node.update", {
    id: milk.id,
    setProps: [{ field: done.id, value: { t: "bool", v: true } }],
  });
  const check = checkOf(set.node, nodeOf);
  expect(check?.checked).toBe(true);
  // …and the box's own edit is a node.update any surface can send.
  const unchecked = await ok<{ node: KbNode }>(ctx, "node.update", {
    id: milk.id,
    ...checkEdits(present(check, "a box")),
  });
  expect(unchecked.node.props[done.id]).toEqual([{ t: "bool", v: false }]);
  expect(checkOf(unchecked.node, nodeOf)?.checked).toBe(false);
});
