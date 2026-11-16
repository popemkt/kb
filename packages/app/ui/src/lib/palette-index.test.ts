import { describe, expect, it } from "vitest";
import { bundledSeed } from "@kb/bundled";
import { SHORTCUT_IDS } from "@kb/keybindings";
import { present, SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import {
  buildPaletteIndex,
  searchPalette,
  withNodeCommands,
  type PaletteIndex,
} from "@/lib/palette-index";

const ISO = "2026-08-08T00:00:00.000Z";

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return {
    id,
    text,
    props,
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

/**
 * `index` with its entries counting each read of one, and that count. A
 * keystroke's cost is how many entries it reads, which no load can change:
 * the claim under test is a count, not a time.
 */
function counted(index: PaletteIndex): { index: PaletteIndex; reads: () => number } {
  let reads = 0;
  const entries = new Proxy(index.entries, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/u.test(key)) reads += 1;
      return target[key as keyof PaletteIndex["entries"]];
    },
  });
  return { index: { ...index, entries }, reads: () => reads };
}

describe("palette index", () => {
  it("indexes all nodes including field/tag/sys/command", () => {
    const nodes = [
      node(SYSTEM_IDS.field, "sys.field"),
      node(SYSTEM_IDS.command, "sys.command"),
      node(SYSTEM_IDS.cmdAddNode, "Add node", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
      node("tag.todo", "todo", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      }),
      node("n.1", "Ship palette"),
    ];
    const index = buildPaletteIndex(nodes, 3);
    expect(index.rev).toBe(3);
    expect(index.entries).toHaveLength(5);
    expect(index.entries.filter((e) => e.kind === "command")).toHaveLength(1);
    expect(index.entries.some((e) => e.id === SYSTEM_IDS.field)).toBe(true);
    expect(index.entries.some((e) => e.id === "tag.todo")).toBe(true);
  });

  it("fuzzy-matches over prebuilt haystack and caps at 20", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`n.${i}`, `Node alpha ${i}`));
    nodes.push(
      node(SYSTEM_IDS.cmdGoQuery, "Go to query page", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
    );
    const index = buildPaletteIndex(nodes, 1);
    const hits = searchPalette(index, "query", 20);
    expect(hits.length).toBeGreaterThan(0);
    const hit = present(hits.at(0), "first hit");
    expect(hit.kind).toBe("command");
    expect(hit.id).toBe(SYSTEM_IDS.cmdGoQuery);

    const many = searchPalette(index, "alpha", 20);
    expect(many).toHaveLength(20);
  });

  it("lists a node by its title and finds it by its title or its text", () => {
    const nodes = [
      node("f.who", "who", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] }),
      node("t.task", "task", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.tagTitleField]: [{ t: "str", v: "[[sys.f.node.text]] for [[f.who]]" }],
      }),
      node("n.ann", "Ann"),
      node("n.notes", "Write the notes", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.task" }],
        "f.who": [{ t: "ref", v: "n.ann" }],
      }),
    ];
    const index = buildPaletteIndex(nodes, 1);
    const titled = (query: string) => searchPalette(index, query).find((h) => h.id === "n.notes");
    expect(titled("for ann")?.text).toBe("Write the notes for Ann");
    expect(titled("write the notes")?.text).toBe("Write the notes for Ann");
  });

  it("lists a node command once, in the place of the global command it is", () => {
    // A node command a key binds is a command node too (Copy as… on
    // Mod-Shift-C): one act, one row, so no two rows share an id.
    const command = node("sys.cmd.both", "Both", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
    });
    const faced = node("sys.cmd.faced", "Faced", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
    });
    const index = withNodeCommands(
      buildPaletteIndex([command, faced, node("n1", "Check up with Rob")], 1),
      [
        { id: "sys.cmd.both", label: "Both" },
        { id: "node.face", label: "Face", faceOf: "sys.cmd.faced" },
      ],
      "Fixture root",
    );
    const ids = searchPalette(index, "").map((hit) => hit.id);
    expect(ids).toEqual(["sys.cmd.both", "node.face", "n1"]);
    expect(index.entries.find((entry) => entry.id === "sys.cmd.both")?.target).toBe("Fixture root");
  });

  it("keystroke search stays a single linear pass at 50k nodes", () => {
    const N = 50_000;
    const nodes: WireNode[] = [
      node(SYSTEM_IDS.command, "sys.command"),
      node(SYSTEM_IDS.cmdAddNode, "Add node", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
    ];
    for (let i = 0; i < N; i++) {
      nodes.push(node(`01BENCH${String(i).padStart(20, "0")}`, `node ${i}`));
    }

    const index = buildPaletteIndex(nodes, 1);
    const openHits = searchPalette(index, "", 20);
    expect(openHits).toHaveLength(20);
    expect(present(openHits.at(0), "first hit").kind).toBe("command");

    // A keystroke that finds its text reads each entry once: one linear pass
    // over the prebuilt haystack, with no second (fuzzy) pass and no sort or
    // copy of the entries. A rebuild, a sort or a second pass reads more.
    const keystroke = counted(index);
    const keyHits = searchPalette(keystroke.index, "node 1234", 20);
    expect(keyHits.map((hit) => hit.text)).toContain("node 1234");
    expect(keystroke.reads()).toBe(index.entries.length);

    // Fuzzy matching runs only when no entry holds the text, as a second
    // pass that stops at the limit: never more than two passes.
    const fuzzy = counted(index);
    expect(searchPalette(fuzzy.index, "nd 49999", 20).length).toBeGreaterThan(0);
    expect(fuzzy.reads()).toBeLessThanOrEqual(2 * index.entries.length);
  });
});

it("keeps registered surface intents out of global browsing and search", () => {
  const nodes = bundledSeed(ISO);
  const commands = nodes.filter((row) => row.props[SHORTCUT_IDS.commandContext] !== undefined);
  expect(commands).toHaveLength(123);
  const index = buildPaletteIndex(nodes, 1);
  const listed = new Set(index.entries.map(({ id }) => id));
  for (const command of commands) {
    expect(listed.has(command.id)).toBe(false);
    expect(searchPalette(index, command.text).some((hit) => hit.id === command.id)).toBe(false);
  }
  expect(index.entries.find((entry) => entry.id === SYSTEM_IDS.cmdAddNode)?.kind).toBe("command");
  expect(index.entries.find((entry) => entry.id === SYSTEM_IDS.cmdExpandAll)?.kind).toBe("command");
});
