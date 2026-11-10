/**
 * The page-head backdrop continuity contract (DESIGN-UI.md → Page-head
 * backdrops): a keystroke, an edit or moving to another page never resets
 * or restarts a backdrop. The page head is rendered in a pane, with each
 * contributed backdrop chosen:
 *
 * - the owner types 30 keys into a node and then makes an edit, and the
 *   pane's host keeps the one instance it mounted;
 * - the owner moves between pages that show the same backdrop, a page
 *   framed by its route and a page that frames itself among them (the
 *   outline's home and a node's page stand in two different scroll
 *   regions), and the host keeps the instance it mounted;
 * - a GPU backdrop (Lens, Black hole, Toon sea, Silk, Floating geometry,
 *   Gradient orbs, Wolf medallion, Light trails, Astral, Disc field) mounts
 *   its scene exactly once, with one renderer, and the scene's clock only
 *   moves forward.
 *
 * A page that shows another backdrop crossfades to it: the one shown fades
 * out and its scene is let go once it has, or at once under reduced motion,
 * or at once when its family is unloaded on the way.
 *
 * Three's renderer is the stand-in (`FAKE_WEBGPU`), so the scenes are real
 * and their frames are driven here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import { NO_SWITCHES, familyOn, type WireNode } from "@kb/contracts";
import {
  BACKDROP_STRENGTH_OPTION_IDS,
  SYSTEM_IDS,
  backdropOptionId,
  extensionNodeId,
  foldSeed,
  type PropValue,
} from "@kb/model";
import {
  BackdropPoint,
  EMPTY_EDITOR,
  HoldStill,
  PageBackdrop,
  PageBackdropHost,
  currentContributions,
  readTiming,
  syncUiPlugins,
  useNode,
  type PageEditor,
} from "@kb/ui-sdk";
import {
  FAKE_WEBGPU,
  fakeCanvasContexts,
  gpu,
  installDomGlobals,
  type InstalledDom,
} from "@kb/ui-test-kit";
import type * as ThreeWebGpu from "three/webgpu";
import { mutations } from "@/actions/mutations";
import { PageFrame } from "@/components/layout/pane-frame";
import { fixtureGraph } from "@/api/fixture-graph";
import { useGraphStore } from "@/stores/graph.store";
import { providePageEditor } from "@/stores/page-editor";
import { PaneWithHead } from "@/test-support/page-head";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { BROWSER_EXTENSIONS } from "@/ui-plugins";

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...FAKE_WEBGPU,
}));

const AT = "2026-01-01T00:00:00.000Z";
const CORE = extensionNodeId("core");
const TYPED = "n.typed";
const GPU_BACKDROPS = new Set([
  "backdrops.lens",
  "backdrops.black-hole",
  "backdrops.toon-sea",
  "backdrops.silk",
  "backdrops.floating-geometry",
  "backdrops.gradient-orbs",
  "backdrops.wolf-medallion",
  "backdrops.light-trails",
  "backdrops.astral",
  "backdrops.disc-field",
]);

/** The browser entries of the families on in a store with no switch written, as the page loads them. */
const PAGE_FAMILIES = await Promise.all(
  BUNDLED_FAMILIES.filter((declaration) => familyOn(declaration, NO_SWITCHES, () => {})).flatMap(
    (declaration) => BROWSER_EXTENSIONS[declaration.name]?.load() ?? [],
  ),
);
const SEED = foldSeed(BUNDLED_DECLARATIONS, AT).nodes;
/** Every declared backdrop, by its option under the backdrop field (`backdropOptionId`). */
const DECLARED = (SEED.find((node) => node.id === SYSTEM_IDS.backdropField)?.children ?? []).map(
  (option) => option.replace(/^sys\.backdrop\./, ""),
);

/** A ref to the option `id`, as a field's value. */
const chosen = (id: string): PropValue => ({ t: "ref", v: id });

/** Two pages that show what core chooses, and one that chooses its own. */
const PAGE_A = "n.page-a";
const PAGE_B = "n.page-b";
const PAGE_OWN = "n.page-own";

