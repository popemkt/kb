/**
 * The Settings page (DESIGN-UI.md → Settings): it holds this device's
 * light, dark and width, and draws every setting `settingsOf` reads for each
 * extension's node, each once, under that extension's section and no other,
 * so a setting a family adds is on the page with nothing to update; core's
 * section groups its own, notes each motion setting's value in force and
 * source, says when a setting core's node leaves unset is in force anyway,
 * resets motion to the theme, and draws a setting no group names under
 * *other*. Its way in, the header's gear, looks the same whatever the theme.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  MOTION_FIELD_IDS,
  SYSTEM_IDS,
  extensionNodeId,
  foldSeed,
  motionChoice,
  motionOptionId,
  present,
  settingsOf,
  type KbNode,
} from "@kb/model";
import { SettingsTrigger } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { useGraphStore } from "@/stores/graph.store";
import { useMotionStore } from "@/stores/motion.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { PAGE_FAMILIES } from "@/test-support/design-systems";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { SettingsPage } from "./settings-page";

const AT = "2026-01-01T00:00:00.000Z";
const CORE = extensionNodeId("core");
/** A setting of core's that no group of the page names. */
const EXTRA = "sys.f.test.extra";
const BOLD = { t: "ref" as const, v: motionOptionId("intensity", "bold") };

/** The bundled seed, a setting of core's no group names, and core's intensity set to bold. */
const SEED: KbNode[] = [
  ...foldSeed(BUNDLED_DECLARATIONS, AT).nodes.map((node) =>
    node.id === CORE
      ? { ...node, props: { ...node.props, [MOTION_FIELD_IDS.intensity]: [BOLD] } }
      : node,
  ),
  {
    id: EXTRA,
    text: "extra",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.configuresField]: [{ t: "ref", v: CORE }],
    },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  },
];
const coreProps = () => useGraphStore.getState().index?.getNode(CORE)?.props ?? {};

describe("Settings", () => {
  let dom: InstalledDom;
  let root: Root;
  let container: HTMLElement;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    syncPagePlugins(PAGE_FAMILIES);
    act(() => {
      useGraphStore.getState().hydrateFromWire(SEED, 1, "fixtures");
      useMotionStore.setState({ choice: motionChoice(coreProps(), undefined) });
    });
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    act(() => root.render(createElement(SettingsPage)));
  });

  afterAll(() => {
    act(() => root.unmount());
    dom.restore();
  });

  it("holds this device's light, dark and width, apart from the kb's", () => {
    const device = present(
      container.querySelector('[data-settings-section="device"]'),
      "the device's section",
    );
    expect(device.querySelector('[data-testid="pref-theme"]')).not.toBeNull();
    expect(device.querySelector('[data-testid="pref-width"]')).not.toBeNull();
    expect(device.querySelector("[data-setting]")).toBeNull();
  });

  it("writes the device's rows to this device's preferences, and nothing to the graph", () => {
    const before = useGraphStore.getState().wireNodes;
    const width = present(
      container.querySelector<HTMLSelectElement>('[data-testid="pref-width"]'),
      "the width row",
    );
    act(() => {
      width.value = "full";
      width.dispatchEvent(new dom.window.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(usePrefsStore.getState().width).toBe("full");
    expect(useGraphStore.getState().wireNodes).toBe(before);
    act(() => usePrefsStore.getState().setWidth("centered"));
  });

  it("draws every setting of every extension's node once, in that extension's section", () => {
    const byId = new Map(SEED.map((node) => [node.id, node]));
    const extensions = byId.get(SYSTEM_IDS.extensionsRoot)?.children ?? [];
    const expected = extensions.flatMap((id) =>
      settingsOf(SEED, (other) => byId.get(other), id).map(({ field }) => `${id} ${field}`),
    );
    // The contract would hold vacuously over a seed with no settings.
    expect(expected.length).toBeGreaterThan(10);
    const drawn = [...container.querySelectorAll("[data-setting]")].map(
      (row) =>
        `${row.closest("[data-settings-section]")?.getAttribute("data-settings-section")} ${row.getAttribute("data-setting")}`,
    );
    expect(drawn.toSorted()).toEqual(expected.toSorted());
  });

  it("draws each setting with the page's field editor", () => {
    for (const row of container.querySelectorAll("[data-setting]")) {
      expect(
        row.querySelectorAll("[data-field-row]"),
        row.getAttribute("data-setting") ?? "",
      ).toHaveLength(1);
    }
  });

  it("notes each motion setting's value in force and where it comes from", () => {
    const note = (field: string) =>
      container.querySelector(`[data-setting="${field}"] [data-motion-source]`);
    expect(note(MOTION_FIELD_IDS.intensity)?.textContent).toBe("bold · set here");
    expect(note(MOTION_FIELD_IDS.style)?.getAttribute("data-motion-source")).toBe("default");
    expect(note(MOTION_FIELD_IDS.style)?.textContent).toMatch(/^unset here · \S+ by default$/);
  });

  it("says what is in force for a page-head setting core's node leaves unset", () => {
    const strength = present(
      container.querySelector(`[data-setting="${SYSTEM_IDS.backdropStrengthField}"]`),
      "the strength row",
    );
    expect(strength.textContent).toMatch(/unset here · \S+ in force/);
  });

  it("draws a setting of core's that no group names under other", () => {
    const other = present(
      container.querySelector('[role="group"][aria-label="other"]'),
      "the other group",
    );
    expect(other.querySelector(`[data-setting="${EXTRA}"]`)).not.toBeNull();
  });

  it("resets motion to the theme by clearing every motion setting of core's", async () => {
    const reset = present(
      [...container.querySelectorAll("button")].find((b) =>
        b.textContent.startsWith("Reset motion to"),
      ),
      "the reset",
    );
    await act(async () => {
      reset.click();
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(coreProps()[MOTION_FIELD_IDS.intensity] ?? []).toEqual([]);
  });

  it("wears the same gear whatever the theme", () => {
    const host = dom.window.document.createElement("div") as unknown as HTMLElement;
    const gear = createRoot(host);
    const glyph = () => {
      act(() => gear.render(createElement(SettingsTrigger)));
      return present(host.querySelector('button[aria-label="Settings"]'), "the trigger").innerHTML;
    };
    act(() => usePrefsStore.getState().setTheme("light"));
    const light = glyph();
    act(() => usePrefsStore.getState().setTheme("dark"));
    expect(glyph()).toBe(light);
    act(() => gear.unmount());
  });
});
