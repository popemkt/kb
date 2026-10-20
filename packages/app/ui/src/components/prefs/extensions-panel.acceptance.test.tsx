/**
 * The Extensions panel, driven through the real App: the sidebar opens it
 * (⌘K's command is `run-command`'s), it draws what `extension.list` and `extension.footprint`
 * answer with the page's own kernel joined in, a family's switch asks the
 * server through `extension.switch`, and a family's settings are the fields
 * of its node, drawn with the page's field editor.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionRequest, ExtensionReport, FootprintRow, GraphSnapshot } from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { present } from "@kb/model";
import { setFetchGraphSnapshot } from "@/api/graph";
import { setPostAction } from "@/api/action";
import { App } from "@/components/App";

const ISO = "2026-10-20T00:00:00.000Z";
const DIGEST = `sha256:${"ab".repeat(32)}`;

const REPORT: ExtensionReport = {
  extensions: [
    {
      name: "outline",
      label: "Outline",
      optional: false,
      enabled: true,
      source: "bundled",
      tags: ["core"],
      injects: [],
      provides: [],
      failures: [],
    },
    {
      name: "graph",
      label: "Graph",
      optional: true,
      enabled: true,
      source: "bundled",
      tags: ["graph"],
      injects: [{ service: "kb.index", from: null }],
      provides: [],
      failures: [],
    },
    {
      name: "hello",
      label: "Hello",
      optional: false,
      enabled: true,
      source: "/repo/.kb/extensions/hello.ts",
      digest: DIGEST,
      tags: [],
      injects: [],
      provides: [],
      failures: ["hello/child failed to load: boom"],
    },
  ],
  points: [
    {
      point: "identity.providers",
      source: "host",
      listeners: [
        { owner: "identity-page-token", id: "page-token" },
        { owner: "identity-header", id: "header" },
      ],
    },
    {
      point: "action/guard",
      source: "registry",
      listeners: [
        { owner: "governance", id: "ext.governance.approval", match: "*" },
        { owner: "governance", id: "ext.governance.force", match: "every write" },
      ],
    },
  ],
  failures: [{ file: "stranger.ts", error: `not trusted on this machine (${DIGEST})` }],
};

const FOOTPRINT: FootprintRow[] = [
  { family: "graph", kind: "kb.actions", id: "ext.graph.trace", enabled: true, source: "registry" },
  { family: "graph", kind: "kb.actions", id: "ext.graph.edges", enabled: true, source: "registry" },
  { family: "graph", kind: "sys.field", id: "sys.f.graph.x", enabled: true, source: "seed" },
];

function snapshot(): GraphSnapshot {
  return { rev: 3, nodes: bundledSeed(ISO) };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the Extensions panel (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;
  let asked: ActionRequest[] = [];
  /** Which request the stand-in server fails, if any. */
  let failing: "unreachable" | "footprint" | null = null;

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
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
    setPostAction((invocation) => {
      asked.push(invocation);
      if (failing === "unreachable" && invocation.id === "extension.list") {
        return Promise.reject(new Error("connection refused"));
      }
      if (failing === "footprint" && invocation.id === "extension.footprint") {
        return Promise.resolve({
          status: "failed",
          id: invocation.id,
          code: "forbidden",
          message: "extension.footprint is not granted",
          rev: 3,
        });
      }
      const output =
        invocation.id === "extension.list"
          ? REPORT
          : invocation.id === "extension.footprint"
            ? { rows: FOOTPRINT }
            : {};
      return Promise.resolve({ status: "succeeded", id: invocation.id, output, rev: 3 });
    });
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
  });

  beforeEach(async () => {
    asked = [];
    failing = null;
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await settle();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const page = () => container.querySelector('[data-testid="extensions-page"]');
  const card = (name: string) =>
    present(container.querySelector(`[data-testid="extension-${name}"]`), `${name} card`);

  async function openFromSidebar(): Promise<void> {
    const row = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Extensions",
    );
    await act(async () => {
      present(row, "the sidebar's Extensions row").click();
    });
    await settle();
  }

  it("opens from the sidebar and draws each extension as the server reports it", async () => {
    expect(page()).toBeNull();
    await openFromSidebar();
    expect(page()).not.toBeNull();

    // A required family says so; an optional one has its switch, as reported.
    expect(card("outline").textContent).toContain("required");
    const graphSwitch = present(
      card("graph").querySelector<HTMLSelectElement>('[data-testid="switch-graph"]'),
      "graph's switch",
    );
    expect(graphSwitch.value).toBe("on");

    // Trust: kb's build, or the digest a person trusted it at.
    expect(card("graph").textContent).toContain("part of kb's build");
    expect(card("hello").textContent).toContain(`trusted at ${DIGEST}`);

    // Contributions per point, its seed counted apart; what it injects; its failures.
    expect(card("graph").textContent).toContain(
      "ext.graph.trace (registry), ext.graph.edges (registry)",
    );
    expect(card("graph").textContent).toContain("1 nodes");
    expect(card("graph").textContent).toContain("injects kb.index from nobody yet");
    expect(card("hello").querySelector('[role="alert"]')?.textContent).toBe(
      "hello/child failed to load: boom",
    );
  });

  it("lists the listeners asked in turn, in order, and the extensions refused", async () => {
    await openFromSidebar();
    const identity = present(
      container.querySelector('[data-testid="point-host-identity.providers"]'),
      "the host's identity providers",
    );
    expect([...identity.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "page-token (identity-page-token)",
      "header (identity-header)",
    ]);
    const guards = present(
      container.querySelector('[data-testid="point-registry-action/guard"]'),
      "the registry's guards",
    );
    expect([...guards.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "ext.governance.approval (governance) on *",
      "ext.governance.force (governance) on every write",
    ]);
    expect(container.querySelector('[data-testid="refused-stranger.ts"]')?.textContent).toContain(
      "not trusted",
    );
  });

  it("asks the server to switch a family, through extension.switch", async () => {
    await openFromSidebar();
    const graphSwitch = present(
      card("graph").querySelector<HTMLSelectElement>('[data-testid="switch-graph"]'),
      "graph's switch",
    );
    await act(async () => {
      graphSwitch.value = "off";
      graphSwitch.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    await settle();
    expect(asked.filter(({ id }) => id === "extension.switch").map(({ input }) => input)).toEqual([
      { name: "graph", on: false },
    ]);
  });

  it("draws a family's settings: the fields of its node", async () => {
    await openFromSidebar();
    const settings = present(
      card("graph").querySelector('[aria-label="graph settings"]'),
      "graph's settings",
    );
    expect(settings.textContent).toContain("suggest relations");
    // The switch is the card's own control, never a setting row.
    expect(settings.textContent).not.toContain("enabled");
  });

  it("says why when the server cannot give the report, and asks again on request", async () => {
    failing = "unreachable";
    await openFromSidebar();
    expect(page()?.querySelector('[role="alert"]')?.textContent).toContain("connection refused");
    expect(page()?.textContent).not.toContain("Reading the extensions");

    failing = null;
    const again = [...(page()?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.trim() === "Ask again",
    );
    await act(async () => {
      present(again, "the panel's Ask again").click();
    });
    await settle();
    expect(card("graph").textContent).toContain("part of kb's build");
  });

  it("does not draw a footprint it could not read as one with nothing in it", async () => {
    failing = "footprint";
    await openFromSidebar();
    expect(page()?.querySelector('[role="alert"]')?.textContent).toBe(
      "extension.footprint is not granted",
    );
    expect(container.querySelector('[data-testid="extension-graph"]')).toBeNull();
  });
});
