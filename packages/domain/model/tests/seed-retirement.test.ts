/**
 * The seed's retirement table (DESIGN.md → Extension families → the seed
 * retires what it renames): opening a store applies the fold's rows before
 * it seeds. A retired node is renamed in place or dropped for its
 * replacement; every prop keyed by it, value choosing it, child entry and
 * `[[ref]]` follows; an id nothing replaced is dropped everywhere; it is
 * idempotent, so a build without the rows re-seeding the old node and a
 * merge with a clone that still holds it both converge on the next open;
 * a label the seed changed reaches a node nobody edited, renamed or not;
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
    field("sys.probe.f.look", "look", ["sys.probe.look.dim", "sys.probe.look.bright"]),
    node("sys.probe.look.dim", "dim"),
    node("sys.probe.look.bright", "bright"),
    node("sys.probe.note", "a note"),
  ],
};

/** The probe family after: `look` renamed `tone` with its options, the note removed. */
const AFTER: SeedSource = {
  name: "probe",
  label: "Probe",
  seed: () => [
    field("sys.probe.f.tone", "tone", ["sys.probe.tone.dim", "sys.probe.tone.bright"]),
    node("sys.probe.tone.dim", "dim"),
    node("sys.probe.tone.bright", "bright"),
  ],
  retires: [
    { from: "sys.probe.f.look", to: "sys.probe.f.tone" },
    { from: "sys.probe.look.dim", to: "sys.probe.tone.dim" },
    { from: "sys.probe.look.bright", to: "sys.probe.tone.bright" },
    { from: "sys.probe.note" },
  ],
};

const fold = (probe: SeedSource) => foldSeed([...BUNDLED_DECLARATIONS, probe], AT);

