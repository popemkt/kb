/**
 * The outline's expansion: the reader's open and closed choices, kept only
 * while the reader can undo them, kept in storage exactly as the outline
 * holds them, and read from storage at load.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import {
  childInstanceKey,
  EXPANDED_STORAGE_KEY,
  EXPANSION_STORAGE_KEY,
  MAIN_OUTLINE_HOST,
  outlineInstanceKey,
  placeOfInstance,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { fixtureGraph } from "@/api/fixture-graph";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore, rowClosed, rowKey } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

/** Writes to the stubbed storage since the last `writes()`. */
let writeCount = 0;
function writes(): number {
  const count = writeCount;
  writeCount = 0;
  return count;
}

/** A tab's storage, to read back what the outline kept and to write as another tab would. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      writeCount += 1;
      items.set(key, value);
    },
  };
}

const graph = () => useGraphStore.getState();
const outline = () => useOutlineStore.getState();
const wireOf = (id: string): WireNode =>
  present(
    graph().wireNodes.find((n) => n.id === id),
    id,
  );
const collapsed = (id: string) => rowClosed(id);

/** The expansion storage holds, as `kb-expansion` keeps it. */
function stored(): { open: string[]; closed: string[] } {
  return JSON.parse(localStorage.getItem(EXPANSION_STORAGE_KEY) ?? '{"open":[],"closed":[]}');
}

/** Another tab's write: its whole stored expansion. */
function anotherTabStores(open: string[], closed: string[] = []): void {
  localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify({ open, closed }));
}

/** A fresh load of the graph the page holds now, as a reload reads it. */
function reload(): void {
  graph().hydrateFromWire(structuredClone(graph().wireNodes), graph().rev, "fixtures");
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetOutlineStore();
  graph().hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
});
afterEach(() => vi.unstubAllGlobals());

/** A row's instance in the main outline. */
const keyOf = (id: string) => outlineInstanceKey(id, outlineNodes());
/** The place of a row's instance in the main outline: where its choice stands. */
const placeOf = (id: string) => placeOfInstance(keyOf(id));

