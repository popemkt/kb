/**
 * The node ⌘K menu must not lie about the node it is pointed at.
 *
 * `isTag` was `targetNode.tags.some(t => t.id === "sys.tag")`, and `resolveTags`
 * never emits `sys.tag` (a "#tag" chip on a tag's own page is nonsense), so the
 * flag was permanently false and "Make supertag" was offered on nodes that
 * already were supertags. Same rule as everywhere else: read the kind slot.
 *
 * The pin and debug rows are toggles, so their labels are asserted in both
 * states — a command whose label does not move is indistinguishable from one
 * that did nothing.
 */
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TextTIcon } from "@phosphor-icons/react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present, fieldTypeValue, SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import {
  browserHost,
  frameRows,
  frameViewOf,
  isPinned,
  outlinePath,
  pageTitleInstanceKey,
  providedFrameViews,
  syncUiPlugins,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { CommandPalette } from "@/components/palette/command-palette";
import { mutations } from "@/actions/mutations";
import { pageEditor } from "@/stores/page-editor";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { singlePane } from "@kb/views";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { settingsUiPlugin } from "@/components/prefs/settings-plugin";
import { SETTINGS_PATH } from "@/lib/settings-trigger";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore, rowClosed } from "@/test-support/outline-store";
import { chartUiPlugin } from "@kb/chart-ui";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeCommandPalette, outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { collectionsUiPlugin } from "@kb/collections-ui";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them; the chart contributes "Add chart".
beforeAll(() => syncPagePlugins([outlineUiPlugin, collectionsUiPlugin, chartUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** A node as the seed declares it, less its children. */
function seeded(id: string): WireNode {
  const declared = present(
    bundledSeed(ISO).find((n) => n.id === id),
    id,
  );
  return wire({ id, text: declared.text, props: declared.props });
}

/** A plain row, a supertag, and the seed the pin and tag gestures write through. */
function graph(): WireNode[] {
  return [
    wire({ id: SYSTEM_IDS.tag, text: "sys.tag" }),
    wire({ id: "n.plain", text: "Plain node" }),
    wire({
      id: "t.super",
      text: "project",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
    ...REF_SEED_WIRES,
    wire({ id: SYSTEM_IDS.pinnedRoot, text: "Pinned" }),
    // The kind slot as the seed declares it: what tagging a row writes.
    seeded(SYSTEM_IDS.typeField),
    // The field "Turn into query" writes, as the seed declares it.
    wire({
      id: SYSTEM_IDS.queryField,
      text: "query",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
      },
    }),
    wire({
      id: "n.query",
      text: "A saved query",
      props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?e :where [?e]]" }] },
    }),
    ctxRefWire("n.ref", "n.plain"),
    // Where Move to… puts rows.
    wire({
      id: "n.inbox",
      text: "Inbox",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.super" }] },
    }),
  ];
}

/** The kinds a row carries, by id. */
const typesOf = (id: string) =>
  (
    useGraphStore.getState().wireNodes.find((n) => n.id === id)?.props[SYSTEM_IDS.typeField] ?? []
  ).map((v) => v.v);

/** The children of `id`, in order, as the store holds them. */
const childrenOf = (id: string) =>
  useGraphStore.getState().wireNodes.find((n) => n.id === id)?.children ?? [];

function seed() {
  resetOutlineStore();
  useUiStore.getState().setNodePaletteOpen(false);
  useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
  useDebugFieldsStore.setState({ ids: new Set() });
}

/** The reference rows that point at `id`. */
const references = (id: string) =>
  useGraphStore
    .getState()
    .wireNodes.filter((n) => n.props[SYSTEM_IDS.refTargetField]?.[0]?.v === id && n.id !== id);

describe("node command palette", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.requestAnimationFrame = (fn: () => void) => {
      fn();
      return 0;
    };
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dom.document.body.innerHTML = "";
  });

  /** The row the palette opens at: where the selected instance is shown. */
  function anchor(nodeId: string, instanceKey = `row/${nodeId}`) {
    const row = dom.document.createElement("div");
    row.setAttribute("data-menu-anchor", instanceKey);
    dom.document.body.appendChild(row);
  }

  async function open(nodeId: string) {
    anchor(nodeId);
    useOutlineStore.setState({ selectedNodeId: nodeId, selectedInstanceKey: `row/${nodeId}` });
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
  }

  const labels = () =>
    [...dom.document.querySelectorAll('[data-palette-list="true"] button')].map((b) =>
      b.textContent.trim(),
    );

  it("offers Make supertag on a plain node", async () => {
    await open("n.plain");
    expect(labels()).toContain("Make supertag");
  });

  it("does not offer Make supertag on a node that already is one", async () => {
    await open("t.super");
    expect(labels()).not.toContain("Make supertag");
  });

  it("labels the pin row from the node's current state", async () => {
    await open("n.plain");
    expect(labels()).toContain("Pin");
    expect(labels()).not.toContain("Unpin");
  });

  it("pins through the palette and flips the label", async () => {
    await open("n.plain");
    const pin = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Pin",
    ) as HTMLElement | undefined;
    await act(async () => {
      present(pin, "pin").click();
    });
    // The pin lands once the command's one write commits.
    await vi.waitFor(() => expect(isPinned(outlineNodes(), "n.plain")).toBe(true));

    await open("n.plain");
    expect(labels()).toContain("Unpin");
  });

  /** Open the menu over a range of rows, anchored at its head, the last. */
  async function openOver(nodeIds: readonly string[]) {
    // Closed first, so it opens on its commands, as a fresh ⌘. does.
    await act(async () => root.render(<NodeCommandPalette open={false} onClose={() => {}} />));
    const head = nodeIds.at(-1) ?? "";
    anchor(head);
    useOutlineStore.setState({
      selectedNodeId: head,
      selectedInstanceKey: `row/${head}`,
      selectedNodeIds: nodeIds,
    });
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
  }

  async function pick(label: string) {
    const row = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === label,
    ) as HTMLElement | undefined;
    await act(async () => present(row, label).click());
  }

  async function pickTag(id: string) {
    const row = dom.document.querySelector<InstanceType<typeof dom.HTMLElement>>(
      `[data-palette-list="true"] [data-picker-id="${id}"]`,
    );
    await act(async () => present(row, id).click());
  }

  it("over a range, offers only the commands that act on each row", async () => {
    await openOver(["n.plain", "n.query"]);
    expect(labels()).toEqual([
      "Add tag",
      "Add field",
      "Set field…",
      "Copy node IDs",
      "Copy as…",
      "Move to…",
      "Move and leave reference…",
      "Pin",
      "Count words",
      "Delete nodes",
    ]);
  });

  it("draws Set field… with an icon of its own, not Add field's", async () => {
    await openOver(["n.plain", "n.query"]);
    const icon = (label: string) =>
      [...dom.document.querySelectorAll('[data-palette-list="true"] button')]
        .find((b) => b.textContent.trim() === label)
        ?.querySelector("svg")?.innerHTML;
    // Add field's glyph in any weight: drawn apart, not one glyph lighter.
    const textT = (["bold", "regular"] as const).map((weight) => {
      const host = dom.document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<TextTIcon weight={weight} />);
      return host.querySelector("svg")?.innerHTML;
    });
    expect(icon("Add field")).toBe(textT[0]);
    expect(icon("Set field…")).toBeDefined();
    expect(textT).not.toContain(icon("Set field…"));
  });

  it("tags every row of a range with the tag picked, as one undo step", async () => {
    await openOver(["n.plain", "n.query"]);
    await pick("Add tag");
    await pickTag("t.super");
    await vi.waitFor(() => expect(typesOf("n.query")).toContain("t.super"));
    expect(typesOf("n.plain")).toContain("t.super");
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
  });

  it("removes a tag from the rows of a range that carry it", async () => {
    await openOver(["n.plain", "n.query"]);
    await pick("Add tag");
    await pickTag("t.super");
    await vi.waitFor(() => expect(typesOf("n.query")).toContain("t.super"));
    await openOver(["n.plain", "n.query"]);
    expect(labels()).toContain("Remove tag…");
    await pick("Remove tag…");
    expect(labels()).toEqual(["project"]);
    await pick("project");
    await vi.waitFor(() => expect(typesOf("n.query")).not.toContain("t.super"));
    expect(typesOf("n.plain")).not.toContain("t.super");
    expect(useGraphStore.getState().undoStack).toHaveLength(2);
  });

  it("pins every row of a range, and then offers to unpin them all", async () => {
    await openOver(["n.plain", "n.query"]);
    await pick("Pin");
    await vi.waitFor(() => expect(isPinned(outlineNodes(), "n.query")).toBe(true));
    expect(isPinned(outlineNodes(), "n.plain")).toBe(true);
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    await openOver(["n.plain", "n.query"]);
    expect(labels()).toContain("Unpin");
  });

  it("moves every row of a range under the node picked, as one undo step", async () => {
    await openOver(["n.plain", "n.query"]);
    await pick("Move to…");
    // Not the rows themselves, nor anywhere under them.
    expect(labels()).toContain("Inbox");
    expect(labels()).not.toContain("Plain node");
    expect(labels()).not.toContain("A saved query");
    expect(dom.document.body.textContent).toContain("⌥↵ leave a reference");
    await pick("Inbox");
    await vi.waitFor(() => expect(childrenOf("n.inbox")).toEqual(["n.plain", "n.query"]));
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    await act(async () => void (await mutations.undo()));
    expect(childrenOf("n.inbox")).toEqual([]);
  });

  it("picked with Alt, leaves a reference where each row was", async () => {
    await openOver(["n.query"]);
    await pick("Move to…");
    const inbox = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Inbox",
    );
    await act(async () => {
      present(inbox, "Inbox").dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, altKey: true }),
      );
    });
    await vi.waitFor(() => expect(childrenOf("n.inbox")).toEqual(["n.query"]));
    const left = useGraphStore
      .getState()
      .wireNodes.find(
        (n) => n.props[SYSTEM_IDS.refTargetField]?.[0]?.v === "n.query" && n.id !== "n.query",
      );
    expect(left).toBeDefined();
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
  });

  it("Move and leave reference… leaves a reference on Enter, and moves only with Alt", async () => {
    // What the fixture already holds, so the test counts what the move leaves.
    const before = { plain: references("n.plain").length, query: references("n.query").length };
    await openOver(["n.plain", "n.query"]);
    await pick("Move and leave reference…");
    expect(labels()).toContain("Inbox");
    expect(labels()).not.toContain("Plain node");
    expect(dom.document.body.textContent).toContain("⌥↵ move only");
    await pick("Inbox");
    await vi.waitFor(() => expect(childrenOf("n.inbox")).toEqual(["n.plain", "n.query"]));
    expect(references("n.plain")).toHaveLength(before.plain + 1);
    expect(references("n.query")).toHaveLength(before.query + 1);
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    await act(async () => void (await mutations.undo()));
    expect(childrenOf("n.inbox")).toEqual([]);
    expect(references("n.query")).toHaveLength(before.query);

    await openOver(["n.query"]);
    await pick("Move and leave reference…");
    const inbox = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Inbox",
    );
    await act(async () => {
      present(inbox, "Inbox").dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, altKey: true }),
      );
    });
    await vi.waitFor(() => expect(childrenOf("n.inbox")).toEqual(["n.query"]));
    expect(references("n.query")).toHaveLength(before.query);
  });

  it("labels the debug row from this node's own flag", async () => {
    await open("n.plain");
    expect(labels()).toContain("Show debug fields");

    act(() => useDebugFieldsStore.getState().toggle("n.plain"));
    await open("n.plain");
    expect(labels()).toContain("Hide debug fields");

    // A sibling is untouched — the flag is per node, not global.
    await open("t.super");
    expect(labels()).toContain("Show debug fields");
  });

  /**
   * The command set a node offers, in order (closed gaps
   * [[01M1MGCF0ECBDEPTHPKMSQ4YFD]] / [[01M1MGCRNVNBE5HW27Z83PK67B]]).
   *
   * Pinned as whole ordered lists rather than `toContain` checks: the order
   * is the menu's groups, then each command's order in its group
   * (DESIGN-UI.md → The node menu), and a row a condition drops must leave
   * the rest where they were.
   */
  it("lists every command a plain node offers, in order", async () => {
    await open("n.plain");
    expect(labels()).toEqual([
      "Add tag",
      "Turn into query",
      "Turn into reference…",
      "Add field",
      "Set field…",
      "Make supertag",
      "Search everything…",
      "Open in panel",
      "Open with: Outline",
      "Open with: Chart",
      "Copy node ID",
      "Copy as…",
      "Indent",
      "Outdent",
      "Move to…",
      "Move and leave reference…",
      "Pin",
      "Show debug fields",
      "View as: List",
      "View as: Table",
      "View as: Board",
      "View as: Cards",
      "View as: List with detail",
      "View as: Calendar",
      "Filter…",
      "Count words",
      "Delete node",
    ]);
  });

  it("offers a tag that extends a supertag, and drops Make supertag, keeping the rest in order", async () => {
    await open("t.super");
    expect(labels()).toEqual([
      "Add tag",
      "Make your own tag that extends this",
      "Turn into query",
      "Turn into reference…",
      "Add field",
      "Set field…",
      "Search everything…",
      "Open in panel",
      "Open with: Outline",
      "Open with: Chart",
      "Copy node ID",
      "Copy as…",
      "Indent",
      "Outdent",
      "Move to…",
      "Move and leave reference…",
      "Pin",
      "Show debug fields",
      "View as: List",
      "View as: Table",
      "View as: Board",
      "View as: Cards",
      "View as: List with detail",
      "View as: Calendar",
      "Filter…",
      "Count words",
      "Delete node",
    ]);
  });

  it("offers Add chart on a query node, after its views, and not on a plain node", async () => {
    await open("n.query");
    expect(labels()).toContain("Add chart");
    expect(labels().indexOf("Add chart")).toBe(labels().indexOf("Filter…") - 1);
    await open("n.plain");
    expect(labels()).not.toContain("Add chart");
  });

  it("Edit query opens a query node's tucked builder, and then offers to hide it", async () => {
    await open("n.plain");
    expect(labels()).not.toContain("Edit query");
    expect(rowClosed("n.query")).toBe(true);
    await open("n.query");
    const row = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Edit query",
    ) as HTMLElement | undefined;
    await act(async () => {
      present(row, "edit query row").click();
    });
    expect(useOutlineStore.getState().queryBuilders["n.query"]?.open).toBe(true);
    // The builder is drawn under the row, so a closed row is opened to show it.
    expect(rowClosed("n.query")).toBe(false);
    await open("n.query");
    expect(labels()).toContain("Hide query");
    expect(labels()).not.toContain("Edit query");
  });

  it("drops Turn into query on a node that already is one", async () => {
    await open("n.query");
    expect(labels()).not.toContain("Turn into query");
    expect(labels()[1]).toBe("Turn into reference…");
  });

  it.each([
    {
      command: "Group by…",
      choice: "Status",
      field: SYSTEM_IDS.viewGroupField,
      value: "sys.f.test-status",
    },
    {
      command: "Sort by…",
      choice: "Name",
      field: SYSTEM_IDS.viewSortField,
      value: SYSTEM_IDS.nodeTextField,
    },
  ])(
    "$command on a reference writes the board setting on its target",
    async ({ command, choice, field, value }) => {
      const [board, view] = framedAs(
        wire({ id: "n.board", text: "Board", children: ["n.zebra", "n.alpine"] }),
        "board",
      );
      const status = wire({
        id: "sys.f.test-status",
        text: "Status",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
        },
      });
      const tag = wire({
        id: "t.board-row",
        text: "Board row",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
          [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: status.id }],
        },
      });
      const props = {
        [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: tag.id }],
        [status.id]: [{ t: "str" as const, v: "Doing" }],
      };
      const zebra = wire({ id: "n.zebra", text: "Zebra", props });
      const alpine = wire({ id: "n.alpine", text: "Alpine", props });
      const reference = ctxRefWire("n.board-ref", board.id);
      useGraphStore
        .getState()
        .hydrateFromWire(
          [...graph(), ...viewFieldNodes, board, view, status, tag, zebra, alpine, reference],
          2,
          "fixtures",
        );
      const undoDepth = useGraphStore.getState().undoStack.length;
      await open(reference.id);
      await pick(command);
      expect(outlineNodes().get(view.id)?.props[field]).toBeUndefined();
      await pick(choice);
      await vi.waitFor(() =>
        expect(outlineNodes().get(view.id)?.props[field]).toEqual([{ t: "ref", v: value }]),
      );
      expect(outlineNodes().get(reference.id)?.props).toEqual(reference.props);
      expect(useGraphStore.getState().undoStack).toHaveLength(undoDepth + 1);
      const nodes = outlineNodes();
      const schema = browserHost().schema();
      const keys = providedFrameViews().map(({ key }) => key);
      const resolved = present(frameViewOf(nodes.get(board.id), schema, keys), "board view");
      const rows = frameRows({ frameId: board.id, nodes, schema, view: resolved });
      if (field === SYSTEM_IDS.viewGroupField) {
        expect(rows.columns[0]?.key).toBe("str:Doing");
      } else {
        expect(rows.rendered.map(({ id }) => id)).toEqual([alpine.id, zebra.id]);
      }
    },
  );

  it("drops Turn into reference on a node that already is one", async () => {
    await open("n.ref");
    expect(labels()).not.toContain("Turn into reference…");
    expect(labels()[1]).toBe("Turn into query");
  });

  it("opens at a page's title, where the page's node is active", async () => {
    const key = pageTitleInstanceKey("t.super");
    anchor("t.super", key);
    useOutlineStore.setState({ activeNodeId: "t.super", activeInstanceKey: key });
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
    expect(labels()).toContain("Make your own tag that extends this");
  });

  it("opens at the step it was opened at", async () => {
    anchor("n.plain");
    useOutlineStore.setState({ selectedNodeId: "n.plain", selectedInstanceKey: "row/n.plain" });
    useUiStore.getState().setNodePaletteOpen(true, "outline.add-tag");
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
    expect(dom.document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Add tag",
    );
  });

  it("Add tag opens the tag picker step", async () => {
    await open("n.plain");
    const row = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
      (b) => b.textContent.trim() === "Add tag",
    ) as HTMLElement | undefined;
    await act(async () => {
      present(row, "add tag row").click();
    });
    const input = dom.document.querySelector('[role="dialog"] input') as unknown as
      | HTMLInputElement
      | undefined;
    expect(present(input, "picker input").placeholder).toBe("Search or name a tag...");
    expect(dom.document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Add tag",
    );
  });
});