/** A node of the owner's that chooses through the old field and mentions an old option. */
const USER = node("n.user", "see [[sys.probe.look.bright]] and [[sys.probe.note]]", {
  props: { "sys.probe.f.look": [{ t: "ref", v: "sys.probe.look.bright" }] },
  children: ["sys.probe.note"],
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

const OLD = ["sys.probe.f.look", "sys.probe.look.dim", "sys.probe.look.bright", "sys.probe.note"];

describe("the seed's retirement table", () => {
  test("renames a retired node in place where its replacement is not there yet, keeping its edits", () => {
    const edited = seededBefore().map((n) =>
      n.id === "sys.probe.look.bright" ? { ...n, text: "bright (mine)" } : n,
    );
    const opened = ensureSystemSeed(edited, fold(AFTER));
    const nodes = byId(opened.nodes);
    expect(present(nodes.get("sys.probe.tone.bright"), "the replacement").text).toBe(
      "bright (mine)",
    );
    expect(opened.deletes.toSorted()).toEqual(OLD.toSorted());
    expect(opened.seeded).toBe(true);
  });

  test("drops a retired node for a replacement already there, which keeps its own and gains what it lacks", () => {
    const stored = [
      ...seededBefore(),
      node("sys.probe.tone.dim", "dim (new)", { props: { "x.f.a": [{ t: "str", v: "new" }] } }),
    ].map(
      (n): KbNode =>
        n.id === "sys.probe.look.dim"
          ? {
              ...n,
              props: { "x.f.a": [{ t: "str", v: "old" }], "x.f.b": [{ t: "str", v: "old" }] },
              children: ["n.kid"],
            }
          : n,
    );
    const kept = present(
      byId(ensureSystemSeed(stored, fold(AFTER)).nodes).get("sys.probe.tone.dim"),
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
    expect(user.props).toEqual({ "sys.probe.f.tone": [{ t: "ref", v: "sys.probe.tone.bright" }] });
    expect(user.text).toBe("see [[sys.probe.tone.bright]] and [[sys.probe.note]]");
    expect(present(nodes.get("sys.probe.f.tone"), "the field").children).toEqual([
      "sys.probe.tone.dim",
      "sys.probe.tone.bright",
    ]);
  });

  test("drops an id nothing replaced everywhere but a mention, which shows as missing", () => {
    const opened = ensureSystemSeed(seededBefore(), fold(AFTER)).nodes;
    expect(byId(opened).has("sys.probe.note")).toBe(false);
    expect(present(byId(opened).get("n.user"), "the owner's node").children).toEqual([]);
    for (const old of OLD) expect(named(opened).has(old), old).toBe(false);
  });

  test("keeps the replacement's own value where a node holds both keys, once", () => {
    const both = {
      ...USER,
      props: {
        "sys.probe.f.look": [{ t: "ref" as const, v: "sys.probe.look.dim" }],
        "sys.probe.f.tone": [
          { t: "ref" as const, v: "sys.probe.tone.bright" },
          { t: "ref" as const, v: "sys.probe.look.bright" },
        ],
      },
    };
    const stored = ensureSystemSeed([both], fold(BEFORE)).nodes;
    const user = present(byId(ensureSystemSeed(stored, fold(AFTER)).nodes).get("n.user"), "it");
    expect(user.props).toEqual({ "sys.probe.f.tone": [{ t: "ref", v: "sys.probe.tone.bright" }] });
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
    expect(byId(older).has("sys.probe.f.look")).toBe(true);
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
        ? { ...n, props: { "sys.probe.f.look": [{ t: "ref" as const, v: "sys.probe.look.dim" }] } }
        : n,
    );
    const merged = mergeNodeSets(base, ours, theirs).nodes;
    const opened = ensureSystemSeed(merged, fold(AFTER));
    for (const old of OLD) expect(named(opened.nodes).has(old), old).toBe(false);
    expect(ensureSystemSeed(opened.nodes, fold(AFTER)).seeded).toBe(false);
  });

  test("refuses a row the fold cannot honour", () => {
    const retiring = (rows: SeedSource["retires"]) => () => fold({ ...AFTER, retires: rows });
    expect(retiring([{ from: "sys.probe.f.tone" }])).toThrow(
      "probe retires sys.probe.f.tone, which the seed still holds",
    );
    expect(retiring([{ from: "sys.probe.f.look", to: "sys.probe.f.gone" }])).toThrow(
      "probe retires sys.probe.f.look for sys.probe.f.gone, which the seed does not hold",
    );
    expect(retiring([{ from: "sys.probe.note" }, { from: "sys.probe.note" }])).toThrow(
      "sys.probe.note is retired twice",
    );
    // A store's other ids are its owner's: a row may not delete a node a person made under one.
    expect(retiring([{ from: "n.user" }])).toThrow(
      "probe retires n.user, which is not a reserved sys. id",
    );
  });

  test("pools the values of two retired fields one replacement took over, once each", () => {
    const TWO: SeedSource = {
      ...BEFORE,
      seed: (at) => [...(BEFORE.seed?.(at) ?? []), field("sys.probe.f.shade", "shade", [])],
    };
    const ONE: SeedSource = {
      ...AFTER,
      retires: [...(AFTER.retires ?? []), { from: "sys.probe.f.shade", to: "sys.probe.f.tone" }],
    };
    const both = {
      ...USER,
      props: {
        "sys.probe.f.look": [{ t: "ref" as const, v: "sys.probe.look.dim" }],
        "sys.probe.f.shade": [
          { t: "ref" as const, v: "sys.probe.look.bright" },
          { t: "ref" as const, v: "sys.probe.look.dim" },
        ],
      },
    };
    const stored = ensureSystemSeed([both], foldSeed([...BUNDLED_DECLARATIONS, TWO], AT)).nodes;
    const opened = ensureSystemSeed(stored, foldSeed([...BUNDLED_DECLARATIONS, ONE], AT)).nodes;
    expect(present(byId(opened).get("n.user"), "the owner's node").props).toEqual({
      "sys.probe.f.tone": [
        { t: "ref", v: "sys.probe.tone.dim" },
        { t: "ref", v: "sys.probe.tone.bright" },
      ],
    });
  });

  test("moves a labelled mention to the replacement and keeps its label", () => {
    const labelled = { ...USER, text: "pick [[sys.probe.look.dim|the dim one]]" };
    const stored = ensureSystemSeed([labelled], fold(BEFORE)).nodes;
    const user = present(byId(ensureSystemSeed(stored, fold(AFTER)).nodes).get("n.user"), "it");
    expect(user.text).toBe("pick [[sys.probe.tone.dim|the dim one]]");
  });

  test("refuses a label row the fold cannot honour", () => {
    const retiring = (rows: SeedSource["retires"]) => () => fold({ ...AFTER, retires: rows });
    expect(retiring([{ from: "sys.probe.note", text: "a note" }])).toThrow(
      "probe retires the label of sys.probe.note, which nothing replaced",
    );
    expect(retiring([{ from: "sys.probe.f.tone", to: "sys.probe.f.tone" }])).toThrow(
      "probe retires sys.probe.f.tone for itself",
    );
    expect(retiring([{ from: "sys.probe.f.tone", to: "sys.probe.f.tone", text: "tone" }])).toThrow(
      'probe retires the label "tone", which the seed still writes on sys.probe.f.tone',
    );
  });
});

/** Two commands as a store was first seeded with them. */
const LABELS_BEFORE: SeedSource = {
  name: "probe",
  label: "Probe",
  seed: () => [node("sys.probe.cmd.prefs", "Preferences"), node("sys.probe.cmd.go", "Go")],
};

/** After: one renamed with its label, the other relabelled under the same id. */
const LABELS_AFTER: SeedSource = {
  name: "probe",
  label: "Probe",
  seed: () => [node("sys.probe.cmd.settings", "Settings"), node("sys.probe.cmd.go", "Go to")],
  retires: [
    { from: "sys.probe.cmd.prefs", to: "sys.probe.cmd.settings", text: "Preferences" },
    { from: "sys.probe.cmd.go", to: "sys.probe.cmd.go", text: "Go" },
  ],
};

const texts = (nodes: readonly KbNode[]) => {
  const all = byId(nodes);
  return {
    settings: all.get("sys.probe.cmd.settings")?.text,
    go: all.get("sys.probe.cmd.go")?.text,
  };
};

describe("a label the seed retires", () => {
  const before = (): KbNode[] => ensureSystemSeed([], fold(LABELS_BEFORE)).nodes;

  test("reaches a node nobody edited, under its new id or its own", () => {
    const opened = ensureSystemSeed(before(), fold(LABELS_AFTER));
    expect(texts(opened.nodes)).toEqual({ settings: "Settings", go: "Go to" });
    expect(opened.seeded).toBe(true);
  });

  test("leaves a label the owner edited", () => {
    const edited = before().map((n) =>
      n.id === "sys.probe.cmd.prefs"
        ? { ...n, text: "My prefs" }
        : n.id === "sys.probe.cmd.go"
          ? { ...n, text: "Jump" }
          : n,
    );
    expect(texts(ensureSystemSeed(edited, fold(LABELS_AFTER)).nodes)).toEqual({
      settings: "My prefs",
      go: "Jump",
    });
  });

  test("is a no-op once applied, and an older build's open converges on the next newer one", () => {
    const once = ensureSystemSeed(before(), fold(LABELS_AFTER)).nodes;
    expect(ensureSystemSeed(once, fold(LABELS_AFTER)).seeded).toBe(false);
    const older = ensureSystemSeed(once, fold(LABELS_BEFORE)).nodes;
    const newer = ensureSystemSeed(older, fold(LABELS_AFTER)).nodes;
    expect(byId(newer).has("sys.probe.cmd.prefs")).toBe(false);
    expect(texts(newer)).toEqual({ settings: "Settings", go: "Go to" });
  });

  test("core's: a store seeded with ⌘K's Preferences reads Settings", () => {
    const core = foldSeed(BUNDLED_DECLARATIONS, AT);
    const seeded = ensureSystemSeed([], core).nodes.map((n) =>
      n.id === SYSTEM_IDS.cmdSettings
        ? { ...n, id: "sys.cmd.preferences", text: "Preferences" }
        : n,
    );
    const opened = byId(ensureSystemSeed(seeded, core).nodes);
    expect(opened.has("sys.cmd.preferences")).toBe(false);
    expect(opened.get(SYSTEM_IDS.cmdSettings)?.text).toBe("Settings");
  });
});
