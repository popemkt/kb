/**
 * The lab through the real App, switched on the server: the page draws an
 * extension's UI exactly when the server's `kb.manifest` reports the
 * extension loaded. Off by default, the server does not load it, so `/lab`
 * is not found like any unmatched path and the sidebar has no Lab row.
 * Switched on from Settings' Extensions, its switch asks the server
 * (`extension.switch`), the server loads the lab and reports it, and the row
 * and `/lab` appear; switched off again, both leave live — no reload — and
 * `/lab` is not found. Nothing is kept in the browser's preferences. A switch written
 * elsewhere (another tab, the CLI) reaches the page's graph, and the page
 * follows it live. And until the server has answered, the page holds its
 * workspace rather than show the lab as missing on the way. Switched off
 * while its page is open, unloading tears that page down where it stands.
 *
 * The server is a stand-in that answers the manifest from one switch. The
 * study's scene is a stand-in too: happy-dom has no GPU, and what is under
 * test is the plugin's life cycle, not three.js.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_DECLARATIONS, BUNDLED_FAMILIES } from "@kb/bundled";
import { extensionRow, type ActionRequest, type GraphSnapshot, type WireNode } from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId } from "@kb/model";
import { viewCatalogOf } from "@kb/views";
import type { LabScene } from "@kb/lab-ui";

const scene = vi.hoisted(() => ({ mounted: 0, disposed: 0 }));

// The study's scene is a module of @kb/lab-ui that the lab page loads by
// itself, so the mock names that module: Embers mounts without a GPU.
vi.mock("../../../extension/lab-ui/src/embers/scene", () => ({
  mountEmbers: (): Promise<LabScene> => {
    scene.mounted += 1;
    return Promise.resolve({
      backend: "WebGL2",
      setPalette: () => {},
      setReducedMotion: () => {},
      setControl: () => {},
      resize: () => {},
      setRunning: () => {},
      dispose: () => {
        scene.disposed += 1;
      },
    });
  },
}));

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { setPostAction } = await import("@/api/action");
const { navigate } = await import("@kb/ui-sdk");
const { servedManifest } = await import("@/lib/manifest");
const { useGraphStore } = await import("@/stores/graph.store");

const ISO = "2026-09-24T00:00:00.000Z";

/** The lab's switch node as another tab or the CLI writes it, reaching the page's graph as any write does. */
const switchNode = (on: boolean, at: string): WireNode => ({
  id: extensionNodeId("lab"),
  text: "Lab",
  props: { [SYSTEM_IDS.extensionEnabledField]: [{ t: "bool", v: on }] },
  children: [],
  createdAt: ISO,
  updatedAt: at,
});

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [{ id: "n.a", text: "a note", props: {}, children: [], createdAt: ISO, updatedAt: ISO }],
  };
}

/**
 * The server: every bundled family loaded, the lab only while it is switched
 * on. While `hold` is pending, it has not answered the manifest yet.
 */
const server = {
  lab: false,
  switches: [] as unknown[],
  hold: null as Promise<void> | null,
};

function loaded(name: string): boolean {
  return name !== "lab" || server.lab;
}

function manifest() {
  return {
    actions: [],
    views: viewCatalogOf(
      BUNDLED_DECLARATIONS.filter(({ name }) => loaded(name)).flatMap(({ views }) => views ?? []),
    ).entries(),
    extensions: BUNDLED_FAMILIES.map((declaration) =>
      extensionRow(declaration, "bundled", loaded(declaration.name)),
    ),
  };
}

async function answer(invocation: ActionRequest) {
  if (invocation.id === "kb.manifest") {
    if (server.hold !== null) await server.hold;
    return { status: "succeeded" as const, id: invocation.id, output: manifest(), rev: 1 };
  }
  if (invocation.id === "extension.list") {
    const extensions = manifest().extensions.map((row) => ({
      ...row,
      tags: [],
      injects: [],
      provides: [],
      failures: [],
    }));
    return {
      status: "succeeded" as const,
      id: invocation.id,
      output: { extensions, points: [], failures: [] },
      rev: 1,
    };
  }
  if (invocation.id === "extension.footprint") {
    return { status: "succeeded" as const, id: invocation.id, output: { rows: [] }, rev: 1 };
  }
  if (invocation.id === "extension.switch") {
    server.switches.push(invocation.input);
    const { on } = invocation.input as { name: string; on: boolean };
    server.lab = on;
    return { status: "succeeded" as const, id: invocation.id, output: invocation.input, rev: 1 };
  }
  return {
    status: "failed" as const,
    id: invocation.id,
    code: "unknown_action" as const,
    message: "none",
    rev: 1,
  };
}

