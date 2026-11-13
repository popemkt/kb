/**
 * Keys across contexts (DESIGN-UI.md → Keybindings): a page context is
 * offered every key before any surface is, so the two are decided together
 * and neither shadows the other.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "@kb/plugin";
import { admitKeymaps, provideKeybinding, type KeyContext, type Keybinding } from "./keybindings";
import { PALETTE_CHORD, type Chord, type KeyChordEvent } from "./keychord";

/** A chord by place: the key `KeyboardEvent.code` names, and the modifiers it asks about. */
const at = (place: string, modifiers: Omit<Chord, "key" | "code"> = {}): Chord => ({
  ...modifiers,
  code: place,
});

/** A key event: the character it types, the key's place, and the modifiers held. */
const pressed = (
  key: string,
  place: string,
  held: Omit<KeyChordEvent, "key" | "code"> = {},
): KeyChordEvent => ({ ...held, key, code: place });

/** A host that approves every owner replacing what another holds. */
const ANYONE = () => true;

const PAGE: KeyContext = {
  id: "core.page",
  owner: "core",
  reach: "page",
  intents: ["palette"],
  reserved: [{ mod: false }, PALETTE_CHORD],
};

/** The row being edited: a surface context its owner, the fixture's notes plugin, contributes. */
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
  spec: Parameters<typeof provideKeybinding>[1],
): Contribution<Keybinding> {
  return { id: `${owner}.${id}`, aliases: [], owner, value: provideKeybinding(id, spec).value };
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

describe("a keymap's chords by place", () => {
  it("are held beside chords by character, and asked first", () => {
    // The numpad's ↵ by its place, beside the split's ↵ by character.
    const byPlace: Contribution<Keybinding> = {
      ...SPLIT,
      id: "notes.numpad-enter",
      value: { ...SPLIT.value, chord: at("NumpadEnter", { mod: false }) },
    };
    const keymap = admitKeymaps([ROW], [SPLIT, byPlace], ANYONE).get(EDITING);
    expect(keymap?.refused).toEqual([]);
    expect(keymap?.resolve(pressed("Enter", "NumpadEnter"))?.id).toBe("notes.numpad-enter");
    expect(keymap?.resolve(pressed("Enter", "Enter"))?.id).toBe(SPLIT.id);
  });
});

describe("reservations across character and physical chords", () => {
  it("keeps physical bare keys out of the page", () => {
    const typed: Contribution<Keybinding> = {
      id: "x.typed",
      owner: "x",
      aliases: [],
      value: {
        context: "core.page",
        chord: at("KeyA", { mod: false }),
        run: { command: "x.go" },
      },
    };
    const km = admitKeymaps([PAGE], [PALETTE, typed], ANYONE).get("core.page");
    expect(km?.refused.map((b) => b.id)).toContain("x.typed");
    expect(km?.resolve(pressed("a", "KeyA"))).toBeUndefined();
  });
  it("keeps physical Escape reserved in a surface", () => {
    const surface: KeyContext = {
      id: "sketch.transform",
      owner: "sketch",
      reach: "surface",
      intents: ["cancel"],
      reserved: [{ key: "Escape" }],
    };
    const cancel: Contribution<Keybinding> = {
      id: "sketch.cancel",
      owner: "sketch",
      aliases: [],
      value: { context: surface.id, chord: { key: "Escape" }, run: { intent: "cancel" } },
    };
    const trap: Contribution<Keybinding> = {
      id: "x.trap",
      owner: "x",
      aliases: [],
      value: { context: surface.id, chord: at("Escape"), run: { command: "x.go" } },
    };
    const km = admitKeymaps([surface], [cancel, trap], ANYONE).get(surface.id);
    expect(km?.refused.map((b) => b.id)).toContain("x.trap");
    expect(km?.resolve(pressed("Escape", "Escape"))?.id).toBe("sketch.cancel");
  });
});

for (const physicalPage of [false, true]) {
  it(`refuses page/surface shadowing with ${physicalPage ? "physical page" : "physical surface"}`, () => {
    const characterPage = binding("x", "page", {
      context: "core.page",
      chord: "Mod-F2",
      run: { command: "x.go" },
    });
    const page = physicalPage
      ? {
          ...characterPage,
          value: { ...characterPage.value, chord: at("F2", { mod: true }) },
        }
      : characterPage;
    const surface = physicalPage
      ? { ...INDENT, value: { ...INDENT.value, chord: { key: "F2", mod: true } } }
      : { ...INDENT, value: { ...INDENT.value, chord: at("F2", { mod: true }) } };
    const maps = admitKeymaps([PAGE, ROW], [PALETTE, surface, page], ANYONE);
    expect(maps.get(PAGE.id)?.refused.map((b) => b.id)).toContain("x.page");
  });
}
it("refuses a physical palette chord while retaining numpad precedence", () => {
  const physical: Contribution<Keybinding> = {
    id: "x.palette",
    owner: "x",
    aliases: [],
    value: { context: "core.page", chord: at("KeyK", { mod: true }), run: { command: "x.go" } },
  };
  const numpad = {
    ...SPLIT,
    id: "notes.numpad",
    value: { ...SPLIT.value, chord: at("NumpadEnter", { mod: false }) },
  };
  const maps = admitKeymaps([PAGE, ROW], [PALETTE, physical, SPLIT, numpad], ANYONE);
  expect(maps.get(PAGE.id)?.refused.map((b) => b.id)).toContain("x.palette");
  expect(maps.get(ROW.id)?.refused).toEqual([]);
  expect(maps.get(ROW.id)?.resolve(pressed("Enter", "NumpadEnter"))?.id).toBe("notes.numpad");
});

it("keeps the palette ahead of a physical surface-owner binding", () => {
  const trap = { ...INDENT, value: { ...INDENT.value, chord: at("KeyK", { mod: true }) } };
  const maps = admitKeymaps([PAGE, ROW], [PALETTE, trap], ANYONE);
  expect(maps.get(PAGE.id)?.resolve(pressed("k", "KeyK", { metaKey: true }))?.id).toBe(PALETTE.id);
  expect(maps.get(ROW.id)?.refused.map((b) => b.id)).toContain(INDENT.id);
});

it("requires replacement approval when another owner takes a character chord by code", () => {
  const physical: Contribution<Keybinding> = {
    id: "x.enter",
    owner: "x",
    aliases: [],
    value: {
      context: ROW.id,
      chord: at("NumpadEnter", { mod: false }),
      run: { command: "x.go" },
    },
  };
  expect(
    admitKeymaps([ROW], [SPLIT, physical], ANYONE)
      .get(ROW.id)
      ?.refused.map((b) => b.id),
  ).toContain(physical.id);
  const replacement = { ...physical, value: { ...physical.value, replaces: SPLIT.id } };
  expect(
    admitKeymaps([ROW], [SPLIT, replacement], () => false)
      .get(ROW.id)
      ?.refused.map((b) => b.id),
  ).toContain(physical.id);
  expect(
    admitKeymaps([ROW], [SPLIT, replacement], ANYONE)
      .get(ROW.id)
      ?.resolve(pressed("Enter", "NumpadEnter"))?.id,
  ).toBe(physical.id);
});

describe("replacements across precedence slots", () => {
  const numpad: Contribution<Keybinding> = {
    ...SPLIT,
    id: "notes.numpad",
    value: { ...SPLIT.value, chord: at("NumpadEnter", { mod: false }) },
  };
  it("lets an approved character replacement replace a physical holder", () => {
    const replacement: Contribution<Keybinding> = {
      id: "x.enter",
      owner: "x",
      aliases: [],
      value: {
        context: ROW.id,
        chord: { key: "Enter", mod: false },
        run: { command: "x.go" },
        replaces: numpad.id,
      },
    };
    const map = admitKeymaps([ROW], [numpad, replacement], ANYONE).get(ROW.id);
    expect(map?.refused).toEqual([]);
    expect(
      admitKeymaps([ROW], [SPLIT, numpad, replacement], () => false)
        .get(ROW.id)
        ?.refused.map((b) => b.id),
    ).toContain(replacement.id);
    expect(map?.resolve(pressed("Enter", "NumpadEnter"))?.id).toBe(replacement.id);
  });
  it("lets an approved physical replacement replace its holder with a lower-priority fallback present", () => {
    const replacement: Contribution<Keybinding> = {
      id: "x.numpad",
      owner: "x",
      aliases: [],
      value: {
        context: ROW.id,
        chord: at("NumpadEnter", { mod: false }),
        run: { command: "x.go" },
        replaces: numpad.id,
      },
    };
    const map = admitKeymaps([ROW], [SPLIT, numpad, replacement], ANYONE).get(ROW.id);
    expect(map?.refused).toEqual([]);
    expect(
      admitKeymaps([ROW], [SPLIT, numpad, replacement], () => false)
        .get(ROW.id)
        ?.refused.map((b) => b.id),
    ).toContain(replacement.id);
    expect(map?.resolve(pressed("Enter", "NumpadEnter"))?.id).toBe(replacement.id);
    expect(map?.resolve(pressed("Enter", "Enter"))?.id).toBe(SPLIT.id);
  });
});

it("refuses a physical replacement that expands beyond its holder into a fallback", () => {
  const numpad = {
    ...SPLIT,
    id: "notes.numpad",
    value: { ...SPLIT.value, chord: at("NumpadEnter", { mod: false, shift: false }) },
  };
  const replacement: Contribution<Keybinding> = {
    id: "x.numpad",
    owner: "x",
    aliases: [],
    value: {
      context: ROW.id,
      chord: at("NumpadEnter", { mod: false }),
      run: { command: "x.go" },
      replaces: numpad.id,
    },
  };
  const fallback = { ...SPLIT, value: { ...SPLIT.value, chord: { key: "Enter", mod: false } } };
  const map = admitKeymaps([ROW], [fallback, numpad, replacement], ANYONE).get(ROW.id);
  expect(map?.refused.map((b) => b.id)).toContain(replacement.id);
  expect(map?.resolve(pressed("Enter", "NumpadEnter", { shiftKey: true }))?.id).toBe(SPLIT.id);
});
