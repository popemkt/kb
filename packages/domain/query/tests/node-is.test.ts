/**
 * `:node/is`: each tag a node is, subtypes included — `sys.f.type` closed
 * over `sys.f.extends` — derived, never stored, and kept in step as tags
 * change what they extend, however many hops from the node.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type PropValue } from "@kb/model";
import { DatascriptIndex, derivedWith } from "@kb/query";

const ref = (v: string): PropValue => ({ t: "ref", v });

const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/** A tag, extending `parents`. */
const tag = (id: string, ...parents: string[]): KbNode =>
  node(id, {
    [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)],
    ...(parents.length === 0 ? {} : { [SYSTEM_IDS.extendsField]: parents.map(ref) }),
  });

/** A node of `tags`. */
const of = (id: string, ...tags: string[]): KbNode =>
  node(id, { [SYSTEM_IDS.typeField]: tags.map(ref) });

const isA = (tagId: string) =>
  `[:find ?id :where [?t :node/id "${tagId}"] [?n :node/is ?t] [?n :node/id ?id]]`;
const taggedExactly = (tagId: string) =>
  `[:find ?id :where [?t :node/id "${tagId}"] [?n :f/sys.f.type ?t] [?n :node/id ?id]]`;

const ids = (rows: unknown[][]) => rows.map(([id]) => String(id)).toSorted();

/** Rows as comparable strings, in one order. */
const sorted = (rows: unknown[][]) => rows.map((row) => JSON.stringify(row)).toSorted();

const indexOver = (nodes: readonly KbNode[]) =>
  new DatascriptIndex(nodes, { derived: derivedWith({}) });

describe(":node/is", () => {
  test("a node is each tag it carries and every tag those extend; sys.f.type stays exact", () => {
    const index = indexOver([
      node(SYSTEM_IDS.tag),
      tag("t.thing"),
      tag("t.event", "t.thing"),
      tag("t.meeting", "t.event"),
      of("n.standup", "t.meeting"),
      of("n.party", "t.event"),
    ]);
    expect(ids(index.runDatalog(isA("t.event")))).toEqual(["n.party", "n.standup"]);
    expect(ids(index.runDatalog(isA("t.thing")))).toEqual(["n.party", "n.standup"]);
    expect(ids(index.runDatalog(isA("t.meeting")))).toEqual(["n.standup"]);
    expect(ids(index.runDatalog(taggedExactly("t.event")))).toEqual(["n.party"]);
  });

  test("follows a tag's extends as it changes, however many hops from the node", () => {
    const index = indexOver([
      node(SYSTEM_IDS.tag),
      tag("t.thing"),
      tag("t.event"),
      tag("t.meeting", "t.event"),
      of("n.standup", "t.meeting"),
    ]);
    expect(ids(index.runDatalog(isA("t.thing")))).toEqual([]);
    // Two hops from the node: the event comes to extend the thing.
    index.applyTx({ upserts: [tag("t.event", "t.thing")], deletes: [] });
    expect(ids(index.runDatalog(isA("t.thing")))).toEqual(["n.standup"]);
    // One hop: the meeting stops extending the event.
    index.applyTx({ upserts: [tag("t.meeting")], deletes: [] });
    expect(ids(index.runDatalog(isA("t.event")))).toEqual([]);
    expect(ids(index.runDatalog(isA("t.thing")))).toEqual([]);
    expect(ids(index.runDatalog(isA("t.meeting")))).toEqual(["n.standup"]);
  });

  test("a tag deleted from the chain is no longer what its nodes are, and comes back with it", () => {
    const index = indexOver([
      node(SYSTEM_IDS.tag),
      tag("t.event"),
      tag("t.meeting", "t.event"),
      of("n.standup", "t.meeting"),
    ]);
    index.applyTx({ upserts: [], deletes: ["t.event"] });
    expect(ids(index.runDatalog(isA("t.event")))).toEqual([]);
    index.applyTx({ upserts: [tag("t.event")], deletes: [] });
    expect(ids(index.runDatalog(isA("t.event")))).toEqual(["n.standup"]);
  });

  test("a cycle a write let through ends the walk: each tag on it once", () => {
    const index = indexOver([
      node(SYSTEM_IDS.tag),
      tag("t.a", "t.b"),
      tag("t.b", "t.a"),
      of("n.x", "t.a"),
    ]);
    expect(ids(index.runDatalog(isA("t.a")))).toEqual(["n.x"]);
    expect(ids(index.runDatalog(isA("t.b")))).toEqual(["n.x"]);
  });

  test("kept in step, it reads as an index built over the graph as it now stands", () => {
    const nodes = [
      node(SYSTEM_IDS.tag),
      tag("t.thing"),
      tag("t.event", "t.thing"),
      tag("t.meeting", "t.event"),
      of("n.standup", "t.meeting"),
      of("n.party", "t.event", "t.meeting"),
    ];
    const index = indexOver(nodes);
    const txs = [
      { upserts: [tag("t.event")], deletes: [] },
      { upserts: [tag("t.meeting", "t.thing")], deletes: [] },
      { upserts: [of("n.party", "t.thing")], deletes: [] },
      { upserts: [tag("t.thing", "t.meeting")], deletes: [] },
    ];
    let graph = new Map(nodes.map((n) => [n.id, n]));
    const all = "[:find ?id ?tag :where [?n :node/is ?t] [?n :node/id ?id] [?t :node/id ?tag]]";
    for (const tx of txs) {
      index.applyTx(tx);
      graph = new Map([...graph, ...tx.upserts.map((n): [string, KbNode] => [n.id, n])]);
      expect(sorted(index.runDatalog(all))).toEqual(
        sorted(indexOver([...graph.values()]).runDatalog(all)),
      );
    }
  });
});
