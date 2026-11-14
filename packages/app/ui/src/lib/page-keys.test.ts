/**
 * The page's own keys (DESIGN-UI.md → Keybindings), with every family the
 * main bundle carries loaded as the app loads them: core owns `core.page`
 * and its ⌘K, days binds "Go to today" to Mod-Shift-D there, and no
 * bundled binding is refused in any context, the outline's and the
 * canvas's among them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAYS_IDS } from "@kb/days";
import { currentKeymap, setToastSink, syncUiPlugins, tellKeymaps } from "@kb/ui-sdk";
import { KeybindingPoint } from "@kb/contracts";
import { provideKeybinding } from "@kb/keybindings";
import { definePlugin, type Plugin } from "@kb/plugin";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { BROWSER_EXTENSIONS, CORE_UI_PLUGINS } from "@/ui-plugins";
import { PAGE_CONTEXT_ID } from "@kb/operations";
import { paletteOpening } from "./page-keys";

const told: string[] = [];
/** Every plugin the main bundle carries, as the app loads them. */
let bundled: readonly Plugin[] = [];

beforeAll(async () => {
  setToastSink((message) => told.push(message));
  const families = await Promise.all(
    Object.values(BROWSER_EXTENSIONS).flatMap((entry): Promise<Plugin>[] =>
      entry === null ? [] : [entry.load()],
    ),
  );
  bundled = [...CORE_UI_PLUGINS, ...families];
  syncPagePlugins(bundled);
  tellKeymaps();
});
afterAll(() => syncUiPlugins([]));

describe("the page's own keys", () => {
  it("refuses no bundled binding, in any context", () => {
    expect(told.filter((line) => line.startsWith("Keybinding"))).toEqual([]);
    expect(currentKeymap("canvas.rest").held.length).toBeGreaterThan(0);
    for (const id of [
      PAGE_CONTEXT_ID,
      "outline.editing",
      "outline.selection",
      "canvas.rest",
      "canvas.transform",
      "canvas.present",
    ]) {
      expect(currentKeymap(id).refused).toEqual([]);
    }
  });

  it("answers ⌘K with the palette's intent", () => {
    expect(currentKeymap(PAGE_CONTEXT_ID).resolve({ key: "k", metaKey: true })?.value.run).toEqual({
      intent: "palette",
    });
  });

  it("answers Mod-Shift-D with days' Go to today, as a command", () => {
    const today = currentKeymap(PAGE_CONTEXT_ID).resolve({
      key: "D",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(today?.id).toBe("days.today");
    expect(today?.value.run).toEqual({ command: DAYS_IDS.todayCommand });
  });

  it("holds no key without ⌘ or Ctrl, so typing never reaches it", () => {
    expect(currentKeymap(PAGE_CONTEXT_ID).resolve({ key: "d", shiftKey: true })).toBeUndefined();
  });

  it("tells a binding whose context no plugin contributes, so a mistyped id is no silent key", () => {
    const mistyped = definePlugin({
      name: "mistyped",
      apply: (ctx) =>
        ctx.contribute(
          KeybindingPoint,
          provideKeybinding("split", {
            context: "outline.editng",
            chord: "Alt-s",
            run: { intent: "split" },
          }),
        ),
    });
    syncPagePlugins([...bundled, mistyped]);
    try {
      tellKeymaps();
      expect(told).toContain(
        "Keybinding mistyped.split refused: there is no key context outline.editng",
      );
    } finally {
      syncPagePlugins(bundled);
    }
  });
});

describe("where ⌘K opens", () => {
  it("is the anchored row's node palette, else the global search", () => {
    expect(paletteOpening(true)).toBe("node-palette");
    expect(paletteOpening(false)).toBe("global-search");
  });
});
