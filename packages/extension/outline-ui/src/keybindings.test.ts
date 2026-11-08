import { describe, expect, it } from "vitest";
import { admitKeybindings } from "@kb/ui-sdk";
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
      for (const { value } of bindings) expect(context.intents).toContain(value.run.intent);
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
        reason: "Alt-ArrowDown in outline.selection is held by outline.selection.down",
      },
      { id: "keys.quit", reason: "Escape is reserved in outline.selection" },
      { id: "keys.nothing", reason: 'outline.selection has no intent "fly"' },
    ]);
    expect(keymap.resolve({ key: "j", ctrlKey: true })?.id).toBe("keys.next");
  });
});