/** One of the owner's nodes, with `props`. */
const owned = (id: string, order: string, props: WireNode["props"] = {}): WireNode => ({
  id,
  text: id,
  children: [],
  props,
  order,
  createdAt: AT,
  updatedAt: AT,
});

/**
 * The seed with `backdrop` chosen on core's node, one node of the owner's
 * to type into, two pages that show core's choice and one that chooses
 * `own` for itself.
 */
function graphChoosing(backdrop: string, own = backdrop): WireNode[] {
  const typed = owned(TYPED, "a");
  return [
    ...SEED.map((node) =>
      node.id === CORE
        ? {
            ...node,
            props: {
              ...node.props,
              [SYSTEM_IDS.backdropField]: [chosen(backdropOptionId(backdrop))],
              [SYSTEM_IDS.backdropStrengthField]: [chosen(BACKDROP_STRENGTH_OPTION_IDS.vivid)],
            },
          }
        : node,
    ),
    typed,
    owned(PAGE_A, "b"),
    owned(PAGE_B, "c"),
    owned(PAGE_OWN, "d", { [SYSTEM_IDS.backdropField]: [chosen(backdropOptionId(own))] }),
  ];
}

/**
 * A pane at `at` (null, the outline's home), as the shell frames each: the
 * home in the scroll region its route frames it in, a node's page in the
 * one its view frames it in, under the route's own frame (`/node/<id>` is
 * framed `full`), so moving between them changes the region the backdrop
 * stands in. Each page is a fresh subtree, as a route's page is.
 */
function Pane({ at, bare = false }: { readonly at: string | null; readonly bare?: boolean }) {
  const node = useNode(at ?? undefined);
  const head = bare
    ? null
    : createElement(PageBackdrop, {
        color: "red",
        ...(node === undefined ? {} : { node }),
      });
  const page = createElement("section", { key: at ?? "home", "data-page": at ?? "home" }, head);
  return createElement(
    PageBackdropHost,
    null,
    at === null
      ? createElement(PageFrame, { frame: "scroll", children: page })
      : createElement(PageFrame, {
          frame: "full",
          children: createElement(PageFrame, { frame: "scroll", children: page }),
        }),
  );
}

/** An editor with `active` being edited, or none. */
function editing(active: string | null): PageEditor {
  const idle = EMPTY_EDITOR.getState();
  return { getState: () => ({ ...idle, activeNodeId: active }), subscribe: () => () => undefined };
}

/** Every backdrop the page's kernel holds now, by its declared id. */
const contributed = () => currentContributions(BackdropPoint).map(({ value }) => value.key.id);

/** The observers the page's hosts construct, which a test DOM lacks: everything is in view, nothing resizes. */
class InView {
  private readonly report: (entries: { isIntersecting: boolean }[]) => void;
  constructor(report: (entries: { isIntersecting: boolean }[]) => void) {
    this.report = report;
  }
  observe() {
    queueMicrotask(() => this.report([{ isIntersecting: true }]));
  }
  unobserve() {}
  disconnect() {}
}
class NeverResized {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Let the lazy chunks load and a GPU scene mount, frames running meanwhile. */
async function settle(container: HTMLElement): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await act(() => new Promise((done) => setTimeout(done, 5)));
    frames(1);
    const state = container.querySelector<HTMLElement>(".kb-gpu-backdrop")?.dataset.sceneState;
    if (i >= 10 && state !== "loading") return;
  }
}

/** The frames asked for (`requestAnimationFrame`), run by `frames`, never inline. */
let queued: ((now: number) => void)[] = [];
/** Step `n` frames of 16 ms: the queued frames and the live renderer's animation loop. */
let clock = 0;
function frames(n: number): void {
  for (let i = 0; i < n; i++) {
    clock += 16;
    const due = queued;
    queued = [];
    for (const run of due) run(clock);
    gpu.last?.loop?.(clock);
  }
}

