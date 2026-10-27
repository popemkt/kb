/**
 * The Settings page (DESIGN-UI.md → Settings): four parts, each a list of
 * sections that fold. Across its parts it draws every setting `settingsOf`
 * reads for each extension's node, each once, for that node and no other,
 * so a setting a family adds is on the page with nothing to update; it
 * holds this device's light, dark, width and sidebar apart from the kb's;
 * Appearance groups core's own, notes each motion setting's value in force
 * and source, says when a setting core's node leaves unset is in force
 * anyway, and resets motion to the theme; General draws a setting of core's
 * no group names. A section's heading is a button that folds it, remembered
 * on this device; the filter reads across every part. Each part is a path,
 * the paths the page had before lead to their part, and its way in, the
 * header's gear, looks the same whatever the theme.
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
import { SETTINGS_PARTS, type SettingsPart } from "@kb/views";
import { settingsPartOf, settingsPath } from "@/lib/settings-parts";
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

  /** Draw `part`, as its route hands it to the page. */
  const show = (part: SettingsPart) =>
    act(() => root.render(createElement(SettingsPage, { part })));
  const section = (id: string) =>
    present(container.querySelector(`[data-settings-section="${id}"]`), `section ${id}`);
  const fold = (id: string) =>
    present(
      container.querySelector<HTMLButtonElement>(`[data-settings-fold="${id}"]`),
      `the fold of ${id}`,
    );
  /** Type `text` into the filter, replacing what it holds. */
  const filter = async (text: string) => {
    const input = present(
      container.querySelector<HTMLInputElement>('[data-testid="settings-filter"]'),
      "the filter",
    );
    await act(async () => {
      input.focus();
      // Through the prototype's setter, as typing does, so React sees a
      // change; the page reads it on input and on keyup.
      Reflect.set(Object.getPrototypeOf(input) as object, "value", text, input);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event,
      );
    });
    return input;
  };

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
    show("general");
  });

  afterAll(() => {
    act(() => root.unmount());
    dom.restore();
  });

  it("names its four parts in its rail, the one shown current", () => {
    show("appearance");
    const links = [...container.querySelectorAll("[data-settings-part-link]")];
    expect(links.map((link) => link.getAttribute("data-settings-part-link"))).toEqual([
      ...SETTINGS_PARTS,
    ]);
    expect(
      container.querySelector('[aria-current="page"]')?.getAttribute("data-settings-part-link"),
    ).toBe("appearance");
  });

  it("holds this device's light, dark, width and sidebar, apart from the kb's", () => {
    show("general");
    const device = section("device");
    expect(device.querySelector('[data-testid="pref-width"]')).not.toBeNull();
    expect(device.querySelector('[data-testid="pref-sidebar"]')).not.toBeNull();
    expect(device.querySelector("[data-setting]")).toBeNull();
    show("appearance");
    const lightDark = section("light-dark");
    expect(lightDark.querySelector('[data-testid="pref-theme"]')).not.toBeNull();
    expect(lightDark.querySelector("[data-setting]")).toBeNull();
  });

  it("writes the device's rows to this device's preferences, and nothing to the graph", () => {
    show("general");
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

  it("draws every setting of every extension's node once across its parts, for that node", () => {
    const byId = new Map(SEED.map((node) => [node.id, node]));
    const extensions = byId.get(SYSTEM_IDS.extensionsRoot)?.children ?? [];
    const expected = extensions.flatMap((id) =>
      settingsOf(SEED, (other) => byId.get(other), id).map(({ field }) => `${id} ${field}`),
    );
    // The contract would hold vacuously over a seed with no settings.
    expect(expected.length).toBeGreaterThan(10);
    const drawn = SETTINGS_PARTS.flatMap((part) => {
      show(part);
      return [...container.querySelectorAll("[data-setting]")].map(
        (row) => `${row.getAttribute("data-setting-of")} ${row.getAttribute("data-setting")}`,
      );
    });
    expect(drawn.toSorted()).toEqual(expected.toSorted());
  });

  it("draws each setting with the page's field editor", () => {
    for (const part of SETTINGS_PARTS) {
      show(part);
      for (const row of container.querySelectorAll("[data-setting]")) {
        expect(
          row.querySelectorAll("[data-field-row]"),
          row.getAttribute("data-setting") ?? "",
        ).toHaveLength(1);
      }
    }
  });

  it("notes each motion setting's value in force and where it comes from", () => {
    show("appearance");
    const note = (field: string) =>
      container.querySelector(`[data-setting="${field}"] [data-motion-source]`);
    expect(note(MOTION_FIELD_IDS.intensity)?.textContent).toBe("bold · set here");
    expect(note(MOTION_FIELD_IDS.style)?.getAttribute("data-motion-source")).toBe("default");
    expect(note(MOTION_FIELD_IDS.style)?.textContent).toMatch(/^unset here · \S+ by default$/);
  });

  it("says what is in force for a page-head setting core's node leaves unset", () => {
    show("appearance");
    const strength = present(
      container.querySelector(`[data-setting="${SYSTEM_IDS.backdropStrengthField}"]`),
      "the strength row",
    );
    expect(strength.textContent).toMatch(/unset here · \S+ in force/);
  });

  it("draws a setting of core's that no group names in General", () => {
    show("general");
    expect(section("core-other").querySelector(`[data-setting="${EXTRA}"]`)).not.toBeNull();
  });

  it("draws each extension's settings in its own section of Extensions, and core's elsewhere", () => {
    show("extensions");
    const agent = section(extensionNodeId("agent"));
    expect(agent.querySelectorAll(`[data-setting-of="${extensionNodeId("agent")}"]`).length).toBe(
      agent.querySelectorAll("[data-setting]").length,
    );
    expect(section(CORE).querySelector("[data-setting]")).toBeNull();
  });

  it("resets motion to the theme by clearing every motion setting of core's", async () => {
    show("appearance");
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

  it("folds a section from its heading's button, and remembers it on this device", () => {
    show("appearance");
    const button = fold("page-head");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    act(() => button.click());
    expect(fold("page-head").getAttribute("aria-expanded")).toBe("false");
    expect(section("page-head").querySelector("[data-setting]")).toBeNull();
    expect(usePrefsStore.getState().settingsFolds["page-head"]).toBe(false);
    show("general");
    show("appearance");
    expect(fold("page-head").getAttribute("aria-expanded")).toBe("false");
    act(() => fold("page-head").click());
    expect(section("page-head").querySelector("[data-setting]")).not.toBeNull();
  });

  it("filters across every part: a section whose title matches whole, else only its matching rows", async () => {
    show("general");
    act(() => usePrefsStore.getState().setSettingsFold("page-head", false));
    await filter("strength");
    const head = section("page-head");
    expect(head.getAttribute("data-open")).toBe("true");
    expect(
      [...head.querySelectorAll("[data-setting]")].map((row) => row.getAttribute("data-setting")),
    ).toEqual([SYSTEM_IDS.backdropStrengthField]);
    expect(container.querySelector('[data-settings-section="device"]')).toBeNull();
    await filter("page head");
    expect(section("page-head").querySelectorAll("[data-setting]").length).toBe(3);
    await filter("no setting is called this");
    expect(container.textContent).toContain("No setting matches.");
    const input = await filter("width");
    act(() => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }) as unknown as Event,
      );
    });
    expect(input.value).toBe("");
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
    act(() => usePrefsStore.getState().setSettingsFold("page-head", true));
  });

  it("is a path per part, and the paths it had before lead to their part", () => {
    for (const part of SETTINGS_PARTS) expect(settingsPartOf(settingsPath(part))).toBe(part);
    expect(settingsPath("general")).toBe("/settings");
    expect(settingsPartOf("/settings/")).toBe("general");
    expect(settingsPartOf("/extensions")).toBe("extensions");
    expect(settingsPartOf("/preferences")).toBe("appearance");
    expect(settingsPartOf("/settings/nowhere")).toBeNull();
    dom.window.history.replaceState({}, "", "/extensions");
    show("extensions");
    expect(dom.window.location.pathname).toBe("/settings/extensions");
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
