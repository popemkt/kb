/**
 * The theme contract (DESIGN-UI.md → Design tokens → Themes): a design
 * system may carry art and a page-head backdrop it pairs with. The one art
 * slot (`ThemeArt`) draws the art of the system painting the page and of
 * no other, in the plane it is asked for, hidden from assistive technology
 * and taking no input; a system with no art draws nothing there. The veil,
 * the plane over everything, is for passing gestures only, so at rest it
 * holds nothing. A system's pairing names a backdrop some family
 * contributes, and the page head shows it while neither the page's node nor
 * core's setting chooses one; either choice beats it.
 *
 * A system whose art draws at rest over the page, whose art shows under
 * another system, or whose pairing names no contributed backdrop, fails
 * here.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import type { WireNode } from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  SYSTEM_IDS,
  backdropOptionId,
  declaredIdOf,
  designSystemOptionId,
  extensionNodeId,
  firstRef,
  foldSeed,
  type KbNode,
} from "@kb/model";
import {
  BackdropPoint,
  DesignSystemPoint,
  PageBackdrop,
  THEME_GESTURE_MAX_MS,
  ThemeArt,
  currentContributions,
  syncUiPlugins,
  type DesignSystem,
  type ThemeArtPlane,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import { BackdropThemeTag } from "@/backdrop-theme-tag";
import { designSystemsUiPlugin } from "@/design-systems";
import { useGraphStore } from "@/stores/graph.store";
import { PAGE_FAMILIES } from "@/test-support/design-systems";
import { syncPagePlugins } from "@/test-support/page-plugins";

const AT = "2026-01-01T00:00:00.000Z";
const CORE = extensionNodeId("core");
const SEED = foldSeed(BUNDLED_DECLARATIONS, AT).nodes;

/** The seed, with core's node holding `props`, and any node `others` names holding its own. */
function graphWith(
  props: KbNode["props"],
  others: Readonly<Record<string, KbNode["props"]>> = {},
): WireNode[] {
  return SEED.map((node) => {
    const extra = node.id === CORE ? props : others[node.id];
    return extra === undefined ? node : { ...node, props: { ...node.props, ...extra } };
  });
}

/** The backdrop the seed has `system`'s option choose: the theme's pairing, as data. */
function pairing(system: string): string | undefined {
  const option = SEED.find((node) => node.id === designSystemOptionId(system));
  return declaredIdOf(BACKDROP_OPTIONS, firstRef(SYSTEM_IDS.backdropField)(option?.props ?? {}));
}

/** The design system the seed has the backdrop `id`'s option choose: the theme it belongs to. */
function themeOf(id: string): string | undefined {
  const option = SEED.find((node) => node.id === backdropOptionId(id));
  return declaredIdOf(
    DESIGN_SYSTEM_OPTIONS,
    firstRef(SYSTEM_IDS.designSystemField)(option?.props ?? {}),
  );
}

/** Core's settings painting the page in `system`, and choosing `backdrop` if given. */
function settings(system: string, backdrop?: string): KbNode["props"] {
  return {
    [SYSTEM_IDS.designSystemField]: [{ t: "ref", v: designSystemOptionId(system) }],
    ...(backdrop === undefined
      ? {}
      : { [SYSTEM_IDS.backdropField]: [{ t: "ref", v: backdropOptionId(backdrop) }] }),
  };
}

const paint = (system: string, backdrop?: string) =>
  useGraphStore.getState().hydrateFromWire(graphWith(settings(system, backdrop)), 1, "fixtures");

const systems = (): readonly DesignSystem[] =>
  currentContributions(DesignSystemPoint).map(({ value }) => value);
const backdropIds = () => currentContributions(BackdropPoint).map(({ value }) => value.key.id);

/** What the art slot draws for `plane`, rendered at rest. */
function art(plane: ThemeArtPlane): HTMLElement | null {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(ThemeArt, { plane }));
  return host.firstElementChild as HTMLElement | null;
}

/**
 * What the art slot draws for `plane` once mounted and settled: art may load
 * its code on first draw, so the page is given turns until nothing changes.
 */
async function settled(plane: ThemeArtPlane): Promise<HTMLElement | null> {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(ThemeArt, { plane })));
  let before = "";
  for (let turn = 0; turn < 50 && host.innerHTML !== before; turn += 1) {
    before = host.innerHTML;
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  const drawn = host.firstElementChild?.cloneNode(true) ?? null;
  act(() => root.unmount());
  return drawn as HTMLElement | null;
}

/** The backdrop the page head shows. */
function head(): string | undefined {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(PageBackdrop, { color: "red" }));
  return host.querySelector<HTMLElement>(".kb-header-backdrop")?.dataset.backdrop;
}

