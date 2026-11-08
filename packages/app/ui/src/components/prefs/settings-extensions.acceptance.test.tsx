/**
 * Settings' Extensions and Advanced parts, driven through the real App: the
 * header's gear opens Settings and its rail the part (⌘K's command is
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
import type {
  ActionResponse,
  ActionRequest,
  ExtensionReport,
  FootprintRow,
  GraphSnapshot,
} from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { present } from "@kb/model";
import { setFetchGraphSnapshot } from "@/api/graph";
import { setPostAction } from "@/api/action";
import { loadManifest } from "@/lib/manifest";
import { App } from "@/components/App";

const ISO = "2026-10-20T00:00:00.000Z";
const FILES = `sha256:${"cd".repeat(32)}`;
const DIGEST = `sha256:${"ab".repeat(32)}`;

const REPORT: ExtensionReport = {
  extensions: [
    {
      name: "outline",
      label: "Outline",
      required: "Synthetic: the page cannot draw without it.",
      enabled: true,
      source: "bundled",
      origin: { kind: "bundled" },
      tags: ["core"],
      injects: [],
      provides: [],
      failures: [],
    },
    {
      name: "graph",
      label: "Graph",
      enabled: true,
      source: "bundled",
      origin: { kind: "bundled" },
      tags: ["graph"],
      injects: [{ service: "kb.index", from: null }],
      provides: [],
      failures: [],
    },
    {
      name: "hello",
      label: "Hello",
      enabled: true,
      source: "/repo/.kb/extensions/hello.ts",
      origin: { kind: "own" },
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
  let report = REPORT;
  let marketNames = ["hello"];
  let installFails = false;
  let updateChanged = false;
  let waitingList: Promise<ActionResponse> | null = null;
  /** Which request the stand-in server fails, if any. */
  let failing: "unreachable" | "footprint" | "marketplace" | null = null;

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
      if (invocation.id === "extension.list" && waitingList !== null) {
        const response = waitingList;
        waitingList = null;
        return response;
      }
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
      if (
        (invocation.id === "extension.marketplace.list" && failing === "marketplace") ||
        (invocation.id === "extension.install" && installFails)
      )
        return Promise.resolve({
          status: "failed",
          id: invocation.id,
          rev: 3,
          code: "invalid_input",
          message:
            invocation.id === "extension.install"
              ? "Synthetic install failure"
              : "Synthetic marketplace read failure",
        });
      if (invocation.id === "extension.marketplace.list")
        return Promise.resolve({
          status: "succeeded",
          id: invocation.id,
          rev: 3,
          output: {
            marketplaces: [
              {
                name: "sample",
                scope: "store",
                selection: {
                  original: "popemkt/kb-plugins-sample",
                  locked: {
                    repo: "popemkt/kb-plugins-sample",
                    path: "",
                    rev: "a".repeat(40),
                    files: FILES,
                  },
                },
                entries: marketNames.map((name) => ({
                  name,
                  source: { path: `extensions/${name}` },
                  description: "Synthetic entry",
                })),
              },
            ],
          },
        });
      if (invocation.id === "extension.update")
        return Promise.resolve({
          status: "succeeded",
          id: invocation.id,
          rev: 3,
          output: {
            updated: updateChanged
              ? [
                  {
                    name: "hello",
                    scope: "local",
                    from: "a".repeat(40),
                    to: "b".repeat(40),
                    files: ["hello.ts"],
                    trusted: false,
                  },
                ]
              : [],
            reload: "live",
          },
        });
      if (invocation.id === "extension.diff")
        return Promise.resolve({
          status: "succeeded",
          id: invocation.id,
          rev: 3,
          output: {
            name: "hello",
            from: null,
            to: FILES,
            files: [
              {
                path: "hello.ts",
                from: null,
                to: "export const synthetic = true;",
                fromMode: null,
                toMode: "100644",
              },
            ],
          },
        });
      if (invocation.id === "sandbox.trust")
        report = {
          ...report,
          extensions: report.extensions.map((row) =>
            row.name === "hello" ? { ...row, trusted: true } : row,
          ),
        };
      const output =
        invocation.id === "extension.list"
          ? report
          : invocation.id === "extension.footprint"
            ? { rows: FOOTPRINT }
            : invocation.id === "kb.manifest"
              ? { actions: [], views: [], extensions: report.extensions }
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
    report = REPORT;
    marketNames = ["hello"];
    installFails = false;
    updateChanged = false;
    waitingList = null;
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

  /** Open Settings from the header's gear, then `part` from its rail. */
  async function openFromHeader(part: "Extensions" | "Advanced" = "Extensions"): Promise<void> {
    await act(async () => {
      present(
        container.querySelector<HTMLButtonElement>('header button[aria-label="Settings"]'),
        "the header's gear",
      ).click();
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

  it.each(["Add from GitHub", "Add marketplace"])(
    "%s uses the shared action and store scope",
    async (title) => {
      await openFromHeader();
      const add = present(
        [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent === title,
        ),
        title,
      );
      await act(async () => add.click());
      const input = present(
        container.querySelector<HTMLInputElement>(`input[aria-label="${title} source"]`),
        "GitHub source input",
      );
      await act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value");
        descriptor?.set?.call(input, "github:popemkt/kb-plugins-sample/extensions/hello");
        input.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        input.form?.dispatchEvent(
          new dom.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
        );
      });
      await settle();
      expect(asked).toContainEqual(
        expect.objectContaining({
          id: title === "Add marketplace" ? "extension.marketplace.add" : "extension.install",
          input: { source: "github:popemkt/kb-plugins-sample/extensions/hello", scope: "store" },
        }),
      );
    },
  );

  it("explains retained extension nodes and offers a marketplace reinstall", async () => {
    report = { ...REPORT, extensions: REPORT.extensions.filter((row) => row.name !== "graph") };
    marketNames = ["graph"];
    await act(async () => loadManifest());
    await openFromHeader();
    expect(card("graph").textContent).toContain("Not installed. Its nodes remain.");
    const install = present(
      [...card("graph").querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Install graph from sample (store)",
      ),
      "reinstall",
    );
    await act(async () => install.click());
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.install",
        input: { source: "graph@sample", scope: "store" },
      }),
    );
  });

  it("keeps install and marketplace read failures visible independently", async () => {
    await openFromHeader();
    installFails = true;
    const install = present(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Install hello",
      ),
      "install",
    );
    await act(async () => install.click());
    await settle();
    failing = "marketplace";
    await act(async () => loadManifest());
    await settle();
    expect(container.textContent).toContain("Synthetic install failure");
    expect(container.textContent).toContain("Synthetic marketplace read failure");
  });

  it("installs a pinned marketplace entry through the page", async () => {
    await openFromHeader();
    const button = present(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Install hello",
      ),
      "marketplace install",
    );
    await act(async () => button.click());
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.install",
        input: { source: "hello@sample", scope: "store" },
      }),
    );
  });

  it("reviews the selected source and trusts its exact digest and file set", async () => {
    report = {
      ...REPORT,
      extensions: REPORT.extensions.map((row) =>
        row.name === "hello"
          ? {
              ...row,
              trusted: false,
              files: FILES,
              origin: {
                kind: "install" as const,
                scope: "local" as const,
                selection: {
                  original: "popemkt/kb-plugins-sample/extensions/hello",
                  locked: {
                    repo: "popemkt/kb-plugins-sample",
                    path: "extensions/hello",
                    rev: "a".repeat(40),
                    files: FILES,
                  },
                },
              },
              reach: {
                files: [{ path: "hello.ts", bytes: 30 }],
                page: false,
                host: { server: [], page: [] },
                builtins: [],
              },
            }
          : row,
      ),
    };
    await loadManifest();
    await openFromHeader();
    const jump = present(
      container.querySelector<HTMLAnchorElement>('a[href="#extension-review-hello"]'),
      "review jump",
    );
    const toggle = present(
      card("hello").querySelector<HTMLButtonElement>('[data-settings-fold="sys.extension.hello"]'),
      "section toggle",
    );
    await act(async () => toggle.click());
    expect(card("hello").id).toBe("extension-review-hello");
    await act(async () => jump.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const review = present(
      [...card("hello").querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Review & trust",
      ),
      "review button",
    );
    await act(async () => review.click());
    await until(() => container.textContent.includes("Trust this digest"));
    expect(container.textContent).toContain("export const synthetic = true");
    expect(container.textContent).toContain("File set digest");

    expect(container.textContent).toContain("Files and static reach");
    const trust = present(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Trust this digest",
      ),
      "trust button",
    );
    await act(async () => trust.click());
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "sandbox.trust",
        input: { digest: DIGEST, extension: { name: "hello", files: FILES } },
      }),
    );
    expect(card("hello").textContent).toContain("Trusted");
    expect(
      [...card("hello").querySelectorAll("button")].some((item) => item.textContent === "Review"),
    ).toBe(true);

    for (const title of ["Update", "Remove"]) {
      const control = present(
        [...card("hello").querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent === title,
        ),
        title,
      );
      await act(async () => control.click());
      await settle();
      if (title === "Update") {
        expect(card("hello").textContent).toContain("Already up to date.");
        updateChanged = true;
        await act(async () => control.click());
        await settle();
        expect(card("hello").textContent).toContain(
          `Updated ${"a".repeat(40)} → ${"b".repeat(40)}; review to trust`,
        );
      }
      expect(asked).toContainEqual(
        expect.objectContaining({
          id: `extension.${title.toLowerCase()}`,
          input: { name: "hello", scope: "local" },
        }),
      );
    }
  });

  it("opens from the header's gear and draws each extension as the server reports it", async () => {
    expect(page()).toBeNull();
    await openFromHeader();
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

  it("a refreshed catalog shows an untrusted update and the previous approved digest without reopening Settings", async () => {
    await openFromHeader();
    await openComposes("hello");
    const next = `sha256:${"cd".repeat(32)}`;
    report = {
      ...REPORT,
      extensions: REPORT.extensions.map((row) =>
        row.name === "hello"
          ? {
              ...row,
              digest: next,
              trusted: false,
              running: { digest: DIGEST, source: row.source },
            }
          : row,
      ),
    };
    await act(async () => {
      await loadManifest();
    });
    await until(() => card("hello").textContent.includes(`untrusted at ${next}`));
    expect(card("hello").textContent).toContain(`untrusted at ${next}`);
    expect(card("hello").textContent).toContain(`running approved ${DIGEST}`);
  });

  it("keeps one effective section and shows the other same-name source as hidden", async () => {
    const own = present(
      REPORT.extensions.find((row) => row.name === "hello"),
      "hello source",
    );
    const hiddenDigest = `sha256:${"ef".repeat(32)}`;
    report = {
      ...REPORT,
      extensions: [
        ...REPORT.extensions,
        {
          ...own,
          source: "/cache/other/hello.ts",
          digest: hiddenDigest,
          origin: { kind: "link", scope: "user" },
          shadowed: own.source,
        },
      ],
    };
    await openFromHeader();
    expect(container.querySelectorAll('[data-testid="extension-hello"]')).toHaveLength(1);
    await openComposes("hello");
    expect(card("hello").querySelector('[data-testid="trust-hello"]')?.textContent).toContain(
      DIGEST,
    );
    const fold = present(
      card("hello").querySelector<HTMLButtonElement>(
        '[data-settings-fold="sys.extension.hello:hidden"]',
      ),
      "hidden sources",
    );
    if (fold.getAttribute("aria-expanded") !== "true") await act(async () => fold.click());
    const hidden = present(
      card("hello").querySelector('[data-extension-hidden="hello"]'),
      "hidden source",
    );
    expect(hidden.textContent).toContain("user link");
    expect(hidden.textContent).toContain(hiddenDigest);
  });

  it("an older report cannot replace the sources from a later catalog refresh", async () => {
    await openFromHeader();
    await openComposes("hello");
    const older = Promise.withResolvers<ActionResponse>();
    waitingList = older.promise;
    await act(async () => loadManifest());
    const newerDigest = `sha256:${"cd".repeat(32)}`;
    report = {
      ...REPORT,
      extensions: REPORT.extensions.map((row) =>
        row.name === "hello" ? { ...row, digest: newerDigest, trusted: false } : row,
      ),
    };
    await act(async () => loadManifest());
    await until(() => card("hello").textContent.includes(newerDigest));
    older.resolve({ status: "succeeded", id: "extension.list", output: REPORT, rev: 3 });
    await settle();
    expect(card("hello").querySelector('[data-testid="trust-hello"]')?.textContent).toContain(
      newerDigest,
    );
  });

  it("lists the listeners asked in turn, in order, and the extensions refused, in Advanced", async () => {
    await openFromHeader("Advanced");
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
    await openFromHeader();
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
    await openFromHeader();
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
    await openFromHeader();
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
    await openFromHeader();
    expect(page()?.querySelector('[role="alert"]')?.textContent).toBe(
      "extension.footprint is not granted",
    );
    // Its settings stay, read from the graph; its switch and what it composes do not.
    expect(card("graph").querySelector('[data-testid="switch-graph"]')).toBeNull();
    expect(card("graph").querySelector('[data-settings-fold$=":composes"]')).toBeNull();
  });
});