describe("a keystroke or an edit never restarts a page-head backdrop", () => {
  let installed: InstalledDom;
  const saved = new Map<string, unknown>();
  const g = globalThis as Record<string, unknown>;

  beforeAll(() => {
    installed = installDomGlobals();
    g.IS_REACT_ACT_ENVIRONMENT = true;
    const stand: Record<string, unknown> = {
      IntersectionObserver: InView,
      ResizeObserver: NeverResized,
      getComputedStyle: installed.window.getComputedStyle.bind(installed.window),
      requestAnimationFrame: (run: (now: number) => void) => queued.push(run),
      cancelAnimationFrame: () => undefined,
    };
    for (const [key, value] of Object.entries(stand)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    fakeCanvasContexts(installed.window.HTMLCanvasElement.prototype);
    syncPagePlugins(PAGE_FAMILIES);
  });
  afterAll(() => {
    syncUiPlugins([]);
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
    installed.restore();
  });

  it("covers every contributed backdrop, the GPU ones among them", () => {
    expect(DECLARED.toSorted()).toEqual(contributed().toSorted());
    expect(DECLARED).toEqual(expect.arrayContaining(["backdrops.lens", "backdrops.black-hole"]));
  });

  describe.each(DECLARED)("%s", (id) => {
    let container: HTMLElement;
    let root: Root;

    beforeAll(async () => {
      useGraphStore.getState().hydrateFromWire(graphChoosing(id), 1, "fixtures");
      gpu.last = null;
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root.render(createElement(PaneWithHead, { color: "red" })));
      await settle(container);
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
      act(() => providePageEditor(EMPTY_EDITOR));
    });

    it("keeps one instance and one clock through 30 keystrokes and an edit", async () => {
      const frame = container.querySelector(".kb-header-backdrop");
      expect(frame?.getAttribute("data-backdrop")).toBe(id);
      const gpuHost = () => container.querySelector(".kb-gpu-backdrop");
      // What the backdrop mounted: a GPU host's scene element, else the backdrop's own root.
      const mounted = () =>
        gpuHost() ?? container.querySelector(".kb-header-backdrop")?.firstElementChild;
      const shown = mounted() ?? null;
      expect(shown).not.toBeNull();
      const renderer = gpu.last;
      const live = gpu.live.size;
      const gpuScene = container.querySelector<HTMLElement>(".kb-gpu-backdrop");
      const clocks: number[] = [];
      const readClock = () => {
        const canvas = gpuScene?.querySelector("canvas");
        const at = Number(canvas?.dataset.clock ?? Number.NaN);
        if (!Number.isNaN(at)) clocks.push(at);
      };
      frames(3);
      readClock();

      act(() => providePageEditor(editing(TYPED)));
      let text = "";
      for (let key = 0; key < 30; key++) {
        text += "x";
        await act(() => mutations.updateNodeContent(TYPED, text));
        frames(2);
        readClock();
      }
      act(() => providePageEditor(editing(null)));
      await act(() =>
        mutations.updateProp(CORE, SYSTEM_IDS.backdropStrengthField, {
          t: "ref",
          v: BACKDROP_STRENGTH_OPTION_IDS.soft,
        }),
      );
      frames(3);
      readClock();
      await settle(container);

      // The slot never replaced what it mounted.
      expect(mounted()).toBe(shown);
      // The GPU backdrops' scenes are the ones with a clock to keep.
      if (GPU_BACKDROPS.has(id)) expect(gpuScene).not.toBeNull();
      if (gpuScene === null) return;
      // A GPU backdrop's scene was made once: the same renderer, no second one.
      expect(gpuScene.dataset.sceneState).toBe("ready");
      expect(gpu.last).toBe(renderer);
      expect(gpu.live.size).toBe(live);
      // And its clock only moved forward, across every keystroke and the edit.
      expect(clocks.length).toBeGreaterThan(30);
      for (let i = 1; i < clocks.length; i++) {
        expect(clocks[i]).toBeGreaterThanOrEqual(clocks[i - 1] ?? 0);
      }
      expect(clocks.at(-1)).toBeGreaterThan(clocks[0] ?? 0);
    });
  });

  describe.each(DECLARED)("%s across pages", (id) => {
    let container: HTMLElement;
    let root: Root;

    beforeAll(async () => {
      useGraphStore.getState().hydrateFromWire(graphChoosing(id), 1, "fixtures");
      gpu.last = null;
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root.render(createElement(Pane, { at: null })));
      await settle(container);
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
    });

    it("keeps one instance and one clock from page to page", async () => {
      const mounted = () =>
        container.querySelector(".kb-gpu-backdrop") ??
        container.querySelector(".kb-header-backdrop")?.firstElementChild;
      const shown = mounted() ?? null;
      expect(shown).not.toBeNull();
      const regionAtHome = container.querySelector("[data-main-region]");
      const renderer = gpu.last;
      const live = gpu.live.size;
      const gpuScene = container.querySelector<HTMLElement>(".kb-gpu-backdrop");
      const clocks: number[] = [];
      const readClock = () => {
        const at = Number(gpuScene?.querySelector("canvas")?.dataset.clock ?? Number.NaN);
        if (!Number.isNaN(at)) clocks.push(at);
      };
      frames(3);
      readClock();
      for (const at of [PAGE_A, PAGE_B, null, PAGE_A, PAGE_B, null, PAGE_B]) {
        act(() => root.render(createElement(Pane, { at })));
        frames(2);
        readClock();
        // The head is drawn in the region the page stands in, behind the page.
        const page = container.querySelector(`[data-page="${at ?? "home"}"]`);
        expect(
          page?.closest("[data-main-region]")?.querySelector("[data-page-backdrop]"),
        ).not.toBeNull();
        expect(container.querySelectorAll(".kb-header-backdrop")).toHaveLength(1);
      }
      await settle(container);

      // The pages stood in another region than the home's, and the host kept what it mounted.
      expect(container.querySelector("[data-main-region]")).not.toBe(regionAtHome);
      expect(mounted()).toBe(shown);
      if (gpuScene === null) return;
      expect(gpuScene.isConnected).toBe(true);
      expect(gpu.last).toBe(renderer);
      expect(gpu.live.size).toBe(live);
      expect(clocks.length).toBeGreaterThan(7);
      for (let i = 1; i < clocks.length; i++) {
        expect(clocks[i]).toBeGreaterThanOrEqual(clocks[i - 1] ?? 0);
      }
      expect(clocks.at(-1)).toBeGreaterThan(clocks[0] ?? 0);
    });
  });

  describe("a page that shows another backdrop", () => {
    const LENS = "backdrops.lens";
    const BLACK_HOLE = "backdrops.black-hole";
    let container: HTMLElement;
    let root: Root;

    const layers = (state: "shown" | "leaving") =>
      container.querySelectorAll<HTMLElement>(`[data-backdrop-layer="${state}"]`);
    const shownBackdrop = () =>
      layers("shown")[0]?.querySelector<HTMLElement>(".kb-header-backdrop")?.dataset.backdrop;
    /** The pane at `at`, held still or not. */
    const pane = (at: string | null, still: boolean) =>
      still
        ? createElement(HoldStill, null, createElement(Pane, { at }))
        : createElement(Pane, { at });

    const observers = g.MutationObserver;

    beforeAll(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      // The motion hooks hear the owner's setting change through the window's observer, as a page's do.
      g.MutationObserver = (window as unknown as Record<string, unknown>).MutationObserver;
    });
    afterAll(() => {
      container.remove();
      g.MutationObserver = observers;
    });

    /** The pane at a page showing core's Lens, its scene running; Lens's renderer. */
    async function atLens(still: boolean) {
      useGraphStore.getState().hydrateFromWire(graphChoosing(LENS, BLACK_HOLE), 1, "fixtures");
      gpu.last = null;
      root = createRoot(container);
      act(() => root.render(pane(PAGE_A, still)));
      await settle(container);
      expect(shownBackdrop()).toBe(LENS);
      const lens = gpu.last;
      expect(lens).not.toBeNull();
      return lens;
    }

    it("crossfades to it, and lets the one it leaves go once its fade's time is up", async () => {
      const lens = await atLens(false);
      act(() => root.render(pane(PAGE_OWN, false)));
      await settle(container);
      // Both are drawn while the one shown fades out over the one coming in.
      expect(shownBackdrop()).toBe(BLACK_HOLE);
      const leaving = layers("leaving");
      expect(leaving).toHaveLength(1);
      expect(gpu.live.has(lens as never)).toBe(true);
      const fades = leaving[0]?.getAnimations() ?? [];
      expect(fades.length).toBeGreaterThan(0);
      // Its time up, it is let go, its scene with it, though no frame drew its fade on (a test DOM
      // draws none, as a page whose GPU is busy may not): the fade shows it, the clock ends it.
      await act(() => new Promise((done) => setTimeout(done, (readTiming().theme + 0.1) * 1000)));
      await settle(container);
      expect(fades.every((fade) => fade.playState !== "finished")).toBe(true);
      expect(layers("leaving")).toHaveLength(0);
      expect(gpu.live.has(lens as never)).toBe(false);
      act(() => root.unmount());
    });

    it("swaps at once under reduced motion", async () => {
      const lens = await atLens(true);
      act(() => root.render(pane(PAGE_OWN, true)));
      expect(layers("leaving")).toHaveLength(0);
      await settle(container);
      expect(shownBackdrop()).toBe(BLACK_HOLE);
      expect(gpu.live.has(lens as never)).toBe(false);
      act(() => root.unmount());
    });

    /** Whether any layer the host draws still runs a fade. */
    const fading = () =>
      [...container.querySelectorAll<HTMLElement>("[data-backdrop-layer]")].some((layer) =>
        layer.getAnimations().some((fade) => fade.playState !== "finished"),
      );
    /** Motion reduced as the owner's setting paints it, read by every motion hook. */
    const reduceMotion = async (reduced: boolean) => {
      act(() => {
        if (reduced) document.documentElement.setAttribute("data-motion", "reduced");
        else document.documentElement.removeAttribute("data-motion");
      });
      await settle(container);
    };

    it("cuts a crossfade under way when motion is reduced, and swaps at once after", async () => {
      const lens = await atLens(false);
      act(() => root.render(pane(PAGE_OWN, false)));
      await settle(container);
      expect(layers("leaving")).toHaveLength(1);
      expect(fading()).toBe(true);
      try {
        await reduceMotion(true);
        // The one it was leaving is gone and the one it was showing stands still, both at once.
        expect(layers("leaving")).toHaveLength(0);
        expect(gpu.live.has(lens as never)).toBe(false);
        expect(shownBackdrop()).toBe(BLACK_HOLE);
        expect(fading()).toBe(false);
        // The next page swaps without a fade.
        act(() => root.render(pane(PAGE_A, false)));
        expect(layers("leaving")).toHaveLength(0);
        await settle(container);
        expect(shownBackdrop()).toBe(LENS);
        expect(fading()).toBe(false);
      } finally {
        await reduceMotion(false);
        act(() => root.unmount());
      }
    });

    it("cuts a held backdrop when motion is reduced on a page with no head", async () => {
      const lens = await atLens(false);
      act(() => root.render(createElement(Pane, { at: PAGE_B, bare: true })));
      await settle(container);
      // No head declared: what was shown is held, then fades; it left the page with the space it was drawn in.
      expect(layers("leaving")).toHaveLength(0);
      expect(gpu.live.has(lens as never)).toBe(true);
      try {
        await reduceMotion(true);
        expect(gpu.live.has(lens as never)).toBe(false);
        act(() => root.render(pane(PAGE_OWN, false)));
        await settle(container);
        expect(shownBackdrop()).toBe(BLACK_HOLE);
        expect(layers("leaving")).toHaveLength(0);
        expect(fading()).toBe(false);
      } finally {
        await reduceMotion(false);
        act(() => root.unmount());
      }
    });

    it("lets the one it leaves go at once when its family is unloaded", async () => {
      const lens = await atLens(false);
      act(() => root.render(pane(PAGE_OWN, false)));
      await settle(container);
      expect(layers("leaving")).toHaveLength(1);
      // The backdrops' family goes while Lens fades: nothing of it is drawn any more.
      act(() =>
        syncPagePlugins(PAGE_FAMILIES.filter((plugin) => !plugin.name.startsWith("backdrops"))),
      );
      await settle(container);
      expect(layers("leaving")).toHaveLength(0);
      expect(gpu.live.has(lens as never)).toBe(false);
      act(() => syncPagePlugins(PAGE_FAMILIES));
      act(() => root.unmount());
    });
  });
});
