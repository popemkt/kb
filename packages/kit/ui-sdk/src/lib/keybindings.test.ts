/**
 * Keys across contexts (DESIGN-UI.md → Keybindings): a page context is
 * offered every key before any surface is, so the two are decided together
 * and neither shadows the other.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "@kb/plugin";
import { admitKeymaps, type KeyContext, type Keybinding } from "./keybindings";
import { PALETTE_CHORD, parseChord } from "./keychord";

/** A host that approves every owner replacing what another holds. */
const ANYONE = () => true;

const PAGE: KeyContext = {
  id: "core.page",
  owner: "core",
  reach: "page",
  intents: ["palette"],
  reserved: [{ mod: false }, PALETTE_CHORD],
};

/**
 * The row being edited: a surface context, named once. Admission reads any
 * context a plugin contributes, so the fixture's own plugin names it, not a
 * context core lists in KeyContextId. GAP [[01M7A4XKCMH09XC5WT6KEBFV4H]]
 */
const EDITING = "notes.editing";

const ROW: KeyContext = {
  id: EDITING,
  owner: "notes",
  reach: "surface",
  intents: ["split", "indent"],
  reserved: [],
};

/** A binding as `owner`'s plugin contributes it: its id namespaced by the owner's name. */
function binding(
  owner: string,
  id: string,
  spec: Omit<Keybinding, "chord"> & { readonly chord: string },
): Contribution<Keybinding> {
  const chord = parseChord(spec.chord);
  if (chord === null) throw new Error(`keybinding ${id}: "${spec.chord}" is not a chord`);
  return { id: `${owner}.${id}`, aliases: [], owner, value: { ...spec, chord } };
}

const PALETTE = binding("core", "page.palette", {
  context: "core.page",
  chord: "Mod-k",
  run: { intent: "palette" },
});
const SPLIT = binding("notes", "split", {
  context: EDITING,
  chord: "Enter",
  run: { intent: "split" },
});
const INDENT = binding("notes", "indent", {
  context: EDITING,
  chord: "Mod-]",
  run: { intent: "indent" },
});

describe("a page context's keys", () => {
  it("holds a plugin's key that holds ⌘ or Ctrl, and runs its command", () => {
    const today = binding("planner", "today", {
      context: "core.page",
      chord: "Mod-Shift-D",
      run: { command: "sys.cmd.days.today" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, SPLIT, INDENT, today], ANYONE);
    const page = keymaps.get("core.page");
    expect(page?.refused).toEqual([]);
    expect(page?.resolve({ key: "d", metaKey: true, shiftKey: true })?.value.run).toEqual({
      command: "sys.cmd.days.today",
    });
    expect(keymaps.get(EDITING)?.refused).toEqual([]);
  });

  it("refuses a key without ⌘ or Ctrl, so a page key never takes typing", () => {
    const typed = binding("planner", "t", {
      context: "core.page",
      chord: "t",
      run: { command: "sys.cmd.days.today" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, typed], ANYONE);
    expect(keymaps.get("core.page")?.refused).toEqual([
      { id: "planner.t", reason: "t is reserved in core.page" },
    ]);
  });

  it("refuses ⌘K to any plugin, even one replacing the palette's", () => {
    const taken = binding("x", "k", {
      context: "core.page",
      chord: "Mod-k",
      run: { command: "x.go" },
      replaces: "core.page.palette",
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, taken], ANYONE);
    expect(keymaps.get("core.page")?.refused.map(({ id }) => id)).toEqual(["x.k"]);
    expect(keymaps.get("core.page")?.resolve({ key: "k", ctrlKey: true })?.id).toBe(
      "core.page.palette",
    );
  });

  it("refuses a chord a surface's owner binds there, so the surface's own key stands", () => {
    const over = binding("x", "over", {
      context: "core.page",
      chord: "Mod-]",
      run: { command: "x.go" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, INDENT, over], ANYONE);
    expect(keymaps.get("core.page")?.refused).toEqual([
      { id: "x.over", reason: `Mod-] is ${EDITING}'s own, held by notes.indent` },
    ]);
    expect(keymaps.get(EDITING)?.resolve({ key: "]", metaKey: true })?.id).toBe("notes.indent");
  });
});

describe("a surface context's keys", () => {
  it("refuses another plugin's binding over a chord the page holds, which it would never reach", () => {
    const today = binding("planner", "today", {
      context: "core.page",
      chord: "Mod-Shift-D",
      run: { command: "d" },
    });
    const under = binding("x", "under", {
      context: EDITING,
      chord: "Mod-Shift-d",
      run: { intent: "split" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, today, under], ANYONE);
    expect(keymaps.get(EDITING)?.refused).toEqual([
      { id: "x.under", reason: "Mod-Shift-d is the page's, held by planner.today" },
    ]);
  });
});
