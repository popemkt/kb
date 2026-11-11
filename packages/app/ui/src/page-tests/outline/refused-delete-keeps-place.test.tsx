/**
 * A refused delete leaves the person where they were. The commit refuses
 * deleting a seeded node and a node read from its source file
 * (`personWriteRefusal`); the row stays, and so does the selection on it, or
 * the caret in it. Only a delete that landed moves either past the row.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineInstanceKey, syncUiPlugins } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";
import { mountActiveTextHost } from "@/test-support/active-text-host";
import { installDomGlobals } from "@kb/ui-test-kit";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import {
  outlineNodes,
  useNodeKeyDown,
  useOutlineNode,
  useOutlineStore,
  useSelectionKeymap,
} from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const AT = "2026-08-08T05:00:00.000Z";
/** A seeded node: deleting it is its owner's. */
const SEEDED = "sys.test.seeded";
/** Nodes read from their source files, as saved queries are: a root, and two under it. */
const FILES = "q.files";
const FROM_FILE = "q.from-file";
const PARENT = "n.root-a";

const wire = (id: string, text: string): WireNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
});

/**
 * The fixture, with a seeded row after the person's under `PARENT`, and a
 * root of nodes read from files (virtual, as the index holds saved
 * queries), both open.
 */
function hydrate(): void {
  const nodes = structuredClone(fixtureGraph.nodes).map((node) =>
    node.id === PARENT ? { ...node, children: [...node.children, SEEDED] } : node,
  );
  const files = { ...wire(FILES, "from files"), children: ["q.first", FROM_FILE] };
  useGraphStore
    .getState()
    .hydrateFromWire(
      [
        ...nodes,
        wire(SEEDED, "seeded"),
        files,
        wire("q.first", "first file"),
        wire(FROM_FILE, "second file"),
      ],
      fixtureGraph.rev,
      "fixtures",
      [FILES, "q.first", FROM_FILE],
    );
  // Both start collapsed: open them, as `seedWithReference` does.
  act(() => useOutlineStore.getState().toggleCollapse(PARENT));
  act(() => useOutlineStore.getState().toggleCollapse(FILES));
}

/** What the page has toasted. */
const told = () => useUiStore.getState().toasts;

/** `id`'s row in the main outline. */
const keyOf = (id: string) => outlineInstanceKey(id, outlineNodes());

/** Let React and the fire-and-forget write chains settle. */
async function settle(rounds = 4, delayMs = 0): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
  }
}

function SelectionHost() {
  useSelectionKeymap();
  return null;
}

function EditingHost({ nodeId, instanceKey }: { nodeId: string; instanceKey: string }) {
  useOutlineNode(nodeId);
  const onKeyDown = useNodeKeyDown({ nodeId, instanceKey });
  return <div data-editor="true" contentEditable onKeyDown={onKeyDown} />;
}

describe("a refused delete keeps the person's place", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;
  let unmountTextHost: () => void;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });
  afterAll(() => {
    installed.restore();
  });

  beforeEach(async () => {
    await settle();
    resetOutlineStore();
    hydrate();
    useUiStore.setState({ toasts: [] });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    unmountTextHost = mountActiveTextHost();
  });
  afterEach(async () => {
    await settle(8, 1);
    act(() => root.unmount());
    container.remove();
    unmountTextHost();
  });

  async function press(target: EventTarget, key: string, mods: { metaKey?: boolean } = {}) {
    const ev = new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
    await act(async () => {
      target.dispatchEvent(ev as unknown as Event);
    });
    await settle();
  }

  /** Select `id`'s row and press Backspace, as selection mode deletes. */
  async function deleteSelected(id: string): Promise<void> {
    act(() => useOutlineStore.getState().selectNode(id, keyOf(id)));
    act(() => root.render(<SelectionHost />));
    await press(dom.document.body as unknown as EventTarget, "Backspace");
  }

  for (const [what, id] of [
    ["a seeded row", SEEDED],
    ["a row read from its source file", FROM_FILE],
  ] as const) {
    it(`keeps ${what} selected when the commit refuses deleting it`, async () => {
      const key = keyOf(id);
      await deleteSelected(id);
      expect(outlineNodes().has(id)).toBe(true);
      expect(told()).toHaveLength(1);
      const state = useOutlineStore.getState();
      expect([state.selectedNodeId, state.selectedInstanceKey]).toEqual([id, key]);
    });
  }

  it("moves the selection on when the delete landed", async () => {
    const [previous, row] = present(outlineNodes().get(PARENT), PARENT).children;
    await deleteSelected(present(row, "a second person's row"));
    expect(outlineNodes().has(present(row, "row"))).toBe(false);
    expect(useOutlineStore.getState().selectedNodeId).toBe(previous);
  });

  it("keeps the caret in a seeded row when the commit refuses deleting it", async () => {
    const key = keyOf(SEEDED);
    act(() => useOutlineStore.getState().activateNode(SEEDED, 2, key));
    act(() => root.render(<EditingHost nodeId={SEEDED} instanceKey={key} />));
    const editor = present(
      container.querySelector<HTMLElement>('[data-editor="true"]'),
      "the row's editor",
    );
    await press(editor, "Delete", { metaKey: true });
    expect(outlineNodes().has(SEEDED)).toBe(true);
    expect(told()).toHaveLength(1);
    const state = useOutlineStore.getState();
    expect([state.activeNodeId, state.activeInstanceKey]).toEqual([SEEDED, key]);
  });
});