describe("every contributed design system's art and pairing", () => {
  let installed: InstalledDom;

  beforeAll(() => {
    installed = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    syncPagePlugins([designSystemsUiPlugin, ...PAGE_FAMILIES]);
  });
  afterAll(() => {
    syncUiPlugins([]);
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    installed.restore();
  });

  it("counts systems with art and with a pairing, and one with neither", () => {
    expect(systems().some((system) => system.Art !== undefined)).toBe(true);
    expect(systems().some((system) => pairing(system.key.id) !== undefined)).toBe(true);
    expect(systems().some((system) => system.Art === undefined)).toBe(true);
  });

  it("draws the shown system's art, and only its, in each plane, hidden and inert", () => {
    for (const system of systems()) {
      paint(system.key.id);
      for (const plane of ["ground", "veil"] as const) {
        const drawn = art(plane);
        if (system.Art === undefined) {
          expect(drawn, `${system.key.id} ${plane}`).toBeNull();
          continue;
        }
        expect(drawn?.dataset.themeArt, `${system.key.id} ${plane}`).toBe(system.key.id);
        expect(drawn?.dataset.plane).toBe(plane);
        expect(drawn?.getAttribute("aria-hidden")).toBe("true");
        expect(drawn?.className).toContain("pointer-events-none");
      }
    }
  });

  it("draws a ground once loaded, and holds nothing over the page at rest", async () => {
    for (const system of systems().filter(({ Art }) => Art !== undefined)) {
      paint(system.key.id);
      const ground = await settled("ground");
      expect(ground?.querySelectorAll("*").length, system.key.id).toBeGreaterThan(2);
      expect((await settled("veil"))?.childElementCount, system.key.id).toBe(0);
    }
  });

  it("draws what one page change draws however fast pages change, and nothing once the gesture's time is up", async () => {
    for (const system of systems()) {
      const { Art } = system;
      if (Art === undefined) continue;
      const veil = (path: string) =>
        createElement(Art, { plane: "veil", activity: { editing: false, writes: 0 }, path });
      // Load the art's code first, so the fake clock below drives it alone.
      const warm = createRoot(document.createElement("div"));
      await act(async () => warm.render(veil("/warm")));
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      act(() => warm.unmount());

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
      try {
        const host = document.createElement("div");
        const root = createRoot(host);
        const go = (path: string, ms: number) => {
          act(() => root.render(veil(path)));
          act(() => {
            vi.advanceTimersByTime(ms);
          });
        };
        go("/a", 2000);
        const rest = host.innerHTML;
        go("/b", 0);
        const one = host.querySelectorAll("*").length;
        expect(one, `${system.key.id}: a page change draws a gesture`).toBeGreaterThan(0);
        go("/b", THEME_GESTURE_MAX_MS);
        expect(host.innerHTML, `${system.key.id}: gone in time`).toBe(rest);
        for (let page = 0; page < 12; page += 1) {
          go(`/rapid/${page}`, 40);
          expect(host.querySelectorAll("*").length, `${system.key.id}: one at a time`).toBe(one);
        }
        go("/rapid/last", THEME_GESTURE_MAX_MS);
        expect(host.innerHTML, `${system.key.id}: nothing left after a burst`).toBe(rest);
        act(() => root.unmount());
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("pairs with a contributed backdrop of its own, which the head shows while nothing else chooses", () => {
    for (const system of systems().filter(({ key }) => pairing(key.id) !== undefined)) {
      const paired = pairing(system.key.id);
      expect(backdropIds(), system.key.id).toContain(paired);
      expect(themeOf(paired ?? ""), system.key.id).toBe(system.key.id);
      paint(system.key.id);
      expect(head(), system.key.id).toBe(paired);
    }
  });

  it("a backdrop that belongs to a theme names a contributed system, and a theme may bring several", () => {
    const themed = backdropIds().filter((id) => themeOf(id) !== undefined);
    const shown = new Set(systems().map(({ key }) => key.id));
    for (const id of themed) expect(shown.has(themeOf(id) ?? ""), id).toBe(true);
    const counts = new Map<string, number>();
    for (const id of themed)
      counts.set(themeOf(id) ?? "", (counts.get(themeOf(id) ?? "") ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThan(1);
  });

  it("tags a theme's backdrops with the theme in Preferences, and marks the shown theme's pairing", () => {
    for (const system of systems().filter(({ key }) => pairing(key.id) !== undefined)) {
      paint(system.key.id);
      for (const id of backdropIds()) {
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(createElement(BackdropThemeTag, { id }));
        const tag = host.querySelector<HTMLElement>("[data-backdrop-theme]");
        expect(tag?.dataset.backdropTheme, id).toBe(themeOf(id));
        expect(host.textContent.includes("default"), `${system.key.id} ${id}`).toBe(
          id === pairing(system.key.id),
        );
      }
    }
  });

  it("the pairing is data: writing the system's option changes what its head shows", () => {
    const system = systems().find(({ key }) => pairing(key.id) !== undefined);
    if (system === undefined) throw new Error("no system pairs");
    const other = backdropIds().find((id) => id !== pairing(system.key.id));
    if (other === undefined) throw new Error("no second backdrop");
    useGraphStore.getState().hydrateFromWire(
      graphWith(settings(system.key.id), {
        [designSystemOptionId(system.key.id)]: {
          [SYSTEM_IDS.backdropField]: [{ t: "ref", v: backdropOptionId(other) }],
        },
      }),
      1,
      "fixtures",
    );
    expect(head()).toBe(other);
  });

  it("core's chosen backdrop beats the pairing", () => {
    for (const system of systems().filter(({ key }) => pairing(key.id) !== undefined)) {
      const other = backdropIds().find((id) => id !== pairing(system.key.id));
      if (other === undefined) throw new Error("no second backdrop to choose");
      paint(system.key.id, other);
      expect(head(), system.key.id).toBe(other);
    }
  });

  it("a system with no pairing leaves the head to the first contributed", () => {
    const plain = systems().find(({ key }) => pairing(key.id) === undefined);
    if (plain === undefined) throw new Error("every system pairs");
    paint(plain.key.id);
    expect(head()).toBe(backdropIds()[0]);
  });
});
