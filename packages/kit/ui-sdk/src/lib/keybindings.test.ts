/**
 * Keys across contexts (DESIGN-UI.md → Keybindings): a page context is
 * offered every key before any surface is, so the two are decided together
 * and neither shadows the other.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "@kb/plugin";
import { admitKeymaps, provideKeybinding, type KeyContext, type Keybinding } from "./keybindings";
import { PALETTE_CHORD } from "./keychord";

/** A host that approves every owner replacing what another holds. */
const ANYONE = () => true;

const PAGE: KeyContext = {
  id: "core.page",
  owner: "core",
  reach: "page",
  intents: ["palette"],
  reserved: [{ mod: false }, PALETTE_CHORD],
};

const ROW: KeyContext = {
  id: "outline.editing",
  owner: "outline",
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
const SPLIT = binding("outline", "split", {
  context: "outline.editing",
  chord: "Enter",
  run: { intent: "split" },
});
const INDENT = binding("outline", "indent", {
  context: "outline.editing",
  chord: "Mod-]",
  run: { intent: "indent" },
});

describe("a page context's keys", () => {
  it("holds a plugin's key that holds ⌘ or Ctrl, and runs its command", () => {
    const today = binding("days", "today", {
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
    expect(keymaps.get("outline.editing")?.refused).toEqual([]);
  });

  it("refuses a key without ⌘ or Ctrl, so a page key never takes typing", () => {
    const typed = binding("days", "t", {
      context: "core.page",
      chord: "t",
      run: { command: "sys.cmd.days.today" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, typed], ANYONE);
    expect(keymaps.get("core.page")?.refused).toEqual([
      { id: "days.t", reason: "t is reserved in core.page" },
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
      { id: "x.over", reason: "Mod-] is outline.editing's own, held by outline.indent" },
    ]);
    expect(keymaps.get("outline.editing")?.resolve({ key: "]", metaKey: true })?.id).toBe(
      "outline.indent",
    );
  });
});

describe("a surface context's keys", () => {
  it("refuses another plugin's binding over a chord the page holds, which it would never reach", () => {
    const today = binding("days", "today", {
      context: "core.page",
      chord: "Mod-Shift-D",
      run: { command: "d" },
    });
    const under = binding("x", "under", {
      context: "outline.editing",
      chord: "Mod-Shift-d",
      run: { intent: "split" },
    });
    const keymaps = admitKeymaps([PAGE, ROW], [PALETTE, today, under], ANYONE);
    expect(keymaps.get("outline.editing")?.refused).toEqual([
      { id: "x.under", reason: "Mod-Shift-d is the page's, held by days.today" },
    ]);
  });
});

describe("a keymap's chords by place", () => {
  it("are held beside chords by character, and asked first", () => {
    // The numpad's ↵ by its place, beside the split's ↵ by character.
    const byPlace: Contribution<Keybinding> = {
      ...SPLIT,
      id: "outline.numpad-enter",
      value: { ...SPLIT.value, chord: { code: "NumpadEnter", mod: false } },
    };
    const keymap = admitKeymaps([ROW], [SPLIT, byPlace], ANYONE).get("outline.editing");
    expect(keymap?.refused).toEqual([]);
    expect(keymap?.resolve({ key: "Enter", code: "NumpadEnter" })?.id).toBe("outline.numpad-enter");
    expect(keymap?.resolve({ key: "Enter", code: "Enter" })?.id).toBe("outline.split");
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
        chord: { code: "KeyA", mod: false },
        run: { command: "x.go" },
      },
    };
    const km = admitKeymaps([PAGE], [PALETTE, typed], ANYONE).get("core.page");
    expect(km?.refused.map((b) => b.id)).toContain("x.typed");
    expect(km?.resolve({ key: "a", code: "KeyA" })).toBeUndefined();
  });
  it("keeps physical Escape reserved in a surface", () => {
    const surface: KeyContext = {
      id: "canvas.transform",
      owner: "canvas",
      reach: "surface",
      intents: ["cancel"],
      reserved: [{ key: "Escape" }],
    };
    const cancel: Contribution<Keybinding> = {
      id: "canvas.cancel",
      owner: "canvas",
      aliases: [],
      value: { context: surface.id, chord: { key: "Escape" }, run: { intent: "cancel" } },
    };
    const trap: Contribution<Keybinding> = {
      id: "x.trap",
      owner: "x",
      aliases: [],
      value: { context: surface.id, chord: { code: "Escape" }, run: { command: "x.go" } },
    };
    const km = admitKeymaps([surface], [cancel, trap], ANYONE).get(surface.id);
    expect(km?.refused.map((b) => b.id)).toContain("x.trap");
    expect(km?.resolve({ key: "Escape", code: "Escape" })?.id).toBe("canvas.cancel");
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
          value: { ...characterPage.value, chord: { code: "F2", mod: true } },
        }
      : characterPage;
    const surface = physicalPage
      ? { ...INDENT, value: { ...INDENT.value, chord: { key: "F2", mod: true } } }
      : { ...INDENT, value: { ...INDENT.value, chord: { code: "F2", mod: true } } };
    const maps = admitKeymaps([PAGE, ROW], [PALETTE, surface, page], ANYONE);
    expect(maps.get(PAGE.id)?.refused.map((b) => b.id)).toContain("x.page");
  });
}
it("refuses a physical palette chord while retaining numpad precedence", () => {
  const physical: Contribution<Keybinding> = {
    id: "x.palette",
    owner: "x",
    aliases: [],
    value: { context: "core.page", chord: { code: "KeyK", mod: true }, run: { command: "x.go" } },
  };
  const numpad = {
    ...SPLIT,
    id: "outline.numpad",
    value: { ...SPLIT.value, chord: { code: "NumpadEnter", mod: false } },
  };
  const maps = admitKeymaps([PAGE, ROW], [PALETTE, physical, SPLIT, numpad], ANYONE);
  expect(maps.get(PAGE.id)?.refused.map((b) => b.id)).toContain("x.palette");
  expect(maps.get(ROW.id)?.refused).toEqual([]);
  expect(maps.get(ROW.id)?.resolve({ key: "Enter", code: "NumpadEnter" })?.id).toBe(
    "outline.numpad",
  );
});

it("keeps the palette ahead of a physical surface-owner binding", () => {
  const trap = { ...INDENT, value: { ...INDENT.value, chord: { code: "KeyK", mod: true } } };
  const maps = admitKeymaps([PAGE, ROW], [PALETTE, trap], ANYONE);
  expect(maps.get(PAGE.id)?.resolve({ key: "k", code: "KeyK", metaKey: true })?.id).toBe(
    PALETTE.id,
  );
  expect(maps.get(ROW.id)?.refused.map((b) => b.id)).toContain(INDENT.id);
});

it("requires replacement approval when another owner takes a character chord by code", () => {
  const physical: Contribution<Keybinding> = {
    id: "x.enter",
    owner: "x",
    aliases: [],
    value: {
      context: ROW.id,
      chord: { code: "NumpadEnter", mod: false },
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
      ?.resolve({ key: "Enter", code: "NumpadEnter" })?.id,
  ).toBe(physical.id);
});

describe("replacements across precedence slots", () => {
  const numpad: Contribution<Keybinding> = {
    ...SPLIT,
    id: "outline.numpad",
    value: { ...SPLIT.value, chord: { code: "NumpadEnter", mod: false } },
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
    expect(map?.resolve({ key: "Enter", code: "NumpadEnter" })?.id).toBe(replacement.id);
  });
  it("lets an approved physical replacement replace its holder with a lower-priority fallback present", () => {
    const replacement: Contribution<Keybinding> = {
      id: "x.numpad",
      owner: "x",
      aliases: [],
      value: {
        context: ROW.id,
        chord: { code: "NumpadEnter", mod: false },
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
    expect(map?.resolve({ key: "Enter", code: "NumpadEnter" })?.id).toBe(replacement.id);
    expect(map?.resolve({ key: "Enter", code: "Enter" })?.id).toBe(SPLIT.id);
  });
});

it("refuses a physical replacement that expands beyond its holder into a fallback", () => {
  const numpad = {
    ...SPLIT,
    id: "outline.numpad",
    value: { ...SPLIT.value, chord: { code: "NumpadEnter", mod: false, shift: false } },
  };
  const replacement: Contribution<Keybinding> = {
    id: "x.numpad",
    owner: "x",
    aliases: [],
    value: {
      context: ROW.id,
      chord: { code: "NumpadEnter", mod: false },
      run: { command: "x.go" },
      replaces: numpad.id,
    },
  };
  const fallback = { ...SPLIT, value: { ...SPLIT.value, chord: { key: "Enter", mod: false } } };
  const map = admitKeymaps([ROW], [fallback, numpad, replacement], ANYONE).get(ROW.id);
  expect(map?.refused.map((b) => b.id)).toContain(replacement.id);
  expect(map?.resolve({ key: "Enter", code: "NumpadEnter", shiftKey: true })?.id).toBe(SPLIT.id);
});
