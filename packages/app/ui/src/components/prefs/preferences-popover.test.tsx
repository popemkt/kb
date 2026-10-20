/**
 * Preferences is how the page looks and nothing else: its rows are the
 * appearance settings, it lists no extension (that is the Extensions
 * panel's), and its trigger wears a neutral gear whatever the theme.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { PreferencesPopover, PreferencesTrigger } from "./preferences-popover";

describe("Preferences", () => {
  let dom: InstalledDom;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    useUiStore.getState().setPrefsOpen(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    useUiStore.getState().setPrefsOpen(false);
    dom.restore();
  });

  it("holds the appearance settings and no extension", () => {
    act(() => root.render(createElement(PreferencesPopover)));
    const dialog = present(container.querySelector('[role="dialog"]'), "the popover");
    expect(dialog.textContent).toContain("theme");
    expect(dialog.textContent).toContain("width");
    expect(container.querySelector('[aria-label="plugins"]')).toBeNull();
    expect(container.querySelector("select[data-testid^='plugin-']")).toBeNull();
  });

  it("wears the same gear whatever the theme", () => {
    const glyph = () => {
      act(() => root.render(createElement(PreferencesTrigger)));
      const button = present(
        container.querySelector('button[aria-label="Preferences"]'),
        "the trigger",
      );
      return button.innerHTML;
    };
    act(() => usePrefsStore.getState().setTheme("light"));
    const light = glyph();
    act(() => usePrefsStore.getState().setTheme("dark"));
    expect(glyph()).toBe(light);
  });
});