/**
 * ⌘K, the page's search, finds what the node menu offers the node it acts on
 * — the selected row, else the page's node — beside the graph, each marked
 * with that node. A tag's own page is where a person meets "Make your own tag
 * that extends this", so it is found there with nothing selected.
 */
describe("the global palette on a page", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    // The page's routes too: a pane opened at a node names it by its route.
    syncPagePlugins([
      outlineUiPlugin,
      collectionsUiPlugin,
      chartUiPlugin,
      layoutUiPlugin,
      settingsUiPlugin,
    ]);
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    seed();
    // ⌘K's own "Filter…", whose node face the node menu offers.
    const filter = {
      id: SYSTEM_IDS.cmdViewFilter,
      text: "Filter…",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.command }] },
    };
    useGraphStore.getState().hydrateFromWire([...graph(), wire(filter)], 2, "fixtures");
    useGraphStore.setState({ rootNodeId: "t.super" });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    // The page's title, where the page's node is shown and its menu opens.
    title = dom.document.createElement("div");
    title.setAttribute("data-menu-anchor", pageTitleInstanceKey("t.super"));
    dom.document.body.appendChild(title);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    title.remove();
    vi.restoreAllMocks();
  });

  let title: InstanceType<typeof dom.HTMLElement>;

  async function openPalette() {
    await act(async () => {
      root.render(<CommandPalette open onClose={() => {}} />);
    });
  }

  /** A row of the palette by its text, and what it marks as its target. */
  const row = (text: string) => {
    const button = [...dom.document.querySelectorAll("[data-palette-row]")].find(
      (b) => b.querySelector(".flex-1")?.textContent === text,
    );
    return present(button, `palette row ${text}`) as unknown as HTMLElement;
  };

  it("lists the page's node's commands, marked with the node", async () => {
    await openPalette();
    const extend = row("Make your own tag that extends this");
    expect(extend.lastElementChild?.textContent).toBe("project");
  });

  it("acts on the node a pane is opened at, as on the zoom", async () => {
    useGraphStore.setState({ rootNodeId: WORKSPACE_ROOT_ID });
    const before = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      layout: singlePane({ id: "p.node", path: "/node/t.super" }),
      focused: "p.node",
    });
    try {
      await openPalette();
      expect(row("Make your own tag that extends this").lastElementChild?.textContent).toBe(
        "project",
      );
    } finally {
      useWorkspaceStore.setState({ layout: before.layout, focused: before.focused });
    }
  });

  it("lists a global command once, as the node's face of it", async () => {
    await openPalette();
    // Searched for: the palette shows its first rows only.
    const input = present(
      dom.document.querySelector('[aria-label="Search and open"] input'),
      "palette input",
    ) as unknown as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Filter",
      );
      // React met no DOM when it loaded, so it reads a text change on a key.
      input.dispatchEvent(new dom.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
    });
    const filters = [...dom.document.querySelectorAll("[data-palette-row]")].filter(
      (b) => b.querySelector(".flex-1")?.textContent === "Filter…",
    );
    expect(filters.map((b) => b.lastElementChild.textContent)).toEqual(["project"]);
  });

  it("lists no node's commands where its menu cannot open, and the global ones stand", async () => {
    // A page that shows its node with no title: a canvas, a graph.
    title.remove();
    await openPalette();
    const texts = [...dom.document.querySelectorAll("[data-palette-row]")].map(
      (b) => b.querySelector(".flex-1")?.textContent,
    );
    expect(texts).not.toContain("Make your own tag that extends this");
    expect(row("Filter…").lastElementChild?.textContent).toBe("cmd");
  });

  it("runs one on the page's node", async () => {
    const defineTag = vi.spyOn(browserHost().writes, "defineTag").mockResolvedValue(null);
    await openPalette();
    await act(async () => {
      row("Make your own tag that extends this").click();
    });
    expect(defineTag).toHaveBeenCalledWith("my project", ["t.super"]);
  });

  it.each([
    { path: "/", zoom: "t.super", parent: "t.super" },
    { path: "/", zoom: WORKSPACE_ROOT_ID, parent: undefined },
    { path: "/node/n.inbox", zoom: "t.super", parent: "n.inbox" },
    {
      path: outlinePath({ ontology: "t.super", zoom: "n.inbox" }),
      zoom: "t.super",
      parent: "n.inbox",
    },
    { path: SETTINGS_PATH, zoom: "t.super", parent: undefined },
  ])(
    "Alt+Enter saves and opens a query from $path (outline at $zoom)",
    async ({ path, zoom, parent }) => {
      const before = useWorkspaceStore.getState();
      useGraphStore.setState({ rootNodeId: zoom });
      useWorkspaceStore.setState({
        layout: singlePane({ id: "p.search", path }),
        focused: "p.search",
      });
      const add = vi.spyOn(browserHost().writes, "addMatchingNode");
      try {
        await openPalette();
        const input = present(
          dom.document.querySelector('[aria-label="Search and open"] input'),
          "palette input",
        );
        const text = 'Project "notes"';
        await act(async () => {
          Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")?.set?.call(
            input,
            text,
          );
          input.dispatchEvent(new dom.KeyboardEvent("keyup", { bubbles: true }));
        });
        expect(container.textContent).toContain("Alt+Enter");
        await act(async () => {
          input.dispatchEvent(
            new dom.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true }),
          );
        });
        await vi.waitFor(() => {
          const { rootNodeId: id, wireNodes } = useGraphStore.getState();
          expect(wireNodes.find((node) => node.children.includes(id))?.id).toBe(parent);
          const value = outlineNodes().get(id)?.props[SYSTEM_IDS.queryField]?.[0]?.v;
          expect(value).toEqual(expect.stringContaining("kb/includes-ci?"));
          expect(value).toEqual(expect.stringContaining(JSON.stringify(text)));
        });
        if (parent === undefined) expect(add.mock.calls[0]?.[0]).not.toHaveProperty("parent");
      } finally {
        useWorkspaceStore.setState({ layout: before.layout, focused: before.focused });
      }
    },
  );

  it("hands a command that asks for a step to the node menu at the page's title", async () => {
    await openPalette();
    await act(async () => {
      row("Add tag").click();
    });
    expect(pageEditor().getState().selectedNodeId).toBe("t.super");
    expect(pageEditor().getState().selectedInstanceKey).toBe(pageTitleInstanceKey("t.super"));
    expect(useUiStore.getState().nodePaletteStep).toBe("outline.add-tag");
  });
});
