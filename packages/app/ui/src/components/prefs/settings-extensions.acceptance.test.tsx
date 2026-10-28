/**
 * Settings' Extensions and Advanced parts, driven through the real App: the
 * sidebar opens Settings and its rail the part (⌘K's command is
 * `run-command`'s), the part draws what `extension.list` and
 * `extension.footprint` answer with the page's own kernel joined in, each
 * family in its own section with its switch, which asks the server through
 * `extension.switch`, its settings, the fields of its node, and a fold of
 * what it composes; Advanced lists the listeners asked in turn and the
 * extensions refused; the page's former path leads to the part.
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
      listeners: [{ owner: "identity-header", id: "header" }],
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

/** Wait, inside act, until `found` holds: the page's body loads behind lazy(). */
async function until(found: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !found(); tries += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
}

describe("Settings' Extensions (acceptance)", () => {
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

  const page = () => container.querySelector('[data-settings-part="extensions"]');
  const card = (name: string) =>
    present(container.querySelector(`[data-testid="extension-${name}"]`), `${name} section`);

  const buttonNamed = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

  /** Open Settings from the sidebar, then `part` from its rail. */
  async function openFromSidebar(part: "Extensions" | "Advanced" = "Extensions"): Promise<void> {
    await act(async () => {
      present(buttonNamed("Settings"), "the sidebar's Settings row").click();
    });
    await until(() => container.querySelector("[data-settings-part-link]") !== null);
    await act(async () => {
      present(
        container.querySelector<HTMLButtonElement>(
          `[data-settings-part-link="${part.toLowerCase()}"]`,
        ),
        `the rail's ${part}`,
      ).click();
    });
    await settle();
  }

  /** Open a family's fold of what it composes, unless this device remembers it open. */
  async function openComposes(name: string): Promise<void> {
    const fold = present(
      card(name).querySelector<HTMLButtonElement>(
        `[data-settings-fold="sys.extension.${name}:composes"]`,
      ),
      `${name}'s What it composes`,
    );
    if (fold.getAttribute("aria-expanded") === "true") return;
    await act(async () => fold.click());
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

    // What it composes is folded until opened.
    expect(card("graph").textContent).not.toContain("part of kb's build");
    await openComposes("graph");
    await openComposes("hello");
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

  it("lists the listeners asked in turn, in order, and the extensions refused, in Advanced", async () => {
    await openFromSidebar("Advanced");
    const identity = present(
      container.querySelector('[data-testid="point-host-identity.providers"]'),
      "the host's identity providers",
    );
    expect([...identity.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
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

  it("draws a family's settings, the fields of its node, in its section, the switch apart", async () => {
    await openFromSidebar();
    const rows = [...card("graph").querySelectorAll("[data-setting]")];
    expect(rows.length).toBeGreaterThan(0);
    expect(card("graph").textContent).toContain("suggest relations");
    // The switch is the section's own control, never a setting.
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain("enabled");
  });

  it("leads its former path to the Extensions part", async () => {
    await act(async () => {
      dom.history.pushState({}, "", "/extensions");
      dom.dispatchEvent(new dom.PopStateEvent("popstate"));
    });
    await until(() => page() !== null);
    expect(page()).not.toBeNull();
    expect(dom.location.pathname).toBe("/settings/extensions");
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
    await openComposes("graph");
    expect(card("graph").textContent).toContain("part of kb's build");
  });

  it("does not draw a footprint it could not read as one with nothing in it", async () => {
    failing = "footprint";
    await openFromSidebar();
    expect(page()?.querySelector('[role="alert"]')?.textContent).toBe(
      "extension.footprint is not granted",
    );
    // Its settings stay, read from the graph; its switch and what it composes do not.
    expect(card("graph").querySelector('[data-testid="switch-graph"]')).toBeNull();
    expect(card("graph").querySelector('[data-settings-fold$=":composes"]')).toBeNull();
  });
});
