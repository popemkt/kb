import { describe, expect, it } from "vitest";
import { admitKeybindings, provideKeybinding } from "@kb/ui-sdk";
import { EDITING_BINDINGS, EDITING_CONTEXT } from "./editing-keymap";
import { SELECTION_BINDINGS, SELECTION_CONTEXT } from "./selection-keymap";
import { outlineKeybindings } from "./test-support/keybindings";

/**
 * The outline's keys are bindings like any plugin's, held by the page's one
 * keymap. Its own chords never overlap, so every one is admitted and the
 * order they are listed in means nothing.
 */
describe("the outline's keybindings", () => {
  it.each([
    [EDITING_CONTEXT, EDITING_BINDINGS],
    [SELECTION_CONTEXT, SELECTION_BINDINGS],
  ] as const)("admits every binding of $id, refusing none", (context, bindings) => {
    const keymap = admitKeybindings(context, outlineKeybindings());
    expect(keymap.refused).toEqual([]);
    const reversed = admitKeybindings(context, outlineKeybindings().toReversed());
    expect(reversed.refused).toEqual([]);
    expect(bindings.length).toBeGreaterThan(0);
  });

  it("runs only intents its context names", () => {
    for (const [context, bindings] of [
      [EDITING_CONTEXT, EDITING_BINDINGS],
      [SELECTION_CONTEXT, SELECTION_BINDINGS],
    ] as const) {
      for (const { value } of bindings) {
        expect("intent" in value.run && context.intents.includes(value.run.intent)).toBe(true);
      }
    }
  });

  it("refuses another plugin's binding over a held or reserved chord, by name", () => {
    const keymap = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings({
        name: "keys",
        bindings: [
          {
            id: "down",
            value: {
              context: "outline.selection",
              chord: { key: "ArrowDown", mod: false, shift: false, alt: true },
              run: { intent: "move-down" },
            },
          },
          {
            id: "quit",
            value: {
              context: "outline.selection",
              chord: { key: "Escape" },
              run: { intent: "clear" },
            },
          },
          {
            id: "nothing",
            value: {
              context: "outline.selection",
              chord: { key: "j", mod: true },
              run: { intent: "fly" },
            },
          },
          {
            id: "next",
            value: {
              context: "outline.selection",
              chord: { key: "j", mod: true, shift: false, alt: false },
              run: { intent: "down" },
            },
          },
        ],
      }),
    );
    expect(keymap.refused).toEqual([
      {
        id: "keys.down",
        reason:
          'Alt-ArrowDown in outline.selection is held by outline.selection.down; a binding that takes it says replaces: "outline.selection.down"',
      },
      { id: "keys.quit", reason: "Escape is reserved in outline.selection" },
      { id: "keys.nothing", reason: 'outline.selection has no intent "fly"' },
    ]);
    expect(keymap.resolve({ key: "j", ctrlKey: true })?.id).toBe("keys.next");
  });
});

/** Another plugin's binding of `chord` in the selection, replacing `replaces`. */
const replace = (id: string, chord: string, replaces: string) => ({
  name: "more",
  bindings: [
    provideKeybinding(id, {
      context: "outline.selection",
      chord,
      run: { intent: "zoom" },
      replaces,
    }),
  ],
});

describe("a binding that replaces a held one", () => {
  const moveWithAlt = {
    name: "keys",
    bindings: [
      provideKeybinding("move-up", {
        context: "outline.selection",
        chord: "Alt-ArrowUp",
        run: { intent: "move-up" },
        replaces: "outline.selection.up",
      }),
    ],
  };

  it("takes exactly its own chord, and the holder keeps the rest", () => {
    const keymap = admitKeybindings(SELECTION_CONTEXT, outlineKeybindings(moveWithAlt));
    expect(keymap.refused).toEqual([]);
    expect(keymap.resolve({ key: "ArrowUp", altKey: true })?.id).toBe("keys.move-up");
    expect(keymap.resolve({ key: "ArrowUp" })?.id).toBe("outline.selection.up");
    expect(keymap.resolve({ key: "ArrowUp", altKey: true, shiftKey: true })?.id).toBe(
      "outline.selection.up",
    );
  });

  it("is refused when it names no holder of its chord, or a second takes the same chord", () => {
    const keymap = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings(moveWithAlt, {
        name: "more",
        bindings: [
          provideKeybinding("again", {
            context: "outline.selection",
            chord: "Alt-ArrowUp",
            run: { intent: "zoom" },
            replaces: "outline.selection.up",
          }),
          provideKeybinding("stray", {
            context: "outline.selection",
            chord: "Mod-j",
            run: { intent: "down" },
            replaces: "outline.selection.up",
          }),
        ],
      }),
    );
    expect(keymap.refused).toEqual([
      {
        id: "more.again",
        reason:
          'Alt-ArrowUp in outline.selection is held by keys.move-up; a binding that takes it says replaces: "keys.move-up"',
      },
      {
        id: "more.stray",
        reason:
          "it replaces outline.selection.up, which holds no chord overlapping Mod-j in outline.selection",
      },
    ]);
  });

  it("is itself replaced by a binding that names it, and each it stands on keeps the rest", () => {
    const keymap = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings(moveWithAlt, replace("again", "Alt-ArrowUp", "keys.move-up")),
    );
    expect(keymap.refused).toEqual([]);
    expect(keymap.resolve({ key: "ArrowUp", altKey: true })?.id).toBe("more.again");
    expect(keymap.resolve({ key: "ArrowUp" })?.id).toBe("outline.selection.up");
  });

  it("names the binding that holds the part of the chord it takes", () => {
    const wrong = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings(moveWithAlt, replace("wide", "Alt-Shift-ArrowUp", "keys.move-up")),
    );
    expect(wrong.refused).toEqual([
      {
        id: "more.wide",
        reason:
          "it replaces keys.move-up, which holds no chord overlapping Shift-Alt-ArrowUp in outline.selection",
      },
    ]);
    const right = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings(moveWithAlt, replace("wide", "Alt-Shift-ArrowUp", "outline.selection.up")),
    );
    expect(right.refused).toEqual([]);
    expect(right.resolve({ key: "ArrowUp", altKey: true, shiftKey: true })?.id).toBe("more.wide");
    expect(right.resolve({ key: "ArrowUp", altKey: true })?.id).toBe("keys.move-up");
    expect(right.resolve({ key: "ArrowUp" })?.id).toBe("outline.selection.up");
  });

  it("is refused once the binding it replaces leaves, and the key goes back to the holder", () => {
    const keymap = admitKeybindings(
      SELECTION_CONTEXT,
      outlineKeybindings(replace("again", "Alt-ArrowUp", "keys.move-up")),
    );
    expect(keymap.refused).toEqual([
      {
        id: "more.again",
        reason:
          "it replaces keys.move-up, which holds no chord overlapping Alt-ArrowUp in outline.selection",
      },
    ]);
    expect(keymap.resolve({ key: "ArrowUp", altKey: true })?.id).toBe("outline.selection.up");
  });

  it("may not take a reserved chord, even by replacing its holder", () => {
    const keymap = admitKeybindings(
      EDITING_CONTEXT,
      outlineKeybindings({
        name: "keys",
        bindings: [
          provideKeybinding("stay", {
            context: "outline.editing",
            chord: "Escape",
            run: { intent: "split" },
            replaces: "outline.editing.select",
          }),
        ],
      }),
    );
    expect(keymap.refused).toEqual([
      { id: "keys.stay", reason: "Escape is reserved in outline.editing" },
    ]);
  });
});
