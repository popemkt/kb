/**
 * The seed's retirement table (DESIGN.md → Extension families → the seed
 * retires what it renames): opening a store applies the fold's rows before
 * it seeds. A retired node is renamed in place or dropped for its
 * replacement; every prop keyed by it, value choosing it, child entry and
 * `[[ref]]` follows; an id nothing replaced is dropped everywhere; it is
 * idempotent, so a build without the rows re-seeding the old node and a
 * merge with a clone that still holds it both converge on the next open;
 * and a row the fold cannot honour is a bundling defect.
 */
import { describe, expect, test } from "bun:test";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { mergeNodeSets } from "../src/merge.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "../src/model.ts";
import { present } from "../src/present.ts";
import { foldSeed, type SeedSource } from "../src/seed-fold.ts";
import { ensureSystemSeed } from "../src/seed.ts";

const AT = "2026-10-27T00:00:00.000Z";

function node(id: NodeId, text: string, extra: Partial<KbNode> = {}): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT, ...extra };
}

const field = (id: NodeId, text: string, options: readonly NodeId[]) =>
  node(id, text, {
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
    children: [...options],
  });

/** The probe family as a store was first seeded with it: a field `look`, two options and a note. */
const BEFORE: SeedSource = {
  name: "probe",
  label: "Probe",
  seed: () => [
    field("probe.f.look", "look", ["probe.look.dim", "probe.look.bright"]),
    node("probe.look.dim", "dim"),
    node("probe.look.bright", "bright"),
    node("probe.note", "a note"),
  ],
};

/** The probe family after: `look` renamed `tone` with its options, the note removed. */
const AFTER: SeedSource = {
  name: "probe",
  label: "Probe",
  seed: () => [
    field("probe.f.tone", "tone", ["probe.tone.dim", "probe.tone.bright"]),
    node("probe.tone.dim", "dim"),
    node("probe.tone.bright", "bright"),
  ],
  retires: [
    { from: "probe.f.look", to: "probe.f.tone" },
    { from: "probe.look.dim", to: "probe.tone.dim" },
    { from: "probe.look.bright", to: "probe.tone.bright" },
    { from: "probe.note" },
  ],
};

const fold = (probe: SeedSource) => foldSeed([...BUNDLED_DECLARATIONS, probe], AT);

/** A node of the owner's that chooses through the old field and mentions an old option. */
const USER = node("n.user", "see [[probe.look.bright]] and [[probe.note]]", {
  props: { "probe.f.look": [{ t: "ref", v: "probe.look.bright" }] },
  children: ["probe.note"],
});

/** A store opened with the probe as it was, the owner's node in it. */
const seededBefore = (): KbNode[] => ensureSystemSeed([USER], fold(BEFORE)).nodes;

const byId = (nodes: readonly KbNode[]) => new Map(nodes.map((n) => [n.id, n]));

/** Every id the store names anywhere: node ids, prop keys, ref values and children. */
function named(nodes: readonly KbNode[]): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const n of nodes) {
    ids.add(n.id);
    for (const child of n.children) ids.add(child);
    for (const [key, values] of Object.entries(n.props)) {
      ids.add(key);
      for (const value of values) if (value.t === "ref") ids.add(value.v);
    }
  }
  return ids;
}

const OLD = ["probe.f.look", "probe.look.dim", "probe.look.bright", "probe.note"];

