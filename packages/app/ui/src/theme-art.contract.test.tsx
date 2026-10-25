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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import type { WireNode } from "@kb/contracts";
import {
  SYSTEM_IDS,
  backdropOptionId,
  designSystemOptionId,
  extensionNodeId,
  foldSeed,
  type KbNode,
} from "@kb/model";
import {
  BackdropPoint,
  DesignSystemPoint,
  PageBackdrop,
  ThemeArt,
  currentContributions,
  syncUiPlugins,
  type DesignSystem,
  type ThemeArtPlane,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import { designSystemsUiPlugin } from "@/design-systems";
import { useGraphStore } from "@/stores/graph.store";
import { PAGE_FAMILIES } from "@/test-support/design-systems";
import { syncPagePlugins } from "@/test-support/page-plugins";

const AT = "2026-01-01T00:00:00.000Z";
const CORE = extensionNodeId("core");
const SEED = foldSeed(BUNDLED_DECLARATIONS, AT).nodes;

/** The seed, with core's node holding `settings`. */
function graphWith(props: KbNode["props"]): WireNode[] {
  return SEED.map((node) =>
    node.id === CORE ? { ...node, props: { ...node.props, ...props } } : node,
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
    expect(systems().some((system) => system.backdrop !== undefined)).toBe(true);
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

  it("pairs with a contributed backdrop, which the head shows while nothing else chooses", () => {
    for (const system of systems().filter(({ backdrop }) => backdrop !== undefined)) {
      expect(backdropIds(), system.key.id).toContain(system.backdrop);
      paint(system.key.id);
      expect(head(), system.key.id).toBe(system.backdrop);
    }
  });

  it("core's chosen backdrop beats the pairing", () => {
    for (const system of systems().filter(({ backdrop }) => backdrop !== undefined)) {
      const other = backdropIds().find((id) => id !== system.backdrop);
      if (other === undefined) throw new Error("no second backdrop to choose");
      paint(system.key.id, other);
      expect(head(), system.key.id).toBe(other);
    }
  });

  it("a system with no pairing leaves the head to the first contributed", () => {
    const plain = systems().find(({ backdrop }) => backdrop === undefined);
    if (plain === undefined) throw new Error("every system pairs");
    paint(plain.key.id);
    expect(head()).toBe(backdropIds()[0]);
  });
});