/** What the page last heard the server say of the lab. */
function reportedLab(): boolean | undefined {
  return servedManifest()?.extensions.find(({ name }) => name === "lab")?.enabled;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Settle until `ready` holds, or give up after a few seconds of real time. */
async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("lab plugin, switched on the server (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "http://localhost/" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.PointerEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.getComputedStyle.bind(dom);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
    setPostAction(answer);
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
  });

  /** Render the App over the server as it is, and wait until the page has heard it. */
  async function boot(): Promise<void> {
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await until(() => reportedLab() === server.lab);
    await settle();
  }

  beforeEach(() => {
    server.lab = false;
    server.switches = [];
    server.hold = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // The sidebar's row, not Settings' fold of the lab's section.
  const labRow = () =>
    [...container.querySelectorAll("button:not([data-settings-fold])")].find(
      (b) => b.textContent.trim() === "Lab",
    );
  const study = () => container.querySelector("[data-lab-study]");
  const notFound = () => container.querySelector('[data-not-found="Page"]');
  const labSwitch = () =>
    container.querySelector<HTMLSelectElement>('[data-testid="switch-lab"]') ?? null;

  /** Open Settings' Extensions, by the path it had before, and wait for the lab's switch. */
  async function openPanel(): Promise<void> {
    await act(async () => navigate("/extensions"));
    await until(() => labSwitch() !== null);
  }

  /** Choose `value` on the lab's switch in Settings' Extensions. */
  async function choose(value: "on" | "off"): Promise<void> {
    await openPanel();
    const select = labSwitch();
    expect(select).not.toBeNull();
    await act(async () => {
      if (select === null) return;
      select.value = value;
      select.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  // First, while the page has never heard a manifest: it would otherwise
  // read the bundled list as its own server, where the lab is off.
  it("holds the workspace until the server answers, so /lab is never shown missing on the way", async () => {
    server.lab = true;
    const manifestAnswered = Promise.withResolvers<void>();
    server.hold = manifestAnswered.promise;
    dom.history.pushState({}, "", "/lab");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await settle();
    // The frame before the manifest: the workspace is pending, not a missing page.
    expect(servedManifest()).toBeNull();
    expect(container.textContent).toContain("Opening your workspace");
    expect(notFound()).toBeNull();
    expect(study()).toBeNull();

    const mounted = scene.mounted;
    await act(async () => manifestAnswered.resolve());
    await until(() => scene.mounted > mounted);
    expect(notFound()).toBeNull();
    expect(study()?.getAttribute("data-lab-study")).toBe("embers");
  });

  it("is off while the server has it off: no row, /lab not found, and its switch shows off", async () => {
    await boot();
    expect(reportedLab()).toBe(false);
    expect(labRow()).toBeUndefined();
    await openPanel();
    expect(labSwitch()?.value).toBe("off");
    await act(async () => navigate("/lab"));
    await settle();
    expect(study()).toBeNull();
    expect(notFound()).not.toBeNull();
  });

  it("is drawn from the start when the server reports it loaded", async () => {
    server.lab = true;
    await boot();
    await until(() => labRow() !== undefined);
    expect(labRow()).toBeDefined();
  });

  it("draws its page, which frames itself, under the shell's header: one way to Settings, the shell's", async () => {
    server.lab = true;
    await boot();
    await until(() => labRow() !== undefined);
    await act(async () => navigate("/lab"));
    await until(() => study() !== null);
    const gears = container.querySelectorAll('button[aria-label="Settings"]');
    expect(gears).toHaveLength(1);
    expect(gears[0]?.closest("#kb-main > header")).not.toBeNull();
  });

  it("follows a switch written elsewhere, live, without a reload", async () => {
    await boot();
    expect(labRow()).toBeUndefined();
    // Another tab, or the CLI, switches the lab on: the server loads it, and
    // the switch node reaches this page's graph as any write does.
    server.lab = true;
    act(() => useGraphStore.getState().applyTx([switchNode(true, "2026-09-24T00:00:01.000Z")], []));
    await until(() => labRow() !== undefined);
    expect(reportedLab()).toBe(true);
    expect(labRow()).toBeDefined();
    expect(server.switches).toEqual([]);

    server.lab = false;
    act(() =>
      useGraphStore.getState().applyTx([switchNode(false, "2026-09-24T00:00:02.000Z")], []),
    );
    await until(() => labRow() === undefined);
    expect(reportedLab()).toBe(false);
    expect(labRow()).toBeUndefined();
  });

  it("switched on from Settings' Extensions, the server loads it and the page follows; switched off, both leave live", async () => {
    await boot();
    const { mounted, disposed } = scene;
    await choose("on");
    expect(server.switches).toEqual([{ name: "lab", on: true }]);
    // The page asked the server, heard it back, and loaded the lab's chunk.
    await until(() => labRow() !== undefined);
    expect(reportedLab()).toBe(true);
    expect(labRow()).toBeDefined();
    await until(() => labSwitch()?.value === "on");
    expect(labSwitch()?.value).toBe("on");

    await act(async () => navigate("/lab"));
    // The page is a lazy chunk: wait for it (and the scene it mounts) to arrive.
    await until(() => scene.mounted > mounted);
    expect(study()?.getAttribute("data-lab-study")).toBe("embers");
    expect(scene.mounted).toBe(mounted + 1);

    await choose("off");
    expect(server.switches).toEqual([
      { name: "lab", on: true },
      { name: "lab", on: false },
    ]);
    await until(() => labRow() === undefined);
    expect(reportedLab()).toBe(false);
    expect(labRow()).toBeUndefined();
    await act(async () => navigate("/lab"));
    await settle();
    expect(study()).toBeNull();
    expect(notFound()).not.toBeNull();
    // Leaving the study gave its scene back, and it was not mounted again.
    expect(scene.disposed).toBe(disposed + 1);
  });

  it("switched off elsewhere while the study is open, unloading tears the open page down", async () => {
    await boot();
    await choose("on");
    await until(() => labRow() !== undefined);
    const { mounted, disposed } = scene;
    await act(async () => navigate("/lab"));
    await until(() => scene.mounted > mounted);
    expect(study()).not.toBeNull();

    // Another tab, or the CLI, switches it off: the page stays on /lab.
    server.lab = false;
    act(() =>
      useGraphStore.getState().applyTx([switchNode(false, "2026-09-24T00:00:03.000Z")], []),
    );
    await until(() => labRow() === undefined);
    await settle();
    expect(dom.location.pathname).toBe("/lab");
    expect(study()).toBeNull();
    expect(notFound()).not.toBeNull();
    expect(scene.disposed).toBe(disposed + 1);
  });
});