describe("the seed's retirement table", () => {
  test("renames a retired node in place where its replacement is not there yet, keeping its edits", () => {
    const edited = seededBefore().map((n) =>
      n.id === "probe.look.bright" ? { ...n, text: "bright (mine)" } : n,
    );
    const opened = ensureSystemSeed(edited, fold(AFTER));
    const nodes = byId(opened.nodes);
    expect(present(nodes.get("probe.tone.bright"), "the replacement").text).toBe("bright (mine)");
    expect(opened.deletes.toSorted()).toEqual(OLD.toSorted());
    expect(opened.seeded).toBe(true);
  });

  test("drops a retired node for a replacement already there, which keeps its own and gains what it lacks", () => {
    const stored = [
      ...seededBefore(),
      node("probe.tone.dim", "dim (new)", { props: { "x.f.a": [{ t: "str", v: "new" }] } }),
    ].map(
      (n): KbNode =>
        n.id === "probe.look.dim"
          ? {
              ...n,
              props: { "x.f.a": [{ t: "str", v: "old" }], "x.f.b": [{ t: "str", v: "old" }] },
              children: ["n.kid"],
            }
          : n,
    );
    const kept = present(
      byId(ensureSystemSeed(stored, fold(AFTER)).nodes).get("probe.tone.dim"),
      "the replacement",
    );
    expect(kept.text).toBe("dim (new)");
    expect(kept.props["x.f.a"]).toEqual([{ t: "str", v: "new" }]);
    expect(kept.props["x.f.b"]).toEqual([{ t: "str", v: "old" }]);
    expect(kept.children).toContain("n.kid");
  });

  test("moves what names a retired id to its replacement: the prop key, the value, the field's options, a mention", () => {
    const nodes = byId(ensureSystemSeed(seededBefore(), fold(AFTER)).nodes);
    const user = present(nodes.get("n.user"), "the owner's node");
    expect(user.props).toEqual({ "probe.f.tone": [{ t: "ref", v: "probe.tone.bright" }] });
    expect(user.text).toBe("see [[probe.tone.bright]] and [[probe.note]]");
    expect(present(nodes.get("probe.f.tone"), "the field").children).toEqual([
      "probe.tone.dim",
      "probe.tone.bright",
    ]);
  });

  test("drops an id nothing replaced everywhere but a mention, which shows as missing", () => {
    const opened = ensureSystemSeed(seededBefore(), fold(AFTER)).nodes;
    expect(byId(opened).has("probe.note")).toBe(false);
    expect(present(byId(opened).get("n.user"), "the owner's node").children).toEqual([]);
    for (const old of OLD) expect(named(opened).has(old), old).toBe(false);
  });

  test("keeps the replacement's own value where a node holds both keys, once", () => {
    const both = {
      ...USER,
      props: {
        "probe.f.look": [{ t: "ref" as const, v: "probe.look.dim" }],
        "probe.f.tone": [
          { t: "ref" as const, v: "probe.tone.bright" },
          { t: "ref" as const, v: "probe.look.bright" },
        ],
      },
    };
    const stored = ensureSystemSeed([both], fold(BEFORE)).nodes;
    const user = present(byId(ensureSystemSeed(stored, fold(AFTER)).nodes).get("n.user"), "it");
    expect(user.props).toEqual({ "probe.f.tone": [{ t: "ref", v: "probe.tone.bright" }] });
  });

  test("is a no-op once applied", () => {
    const once = ensureSystemSeed(seededBefore(), fold(AFTER)).nodes;
    const again = ensureSystemSeed(once, fold(AFTER));
    expect({ seeded: again.seeded, deletes: again.deletes }).toEqual({
      seeded: false,
      deletes: [],
    });
  });

  test("an older build re-seeds the old nodes but writes no choice, and the next newer open retires them once", () => {
    const migrated = ensureSystemSeed(seededBefore(), fold(AFTER)).nodes;
    const older = ensureSystemSeed(migrated, fold(BEFORE)).nodes;
    // The old nodes are back, and nothing chooses them: the owner's choice is untouched.
    expect(byId(older).has("probe.f.look")).toBe(true);
    expect(byId(older).get("n.user")?.props).toEqual(byId(migrated).get("n.user")?.props);
    const newer = ensureSystemSeed(older, fold(AFTER));
    for (const old of OLD) expect(named(newer.nodes).has(old), old).toBe(false);
    expect(byId(newer.nodes).get("n.user")?.props).toEqual(byId(migrated).get("n.user")?.props);
    expect(ensureSystemSeed(newer.nodes, fold(AFTER)).seeded).toBe(false);
  });

  test("a store merged with a clone that still holds the old nodes converges on the next open", () => {
    const base = seededBefore();
    const ours = ensureSystemSeed(base, fold(AFTER)).nodes;
    // The other clone, unmigrated, chooses the other option through the old field.
    const theirs = base.map((n) =>
      n.id === "n.user"
        ? { ...n, props: { "probe.f.look": [{ t: "ref" as const, v: "probe.look.dim" }] } }
        : n,
    );
    const merged = mergeNodeSets(base, ours, theirs).nodes;
    const opened = ensureSystemSeed(merged, fold(AFTER));
    for (const old of OLD) expect(named(opened.nodes).has(old), old).toBe(false);
    expect(ensureSystemSeed(opened.nodes, fold(AFTER)).seeded).toBe(false);
  });

  test("refuses a row the fold cannot honour", () => {
    const retiring = (rows: SeedSource["retires"]) => () => fold({ ...AFTER, retires: rows });
    expect(retiring([{ from: "probe.f.tone" }])).toThrow(
      "probe retires probe.f.tone, which the seed still holds",
    );
    expect(retiring([{ from: "probe.f.look", to: "probe.f.gone" }])).toThrow(
      "probe retires probe.f.look for probe.f.gone, which the seed does not hold",
    );
    expect(retiring([{ from: "probe.note" }, { from: "probe.note" }])).toThrow(
      "probe.note is retired twice",
    );
  });
});
