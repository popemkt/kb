/**
 * The sidebar's Recent section (DESIGN-UI.md → Node-scoped commands,
 * "Recent is screen state"): after Pinned, the nodes an outline last stood
 * at, newest first, an id the graph no longer holds not drawn, and a row
 * zooming to its node. Viewing it writes nothing to the store.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { currentContributions, SidebarSectionPoint, syncUiPlugins } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const KEY = "kb-recent";

/** The sidebar's sections, lowest order first, as the sidebar draws them. */
const sections = () =>
  currentContributions(SidebarSectionPoint).toSorted((a, b) => a.value.order - b.value.order);

describe("the Recent section", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.localStorage = dom.localStorage;
  });

  beforeEach(() => {
    resetOutlineStore();
    dom.localStorage.clear();
    useGraphStore.getState().hydrateFromWire(rankedFixture(), 1, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function drawRecent(): Promise<void> {
    const Recent = present(
      sections().find((s) => s.id.endsWith("recent")),
      "recent section",
    ).value.Component;
    await act(async () => root.render(<Recent route={null} />));
  }

  const rows = () => [...container.querySelectorAll("button")].map((b) => b.textContent.trim());

  it("sits right after Pinned", () => {
    const ids = sections().map((s) => s.id);
    const pinned = ids.findIndex((id) => id.endsWith("pinned"));
    expect(ids[pinned + 1]).toMatch(/recent$/);
  });

  it("says where the nodes will show while there are none", async () => {
    await drawRecent();
    expect(container.textContent).toContain("Nodes you open show here");
  });

  it("draws the nodes newest first, as plain words, and not one the graph no longer holds", async () => {
    dom.localStorage.setItem(KEY, JSON.stringify(["n.root-b", "n.gone", "n.root-a"]));
    await drawRecent();
    expect(rows()).toEqual(["Search jumps to matching nodes", "Ship kb ui shell"]);
  });

  it("zooms to a node picked, and writes nothing to the store", async () => {
    dom.localStorage.setItem(KEY, JSON.stringify(["n.root-b"]));
    await drawRecent();
    const before = useGraphStore.getState().wireNodes;
    await act(async () => present(container.querySelector("button"), "row").click());
    expect(useGraphStore.getState().rootNodeId).toBe("n.root-b");
    expect(useGraphStore.getState().wireNodes).toBe(before);
  });
});
