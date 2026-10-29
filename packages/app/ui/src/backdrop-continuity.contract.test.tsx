/**
 * The page-head backdrop continuity contract (DESIGN-UI.md → Page-head
 * backdrops): a keystroke or an edit never resets or restarts a backdrop.
 * The page head is rendered with each contributed backdrop chosen and the
 * owner types 30 keys into a node and then makes an edit:
 *
 * - the slot keeps the one instance it mounted, for every backdrop: its
 *   element is never replaced;
 * - a GPU backdrop (Lens, Black hole, Toon sea, Silk, Floating geometry) mounts its scene exactly once, and the
 *   scene's clock only moves forward.
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
  PageBackdrop,
  currentContributions,
  syncUiPlugins,
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
import { fixtureGraph } from "@/api/fixture-graph";
import { useGraphStore } from "@/stores/graph.store";
import { providePageEditor } from "@/stores/page-editor";
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

/** The seed with `backdrop` chosen on core's node, and one node of the owner's to type into. */
function graphChoosing(backdrop: string): WireNode[] {
  const typed: WireNode = {
    id: TYPED,
    text: "",
    children: [],
    props: {},
    order: "a",
    createdAt: AT,
    updatedAt: AT,
  };
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
  ];
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
      act(() => root.render(createElement(PageBackdrop, { color: "red" })));
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
});
