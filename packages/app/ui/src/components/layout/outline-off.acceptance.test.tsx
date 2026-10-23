/**
 * The outline switched off, through the real App: the server lists every
 * bundled family's views but the outline's, and reports the outline off, so
 * the page loads no outline. The store still names the outline as its
 * default view type (its seed is every store's), and the page is still whole:
 *
 * - the home (`/`) is core's, and reads the workspace's top-level nodes,
 *   saying the outline is not loaded, never "Page not found";
 * - a node naming no view is read at `/node/<id>`, its descendants links
 *   that open them in the pane;
 * - a row of the home zooms, to `/outline/<id>`, which the home still owns;
 * - the sidebar still has its way home.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extensionRow, type GraphSnapshot, type WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import { outlineExtension } from "@kb/outline";
import { NodeReadView, OutlineView, viewCatalogOf } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { setPostAction } = await import("@/api/action");
const { getPath, navigate, WORKSPACE_ROOT_ID } = await import("@kb/ui-sdk");
const { pageCatalog } = await import("@/lib/view-catalog");

const ISO = "2026-10-24T00:00:00.000Z";
const OFF = outlineExtension.name;

/** What the server lists in `kb.manifest`: every bundled family's views but the outline's. */
const SERVED = viewCatalogOf(
  BUNDLED_DECLARATIONS.filter(({ name }) => name !== OFF).flatMap(
    (declaration) => declaration.views ?? [],
  ),
).entries();
const LOADED = BUNDLED_FAMILIES.map((declaration) =>
  extensionRow(declaration, "bundled", declaration.name !== OFF),
);

function node(
  id: string,
  text: string,
  children: string[] = [],
  props: WireNode["props"] = {},
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [
      // The store names the outline its default view type, as the bundled seed does.
      node(SYSTEM_IDS.viewsRoot, "Views", [OutlineView.option], {
        [SYSTEM_IDS.viewDefaultField]: [{ t: "ref", v: OutlineView.option }],
      }),
      node(OutlineView.option, OutlineView.label),
      node("n.plans", "Plans", ["n.trip"]),
      node("n.trip", "Trip to **Hanoi**", ["n.flights"]),
      node("n.flights", "Book flights"),
    ],
  };
}

async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("the outline switched off (acceptance)", () => {
  let dom: InstalledDom;
  let container: HTMLElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.PointerEvent = dom.window.MouseEvent;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
    setPostAction(async (invocation) =>
      invocation.id === "kb.manifest"
        ? {
            status: "succeeded",
            id: invocation.id,
            output: { actions: [], views: SERVED, extensions: LOADED },
            rev: 1,
          }
        : { status: "failed", id: invocation.id, code: "unknown_action", message: "none", rev: 1 },
    );
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
    dom.restore();
  });

  beforeEach(async () => {
    dom.window.history.pushState({}, "", "/");
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    // The page follows the server's report: the outline leaves its kernel.
    await until(
      () =>
        pageCatalog().listedOf(OutlineView.option) === null &&
        pageCatalog().keyOf(NodeReadView.option) !== null,
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const read = (id: string) => container.querySelector(`[data-node-read="${id}"]`);

  it("holds no outline view, and holds core's read view", () => {
    expect(pageCatalog().keyOf(OutlineView.option)).toBeNull();
    expect(pageCatalog().keyOf(NodeReadView.option)).toBe(NodeReadView);
  });

  it("reads the workspace at home, saying the outline is not loaded", async () => {
    await until(() => read(WORKSPACE_ROOT_ID) !== null);
    const home = read(WORKSPACE_ROOT_ID);
    expect(home?.querySelector('[data-read-instead-of="Outline"]')?.textContent).toContain(
      "Outline is not loaded here",
    );
    expect(home?.querySelector('[data-read-row="n.plans"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Page not found");
    // The sidebar's way home is core's, so it outlives the outline.
    expect(container.textContent).toContain("Home");
  });

  it("reads a node naming no view, and opens a descendant in its pane", async () => {
    await act(async () => navigate("/node/n.trip"));
    await until(() => read("n.trip") !== null);
    const page = read("n.trip");
    // Its text is drawn as inline markdown, as the outline draws it.
    expect(page?.querySelector("h1 strong")?.textContent).toContain("Hanoi");
    expect(page?.querySelector('[data-read-instead-of="Outline"]')).not.toBeNull();
    expect(container.textContent).not.toContain("This view cannot be shown here");
    // The read view says it scrolls, as the outline it stands in for does.
    expect(page?.closest("main")?.getAttribute("data-main-region")).toBe("scroll");
    const row = page?.querySelector<HTMLButtonElement>('[data-read-row="n.flights"] button');
    await act(async () => row?.click());
    await until(() => read("n.flights") !== null);
    expect(getPath()).toBe("/node/n.flights");
  });

  it("zooms from the home to a row, which the home still reads", async () => {
    await until(() => read(WORKSPACE_ROOT_ID) !== null);
    const row = container.querySelector<HTMLButtonElement>('[data-read-row="n.plans"] button');
    await act(async () => row?.click());
    await until(() => read("n.plans") !== null);
    expect(getPath()).toBe("/outline/n.plans");
    expect(read("n.plans")?.querySelector('[data-read-row="n.trip"]')).not.toBeNull();
  });
});
