/**
 * Pending migrations in Settings and the header, through the real App
 * (DESIGN-UI.md → Settings → Migrations, and Migrations ready to review):
 * what both draw is `migration.list`'s output, the list `kb migrate` prints
 * and MCP calls, so the stand-in server answers that action and nothing
 * else about migrations.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionRequest, GraphSnapshot } from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { present } from "@kb/model";
import { setFetchGraphSnapshot } from "@/api/graph";
import { setPostAction } from "@/api/action";
import { loadManifest } from "@/lib/manifest";
import { useGraphStore } from "@/stores/graph.store";
import { useMigrationsStore, type MigrationRow } from "@/stores/migrations.store";
import { ISO, REPORT } from "@/test-support/extension-report-fixture";
import { App } from "@/components/App";

const RENAME: MigrationRow = {
  id: "fam.rename",
  title: "Rename old to new",
  state: null,
  pending: true,
  changes: 2,
};
const KEPT: MigrationRow = {
  id: "fam.kept",
  title: "Move dates",
  state: "kept",
  pending: false,
  changes: 0,
};

const snapshot = (): GraphSnapshot => ({ rev: 3, nodes: bundledSeed(ISO) });

describe("pending migrations in the UI", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;
  let asked: ActionRequest[] = [];
  /** What the stand-in server's `migration.list` answers: its rows, or a failure. */
  let listed: readonly MigrationRow[] | "fails" = [];

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
      if (invocation.id === "migration.list" && listed === "fails")
        return Promise.resolve({
          status: "failed",
          id: invocation.id,
          code: "forbidden",
          message: "migration.list is not granted",
          rev: 3,
        });
      const output =
        invocation.id === "migration.list"
          ? { migrations: listed }
          : invocation.id === "extension.list"
            ? REPORT
            : invocation.id === "extension.footprint"
              ? { rows: [] }
              : invocation.id === "kb.manifest"
                ? { actions: [], views: [], extensions: REPORT.extensions }
                : invocation.id === "extension.marketplace.list"
                  ? { marketplaces: [] }
                  : {};
      return Promise.resolve({ status: "succeeded", id: invocation.id, output, rev: 3 });
    });
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
  });

  /** Draw the App at `/` with the server's list at `rows`. */
  async function mount(rows: readonly MigrationRow[] | "fails"): Promise<void> {
    listed = rows;
    asked = [];
    useMigrationsStore.setState({ reading: null, dismissed: new Set() });
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await vi.waitFor(() => expect(useMigrationsStore.getState().reading).not.toBeNull());
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const note = () => container.querySelector<HTMLElement>("header [data-migrations-note]");
  const lists = () => asked.filter((call) => call.id === "migration.list").length;
  const group = () => container.querySelector<HTMLElement>("section#migrations");
  const card = (id: string) =>
    present(container.querySelector<HTMLElement>(`[data-testid="migration-${id}"]`), id);

  async function openFromNote(): Promise<void> {
    await act(async () => {
      present(note()?.querySelector("a"), "the line's link").click();
    });
    await vi.waitFor(() => expect(group()).not.toBeNull());
  }

  it("the header's line counts the pending migrations and lands on Settings' Migrations", async () => {
    await mount([RENAME, KEPT]);
    expect(lists()).toBeGreaterThan(0);
    await vi.waitFor(() => expect(note()?.textContent).toContain("1 migration ready to review"));
    expect(note()?.querySelector("a")?.getAttribute("href")).toBe(
      "/settings/extensions#migrations",
    );
    await openFromNote();
    expect(dom.location.pathname).toBe("/settings/extensions");
    expect(dom.location.hash).toBe("#migrations");
    // The group is open and its caption counts them, and those ready to review.
    expect(group()?.dataset.open).toBe("true");
    expect(group()?.textContent).toContain("2 · 1 ready to review");
  });

  it("draws one card per listed migration, its pill, and a button to its procedure", async () => {
    const all: MigrationRow[] = [
      RENAME,
      KEPT,
      { ...RENAME, id: "fam.a", state: "previewed" },
      { ...RENAME, id: "fam.b", state: "applied" },
      { ...RENAME, id: "fam.c", state: "verified" },
      { ...RENAME, id: "fam.d", state: "failed" },
      { ...RENAME, id: "fam.e", state: "rolled-back" },
      { ...RENAME, id: "fam.f", pending: false, changes: 0 },
      { ...RENAME, id: "fam.g", changes: 0, problem: "the script threw" },
    ];
    await mount(all);
    await openFromNote();
    const cards = [...container.querySelectorAll<HTMLElement>('[data-testid^="migration-"]')];
    expect(cards.map((el) => el.dataset.testid)).toEqual(all.map((m) => `migration-${m.id}`));
    const pill = (id: string) => card(id).querySelector("[data-migration-state]")?.textContent;
    expect(all.map((m) => pill(m.id))).toEqual([
      "pending",
      "kept",
      "previewed",
      "applied",
      "verified",
      "failed",
      "rolled back",
      "nothing to do",
      "cannot plan",
    ]);
    expect(card("fam.rename").textContent).toContain("fam.rename · 2 nodes to write now");
    expect(card("fam.g").textContent).toContain("cannot plan: the script threw");
    const open = (id: string) =>
      present(card(id).querySelector<HTMLButtonElement>("[data-migration-open]"), id);
    expect(open("fam.kept").textContent).toBe("Open");
    expect(open("fam.rename").textContent).toBe("Review");
    await act(async () => open("fam.rename").click());
    expect(dom.location.pathname).toBe("/procedure/migration.fam.rename");
  });

  it("a dismissal holds for the session, until another migration is pending", async () => {
    await mount([RENAME, KEPT]);
    await vi.waitFor(() => expect(note()).not.toBeNull());
    await act(async () => {
      present(
        note()?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss for this session"]'),
        "dismiss",
      ).click();
    });
    expect(note()).toBeNull();
    // Read again, the same pending migration stays dismissed.
    await act(async () => loadManifest());
    await vi.waitFor(() => expect(lists()).toBeGreaterThan(1));
    expect(note()).toBeNull();
    // A migration pending later brings the line back, counting only it.
    listed = [RENAME, { ...KEPT, id: "fam.new", state: null, pending: true, changes: 1 }];
    await act(async () => loadManifest());
    await vi.waitFor(() => expect(note()?.textContent).toContain("1 migration ready to review"));
    // Nothing opened by itself: still on the page it was.
    expect(dom.location.pathname).toBe("/");
  });

  it("reads again after a write only while a family declares a migration", async () => {
    await mount([]);
    const before = lists();
    await act(async () => useGraphStore.setState({ rev: 4 }));
    expect(lists()).toBe(before);
    expect(note()).toBeNull();
    listed = [RENAME];
    await act(async () => loadManifest());
    await vi.waitFor(() => expect(note()).not.toBeNull());
    const declared = lists();
    await act(async () => useGraphStore.setState({ rev: 5 }));
    await vi.waitFor(() => expect(lists()).toBe(declared + 1));
  });

  it("says when no family declares one, and when the list could not be read", async () => {
    await mount([]);
    dom.history.pushState({}, "", "/settings/extensions");
    await act(async () => dom.dispatchEvent(new dom.PopStateEvent("popstate")));
    await vi.waitFor(() => expect(group()).not.toBeNull());
    expect(group()?.querySelector('[data-testid="migrations-empty"]')?.textContent).toBe(
      "No family declares a data migration.",
    );
    act(() => root.unmount());
    container.remove();
    await mount("fails");
    expect(note()).toBeNull();
    dom.history.pushState({}, "", "/settings/extensions");
    await act(async () => dom.dispatchEvent(new dom.PopStateEvent("popstate")));
    await vi.waitFor(() => expect(group()).not.toBeNull());
    const unread = present(group()?.querySelector('[data-testid="migrations-unread"]'), "unread");
    expect(unread.getAttribute("role")).toBe("alert");
    expect(unread.textContent).toContain("migration.list is not granted");
    listed = [RENAME];
    await act(async () => present(unread.querySelector("button"), "read again").click());
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="migration-fam.rename"]')).not.toBeNull(),
    );
  });
});
