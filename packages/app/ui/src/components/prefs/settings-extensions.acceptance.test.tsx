/**
 * Settings' Extensions and Advanced parts, driven through the real App: the
 * header's gear opens Settings and its rail the part (⌘K's command is
 * `run-command`'s), the part draws what `extension.list` and
 * `extension.footprint` answer with the page's own kernel joined in, on two
 * shelves (Installed, then Built-in), each extension a card: its status,
 * its line, where it came from, its lock, switch or actions by its state,
 * its settings, the fields of its node, and its Details folded. Trust is
 * only the review sheet's click; Remove asks first. Advanced lists the
 * listeners asked in turn and the extensions refused; the page's former
 * path leads to the part.
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

/** The seed, and with `retired` the node a removed extension left under `sys.extensions`. */
function snapshot(retired: boolean): GraphSnapshot {
  const seed = bundledSeed(ISO);
  if (!retired) return { rev: 3, nodes: seed };
  const node = { id: "sys.extension.retired", text: "Retired", props: {}, children: [] };
  return {
    rev: 3,
    nodes: [
      ...seed.map((item) =>
        item.id === "sys.extensions" ? { ...item, children: [...item.children, node.id] } : item,
      ),
      { ...node, createdAt: ISO, updatedAt: ISO },
    ],
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The button in `scope` that reads `text`. */
function buttonIn(scope: ParentNode, text: string): HTMLButtonElement {
  return present(
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent.trim() === text,
    ),
    text,
  );
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
  let retired = false;

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
    setFetchGraphSnapshot(() => Promise.resolve(snapshot(retired)));
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
    retired = false;
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

  const shelf = (id: "installed" | "builtin") =>
    present(container.querySelector(`[data-settings-section="group:${id}"]`), `${id} shelf`);

  /** Mount the App again, so the graph is read again (the retired node). */
  async function remount(): Promise<void> {
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await settle();
  }

  /** Open an extension's Details fold, unless this device remembers it open. */
  async function openDetails(name: string): Promise<void> {
    const fold = present(
      card(name).querySelector<HTMLButtonElement>(
        `[data-settings-fold="sys.extension.${name}:details"]`,
      ),
      `${name}'s Details`,
    );
    if (fold.getAttribute("aria-expanded") === "true") return;
    await act(async () => fold.click());
  }

  /** Choose `item` from an extension's overflow menu. */
  async function fromMenu(label: string, item: string): Promise<void> {
    const more = present(
      container.querySelector<HTMLButtonElement>(`button[aria-label="More for ${label}"]`),
      `${label}'s menu`,
    );
    await act(async () => more.click());
    const menu = present(
      container.querySelector(`[role="menu"][aria-label="More for ${label}"]`),
      `${label}'s open menu`,
    );
    const chosen = present(
      [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (row) => row.textContent === item,
      ),
      item,
    );
    await act(async () => chosen.click());
    await settle();
  }

  /** Open Add extension, on `tab`. */
  async function openAdd(tab: "Browse marketplaces" | "From GitHub"): Promise<HTMLElement> {
    await act(async () => buttonIn(container, "Add extension").click());
    const panel = present(
      container.querySelector<HTMLElement>('[data-testid="extension-add"]'),
      "the Add panel",
    );
    await act(async () => buttonIn(panel, tab).click());
    return panel;
  }

  async function submit(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
      input.form?.dispatchEvent(
        new dom.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
      );
    });
    await settle();
  }

  /** hello installed from a marketplace, pinned, and not yet trusted. */
  function installedHello(): ExtensionReport {
    return {
      ...REPORT,
      extensions: REPORT.extensions.map((row) =>
        row.name === "hello"
          ? {
              ...row,
              trusted: false,
              failures: [],
              files: FILES,
              origin: {
                kind: "install" as const,
                scope: "local" as const,
                selection: {
                  original: "hello@sample",
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
  }

  it("opens from the header's gear and puts each extension on its shelf, as the server reports it", async () => {
    expect(page()).toBeNull();
    await openFromHeader();
    expect(page()).not.toBeNull();

    // Installed first: the store's own extension; then Built-in: kb's build.
    expect(shelf("installed").querySelector('[data-testid="extension-hello"]')).not.toBeNull();
    expect(shelf("builtin").querySelector('[data-testid="extension-graph"]')).not.toBeNull();
    expect(shelf("builtin").querySelector('[data-testid="extension-outline"]')).not.toBeNull();
    expect(
      shelf("installed").compareDocumentPosition(shelf("builtin")) &
        dom.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A required family shows a lock and says why; it has no switch.
    const lock = present(card("outline").querySelector("[data-extension-required]"), "lock");
    expect(lock.getAttribute("title")).toBe("Synthetic: the page cannot draw without it.");
    expect(card("outline").textContent).toContain(
      "Required: Synthetic: the page cannot draw without it.",
    );
    expect(card("outline").querySelector('[data-testid="switch-outline"]')).toBeNull();
    // A built-in family has its switch, as reported.
    const graphSwitch = present(
      card("graph").querySelector<HTMLSelectElement>('[data-testid="switch-graph"]'),
      "graph's switch",
    );
    expect(graphSwitch.value).toBe("on");

    // The installed one leads with its status, where it came from, and its failures.
    expect(card("hello").querySelector("[data-extension-status]")?.textContent).toBe("Error");
    expect(card("hello").querySelector("[data-extension-source]")?.textContent).toContain(
      "/repo/.kb/extensions/hello.ts",
    );
    expect(card("hello").querySelector('[role="alert"]')?.textContent).toBe(
      "hello/child failed to load: boom",
    );

    // Details fold until opened: what it adds in words, its services; digests short, whole in reach.
    expect(card("graph").querySelector('[data-testid="details-graph"]')).toBeNull();
    await openDetails("graph");
    await openDetails("hello");
    const details = present(card("graph").querySelector('[data-testid="details-graph"]'), "");
    expect(details.textContent).toContain("trace · edges");
    expect(details.textContent).not.toContain("ext.graph.trace");
    expect(details.textContent).toContain("injects kb.index from nobody yet");
    const digest = present(card("hello").querySelector(`code[title="${DIGEST}"]`), "digest");
    expect(digest.textContent).toBe(`${"ab".repeat(6)}…`);
    expect(card("hello").textContent).not.toContain(DIGEST);
  });

  it("reviews the selected source, and trusts its exact digest and file set only on the sheet's click", async () => {
    report = installedHello();
    await loadManifest();
    await openFromHeader();
    expect(container.querySelector('[data-testid="extensions-awaiting"]')?.textContent).toContain(
      "1 extension awaits your review: hello",
    );
    expect(card("hello").querySelector("[data-extension-status]")?.textContent).toBe(
      "Needs approval",
    );
    expect(card("hello").querySelector("[data-extension-source]")?.textContent).toContain(
      "sample marketplace",
    );
    const pin = present(card("hello").querySelector<HTMLAnchorElement>("a[title]"), "pin");
    expect(pin.textContent).toBe("a".repeat(7));
    expect(pin.href).toBe(
      `https://github.com/popemkt/kb-plugins-sample/tree/${"a".repeat(40)}/extensions/hello`,
    );

    // The banner's link opens the card it names.
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

    await act(async () => buttonIn(card("hello"), "Review & trust").click());
    await until(() => container.textContent.includes("Trust this digest"));
    expect(container.textContent).toContain("export const synthetic = true");
    expect(container.textContent).toContain("File set digest");
    expect(container.textContent).toContain("Files and static reach");
    // Opening the sheet trusts nothing.
    expect(asked.some(({ id }) => id === "sandbox.trust")).toBe(false);
    await act(async () => buttonIn(container, "Trust this digest").click());
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "sandbox.trust",
        input: { digest: DIGEST, extension: { name: "hello", files: FILES } },
      }),
    );
    expect(card("hello").querySelector("[data-extension-status]")?.textContent).toBe("Trusted");
    expect([...card("hello").querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      "Review & trust",
    );

    // The rest is in its menu: Update says what it fetched, never trusting it.
    await fromMenu("Hello", "Update");
    expect(card("hello").textContent).toContain("Already up to date.");
    updateChanged = true;
    await fromMenu("Hello", "Update");
    expect(card("hello").textContent).toContain(
      `Updated ${"a".repeat(7)} → ${"b".repeat(7)} (1 file changed); review it to run it.`,
    );
    expect(asked).toContainEqual(
      expect.objectContaining({ id: "extension.update", input: { name: "hello", scope: "local" } }),
    );
    expect(asked.filter(({ id }) => id === "sandbox.trust")).toHaveLength(1);
  });

  it("asks before Remove, says its nodes stay, and removes only on confirmation", async () => {
    report = installedHello();
    await loadManifest();
    await openFromHeader();
    await fromMenu("Hello", "Remove…");
    const dialog = present(container.querySelector('[data-testid="remove-hello"]'), "confirm");
    expect(dialog.textContent).toContain("Remove Hello?");
    expect(dialog.textContent).toContain("Its nodes stay");
    expect(dialog.textContent).toContain("this root's private lock");
    await act(async () => buttonIn(dialog, "Cancel").click());
    expect(container.querySelector('[data-testid="remove-hello"]')).toBeNull();
    expect(asked.some(({ id }) => id === "extension.remove")).toBe(false);

    await fromMenu("Hello", "Remove…");
    await act(async () =>
      buttonIn(
        present(container.querySelector('[data-testid="remove-hello"]'), ""),
        "Remove",
      ).click(),
    );
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({ id: "extension.remove", input: { name: "hello", scope: "local" } }),
    );
  });

  it("a refreshed catalog shows an untrusted update and what keeps running, without reopening Settings", async () => {
    await openFromHeader();
    await openDetails("hello");
    const next = `sha256:${"cd".repeat(32)}`;
    report = {
      ...REPORT,
      extensions: REPORT.extensions.map((row) =>
        row.name === "hello"
          ? {
              ...row,
              failures: [],
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
    await until(() => card("hello").querySelector(`code[title="${next}"]`) !== null);
    expect(card("hello").querySelector("[data-extension-status]")?.textContent).toBe(
      "Update available",
    );
    expect(buttonIn(card("hello"), "Review update")).toBeDefined();
    expect(
      card("hello").querySelector(`code[title="${DIGEST}"]`)?.closest("dd")?.textContent,
    ).toContain("until the update is trusted");
  });

  it("keeps one card and shows the other same-name source as hidden", async () => {
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
    await openDetails("hello");
    expect(
      card("hello").querySelector(`[data-testid="details-hello"] code[title="${DIGEST}"]`),
    ).not.toBeNull();
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
    expect(hidden.querySelector(`code[title="${hiddenDigest}"]`)).not.toBeNull();
  });

  it("an older report cannot replace the sources from a later catalog refresh", async () => {
    await openFromHeader();
    await openDetails("hello");
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
    await until(() => card("hello").querySelector(`code[title="${newerDigest}"]`) !== null);
    older.resolve({ status: "succeeded", id: "extension.list", output: REPORT, rev: 3 });
    await settle();
    expect(card("hello").querySelector(`code[title="${newerDigest}"]`)).not.toBeNull();
  });

  it("installs from GitHub into the scope chosen, through the shared action", async () => {
    await openFromHeader();
    const panel = await openAdd("From GitHub");
    const scope = present(
      panel.querySelector<HTMLSelectElement>('[data-testid="extension-scope"]'),
      "scope",
    );
    await act(async () => {
      scope.value = "local";
      scope.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    await submit(
      present(
        panel.querySelector<HTMLInputElement>('input[aria-label="Add from GitHub source"]'),
        "",
      ),
      "github:popemkt/kb-plugins-sample/extensions/hello",
    );
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.install",
        input: { source: "github:popemkt/kb-plugins-sample/extensions/hello", scope: "local" },
      }),
    );
  });

  it("browses a marketplace, installs an entry with its Install button, and adds a marketplace", async () => {
    marketNames = ["hello", "tide"];
    await openFromHeader();
    const panel = await openAdd("Browse marketplaces");
    // What is installed already says so; the rest has Install.
    expect(panel.querySelector('button[aria-label="Install hello from sample"]')).toBeNull();
    const install = present(
      panel.querySelector<HTMLButtonElement>('button[aria-label="Install tide from sample"]'),
      "install tide",
    );
    await act(async () => install.click());
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.install",
        input: { source: "tide@sample", scope: "store" },
      }),
    );

    await act(async () => buttonIn(panel, "Add a marketplace…").click());
    await submit(
      present(
        panel.querySelector<HTMLInputElement>('input[aria-label="Add marketplace source"]'),
        "",
      ),
      "github:popemkt/kb-plugins-sample",
    );
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.marketplace.add",
        input: { source: "github:popemkt/kb-plugins-sample", scope: "store" },
      }),
    );
  });

  it("keeps install and marketplace read failures visible independently", async () => {
    marketNames = ["tide"];
    await openFromHeader();
    installFails = true;
    const panel = await openAdd("Browse marketplaces");
    await act(async () =>
      present(
        panel.querySelector<HTMLButtonElement>('button[aria-label="Install tide from sample"]'),
        "install",
      ).click(),
    );
    await settle();
    failing = "marketplace";
    await act(async () => loadManifest());
    await settle();
    expect(container.textContent).toContain("Synthetic install failure");
    expect(container.textContent).toContain("Synthetic marketplace read failure");
  });

  it("explains a removed extension's node on the Installed shelf and offers its marketplace's install", async () => {
    retired = true;
    marketNames = ["retired"];
    await remount();
    await openFromHeader();
    expect(shelf("installed").querySelector('[data-testid="extension-retired"]')).not.toBeNull();
    expect(card("retired").textContent).toContain("Not installed. Its nodes remain");
    await act(async () =>
      present(
        card("retired").querySelector<HTMLButtonElement>(
          'button[aria-label="Install retired from sample"]',
        ),
        "reinstall",
      ).click(),
    );
    await settle();
    expect(asked).toContainEqual(
      expect.objectContaining({
        id: "extension.install",
        input: { source: "retired@sample", scope: "store" },
      }),
    );
  });

  it("says when nothing is installed yet", async () => {
    report = { ...REPORT, extensions: REPORT.extensions.filter((row) => row.name !== "hello") };
    await act(async () => loadManifest());
    await openFromHeader();
    expect(container.querySelector('[data-testid="extensions-empty"]')?.textContent).toContain(
      "Nothing installed yet",
    );
    expect(container.querySelector('[data-testid="extensions-awaiting"]')).toBeNull();
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

  it("asks the server to switch a family, through extension.switch: a built-in by its switch, an installed one from its menu", async () => {
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
    await fromMenu("Hello", "Turn off");
    expect(asked.filter(({ id }) => id === "extension.switch").map(({ input }) => input)).toEqual([
      { name: "graph", on: false },
      { name: "hello", on: false },
    ]);
  });

  it("draws a family's settings, the fields of its node, in its card, the switch apart", async () => {
    await openFromHeader();
    const rows = [...card("graph").querySelectorAll("[data-setting]")];
    expect(rows.length).toBeGreaterThan(0);
    expect(card("graph").textContent).toContain("suggest relations");
    // The switch is the card's own control, never a setting.
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
    await act(async () => buttonIn(present(page(), "page"), "Ask again").click());
    await settle();
    expect(card("graph").querySelector('[data-testid="switch-graph"]')).not.toBeNull();
  });

  it("does not draw a footprint it could not read as one with nothing in it", async () => {
    failing = "footprint";
    await openFromHeader();
    expect(page()?.querySelector('[role="alert"]')?.textContent).toBe(
      "extension.footprint is not granted",
    );
    // Its settings stay, read from the graph; its switch and its Details do not.
    expect(card("graph").querySelector('[data-testid="switch-graph"]')).toBeNull();
    expect(card("graph").querySelector('[data-settings-fold$=":details"]')).toBeNull();
  });
});