describe("a row's whole subtree opens and closes at once", () => {
  /** The fixture with n.root-c closed over a child, and n.ref, a reference to n.root-a, under it. */
  function seedSiblingAndReference(): void {
    const wires = structuredClone(fixtureGraph.nodes).map((w) =>
      w.id === "n.root-c" ? { ...w, children: ["n.c1", "n.ref"] } : w,
    );
    const leaf = {
      ...present(
        wires.find((w) => w.id === "n.child-a1"),
        "a1",
      ),
      children: [],
    };
    graph().hydrateFromWire(
      [
        ...wires,
        ...REF_SEED_WIRES,
        { ...leaf, id: "n.c1", text: "c1" },
        ctxRefWire("n.ref", "n.root-a"),
      ],
      fixtureGraph.rev,
      "fixtures",
    );
  }
  it("opens the row and every row under it, and closes them all again; siblings untouched", async () => {
    seedSiblingAndReference();
    expect(["n.root-a", "n.child-a2", "n.root-c"].map(collapsed)).toEqual([true, true, true]);
    await outline().expandSubtree(keyOf("n.root-a"), MAIN_OUTLINE_HOST);
    expect(["n.root-a", "n.child-a2", "n.root-c"].map(collapsed)).toEqual([false, false, true]);
    await outline().collapseSubtree(keyOf("n.root-a"), MAIN_OUTLINE_HOST);
    expect(["n.root-a", "n.child-a2", "n.root-c"].map(collapsed)).toEqual([true, true, true]);
  });

  it("closes what was open below a closed row too", async () => {
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(collapsed("n.child-a2")).toBe(false);
    await outline().collapseSubtree(keyOf("n.root-a"), MAIN_OUTLINE_HOST);
    expect(collapsed("n.child-a2")).toBe(true);
  });

  it("a reference's subtree is its target's rows, under the reference", async () => {
    seedSiblingAndReference();
    outline().toggleCollapse(rowKey("n.root-c"));
    await outline().expandSubtree(childInstanceKey(keyOf("n.root-c"), "n.ref"), MAIN_OUTLINE_HOST);
    const ref = childInstanceKey(keyOf("n.root-c"), "n.ref");
    expect(collapsed("n.ref")).toBe(false);
    expect(rowClosed("n.child-a2", childInstanceKey(ref, "n.child-a2"))).toBe(false);
    // The target's own row is another place: its choice is its own.
    expect(collapsed("n.root-a")).toBe(true);
  });

  it("Expand all and Collapse all are the subtrees of the scope's top rows", async () => {
    seedSiblingAndReference();
    await outline().expandAllInScope();
    expect(["n.root-a", "n.child-a2", "n.root-c", "n.ref"].map(collapsed)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    await outline().collapseAllInScope();
    expect(["n.root-a", "n.child-a2", "n.root-c", "n.ref"].map(collapsed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("expansion keeps only choices the reader can undo", () => {
  it("a closed row that loses its children and gains them again is never stuck closed", () => {
    // Its parent open, so the row is drawn.
    outline().toggleCollapse(rowKey("n.root-a"));
    // Open, then close: closing returns the row to its default, so no choice is kept.
    outline().toggleCollapse(rowKey("n.child-a2"));
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(collapsed("n.child-a2")).toBe(true);
    expect(outline().expansion.has(placeOf("n.child-a2"))).toBe(false);

    // It loses its children: a leaf shows open, and there is nothing to toggle.
    graph().applyTx([{ ...wireOf("n.child-a2"), children: [] }], [], { rev: 2 });
    expect(collapsed("n.child-a2")).toBe(false);
    expect(outline().expansion.has(placeOf("n.child-a2"))).toBe(false);

    // It gains them again while shown open: it stays open, as a choice the reader can undo.
    graph().applyTx([{ ...wireOf("n.child-a2"), children: ["n.grandchild"] }], [], { rev: 3 });
    expect(collapsed("n.child-a2")).toBe(false);
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(collapsed("n.child-a2")).toBe(true);
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(collapsed("n.child-a2")).toBe(false);

    // A reload shows what the page showed.
    reload();
    expect(collapsed("n.child-a2")).toBe(false);
  });

  it("a row closed against an open default reopens once it cannot expand, and storage agrees", () => {
    // A tagged row with no value yet: its tag's field slot makes it expandable, open by default.
    const tagged = {
      ...wireOf("n.root-c"),
      props: { "sys.f.type": [{ t: "ref" as const, v: "tag.todo" }] },
    };
    graph().applyTx([tagged], [], { rev: 2 });
    expect(collapsed("n.root-c")).toBe(false);
    outline().toggleCollapse(rowKey("n.root-c"));
    expect(collapsed("n.root-c")).toBe(true);
    expect(outline().expansion.get(placeOf("n.root-c"))).toBe(false);
    // Storage keeps the closed choice, so a reload shows it closed too.
    expect(stored().closed).toContain(placeOf("n.root-c"));

    // The tag goes: the row cannot expand, so no choice can hold it closed.
    graph().applyTx([{ ...tagged, props: {} }], [], { rev: 3 });
    expect(collapsed("n.root-c")).toBe(false);
    expect(outline().expansion.has(placeOf("n.root-c"))).toBe(false);
    expect(stored().closed).not.toContain(placeOf("n.root-c"));
    reload();
    expect(collapsed("n.root-c")).toBe(false);
  });

  it("a row deleted and restored by an undo comes back as the reader left it", () => {
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(collapsed("n.child-a2")).toBe(false);
    const place = placeOf("n.child-a2");
    const parent = wireOf("n.root-a");
    const row = wireOf("n.child-a2");
    graph().applyTx([{ ...parent, children: ["n.child-a1"] }], ["n.child-a2"], { rev: 2 });
    expect(outline().expansion.get(place)).toBe(true);
    graph().applyTx([parent, row], [], { rev: 3 });
    expect(collapsed("n.child-a2")).toBe(false);
    expect(stored().open).toContain(place);
  });

  it("storage holds exactly the outline's choices", () => {
    outline().toggleCollapse(rowKey("n.root-a"));
    outline().toggleCollapse(rowKey("n.child-a2"));
    outline().toggleCollapse(rowKey("n.child-a2"));
    const { open: opened, closed } = stored();
    const held = [...outline().expansion];
    expect(new Set(opened)).toEqual(new Set(held.filter(([, open]) => open).map(([id]) => id)));
    expect(new Set(closed)).toEqual(new Set(held.filter(([, open]) => !open).map(([id]) => id)));
    expect(opened).toEqual([placeOf("n.root-a")]);
  });
});

describe("each tab keeps its own expansion while open; storage seeds it at load", () => {
  it("another tab's write is not merged in by a graph move, and is read at the next load", () => {
    expect(collapsed("n.root-a")).toBe(true);
    // Another tab opens `n.root-a`: it writes the shared storage.
    anotherTabStores([placeOf("n.root-a")]);
    graph().applyTx([{ ...wireOf("n.root-c"), text: "renamed" }], [], { rev: 2 });
    expect(collapsed("n.root-a")).toBe(true);
    reload();
    expect(collapsed("n.root-a")).toBe(false);
  });

  it("a choice this tab makes keeps the other tab's choices: a save writes changes, not a snapshot", () => {
    anotherTabStores([placeOf("n.child-a2")]);
    outline().toggleCollapse(rowKey("n.root-a"));
    expect(stored().open.toSorted()).toEqual(
      [placeOf("n.child-a2"), placeOf("n.root-a")].toSorted(),
    );
    reload();
    expect(collapsed("n.root-a")).toBe(false);
    expect(collapsed("n.child-a2")).toBe(false);
  });

  it("a load writes nothing", () => {
    outline().toggleCollapse(rowKey("n.root-a"));
    writes();
    reload();
    expect(writes()).toBe(0);
  });
});

describe("the legacy stored forms", () => {
  it("is read whole while no build has written the current one, and is not rewritten", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    // Open by default: a leaf (`n.child-a1`); collapsed by default: rows with
    // children (`n.root-a`, `n.child-a2`) or a field value (`n.root-b`).
    const legacy = JSON.stringify(["n.root-a", "n.child-a1", "n.child-a2"]);
    localStorage.setItem(EXPANDED_STORAGE_KEY, legacy);
    writes();
    reload();
    expect(writes()).toBe(0);
    expect(collapsed("n.root-a")).toBe(false);
    expect(collapsed("n.child-a1")).toBe(false);
    expect(collapsed("n.child-a2")).toBe(false);
    expect(collapsed("n.root-b")).toBe(true);
    expect(collapsed("n.root-c")).toBe(false);
    // The open default is no choice to keep.
    expect(outline().expansion.has(placeOf("n.child-a1"))).toBe(false);
    expect(localStorage.getItem(EXPANSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(EXPANDED_STORAGE_KEY)).toBe(legacy);
  });

  it("a node's one choice, stored by id, is its row's in the tree, and a save stores it as that place", () => {
    anotherTabStores(["n.root-a"], ["n.child-a2"]);
    reload();
    expect(collapsed("n.root-a")).toBe(false);
    expect(outline().expansion.get(placeOf("n.root-a"))).toBe(true);
    outline().toggleCollapse(rowKey("n.child-a2"));
    expect(stored().open.toSorted()).toEqual(
      [placeOf("n.child-a2"), placeOf("n.root-a")].toSorted(),
    );
  });
});

describe("a choice is its place's", () => {
  it("an outline in another pane shares the tree's places", () => {
    expect(placeOfInstance("pane:p1/n.root-a/n.child-a2")).toBe(placeOf("n.child-a2"));
  });
});
