/**
 * Triggers in the text (DESIGN-UI.md → Triggers in the text), in a row
 * being edited: what is typed opens the one picker at the caret, a pick
 * replaces what was typed for it, and what a trigger does with a pick is
 * its own.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledPlugin } from "@kb/contracts";
import { daysExtension } from "@kb/days";
import { parseDateInput, present, SYSTEM_IDS } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import { browserHost, DateTargetService, outlineInstanceKey, syncUiPlugins } from "@kb/ui-sdk";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, NodeCommandPalette, outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { useUiStore } from "@/stores/ui.store";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ROW = "n.root-c";

/** The row's text, as the graph holds it. */
const textOf = (id: string) => outlineNodes().get(id)?.text;

/** What the graph holds on `id` for `field`. */
const propOf = (id: string, field: string) =>
  useGraphStore.getState().wireNodes.find((n) => n.id === id)?.props[field] ?? [];

/** Days, as far as a date's node goes: every date leads to `days.<date>`. */
const days = bundledPlugin(
  daysExtension,
  definePlugin({
    name: "days",
    apply: (ctx) => ctx.provide(DateTargetService, (date) => Promise.resolve(`days.${date}`)),
  }),
);

describe("triggers in the text", () => {
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
  });

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(rankedFixture(), 1, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Edit row `row` with `text` in it, the caret at its end. */
  async function typed(text: string, row = ROW): Promise<HTMLElement> {
    await act(async () => mutations.updateNodeContent(row, text));
    const key = outlineInstanceKey(row, outlineNodes());
    act(() => useOutlineStore.getState().activateNode(row, text.length, key));
    await act(async () => {
      root.render(<NodeBlock nodeId={row} instanceKey={key} depth={0} />);
    });
    return present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable]`),
      "editor",
    );
  }

  /** The labels the open picker lists. */
  const listed = () =>
    [...container.querySelectorAll('[role="listbox"] [role="option"]')].map((o) =>
      o.textContent.trim(),
    );

  async function press(el: HTMLElement, key: string): Promise<boolean> {
    let prevented = false;
    await act(async () => {
      const ev = new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      el.dispatchEvent(ev as unknown as Event);
      prevented = ev.defaultPrevented;
    });
    return prevented;
  }

  describe("#", () => {
    it("offers the tags, and a pick takes the trigger out of the text and tags the row", async () => {
      const el = await typed("Read-only #to");
      expect(listed()).toContain("todo");
      expect(await press(el, "Enter")).toBe(true);
      await vi.waitFor(() =>
        expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: "tag.todo" }),
      );
      expect(textOf(ROW)).toBe("Read-only ");
    });

    it("makes a tag by the name typed", async () => {
      const el = await typed("#brandnew");
      expect(listed()).toContain('Create tag "brandnew"');
      await press(el, "Enter");
      await vi.waitFor(() =>
        expect(
          useGraphStore.getState().wireNodes.find((n) => n.text === "brandnew")?.id,
        ).toBeDefined(),
      );
      const tag = useGraphStore.getState().wireNodes.find((n) => n.text === "brandnew")?.id;
      await vi.waitFor(() =>
        expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: tag }),
      );
      expect(textOf(ROW)).toBe("");
    });

    it("stays text inside a word and before a space: C# and a heading", async () => {
      await typed("Use C#");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      await typed("# Heading");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });
  });

  describe(">", () => {
    /** An empty line: n.grandchild, alone under n.child-a2, holds nothing but its text. */
    const LINE = "n.grandchild";
    const ABOVE = "n.child-a2";

    /** Edit `LINE` with `text` in it, drawn under its parent's row, as the outline draws it. */
    async function typedOnLine(text: string): Promise<HTMLElement> {
      await act(async () => mutations.updateNodeContent(LINE, text));
      const key = outlineInstanceKey(LINE, outlineNodes());
      act(() => useOutlineStore.getState().activateNode(LINE, text.length, key));
      await act(async () => {
        root.render(
          <NodeBlock
            nodeId={ABOVE}
            instanceKey={outlineInstanceKey(ABOVE, outlineNodes())}
            depth={0}
          />,
        );
      });
      return present(
        container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable]`),
        "editor",
      );
    }

    it("on an empty line, a pick makes the line a field of the node it is under", async () => {
      const el = await typedOnLine(">stat");
      expect(listed()).toContain("status");
      await press(el, "Enter");
      await vi.waitFor(() => expect(propOf(ABOVE, "field.status")).toHaveLength(1));
      expect(outlineNodes().get(LINE)).toBeUndefined();
      expect(outlineNodes().get(ABOVE)?.children).toEqual([]);
      expect(propOf(LINE, "field.status")).toEqual([]);
    });

    it("lands in the new field's value, drawn under the node's row", async () => {
      const el = await typedOnLine(">stat");
      await press(el, "Enter");
      await vi.waitFor(() => {
        const section = container.querySelector(`[data-fields-for="${ABOVE}"]`);
        const slot = section?.querySelector('[data-field="field.status"] [data-value-slot]');
        expect(slot).not.toBeNull();
        expect(slot?.contains(dom.document.activeElement as unknown as Node)).toBe(true);
      });
    });

    it("is one undo step: the line comes back as typed and the field goes", async () => {
      const el = await typedOnLine(">stat");
      await press(el, "Enter");
      await vi.waitFor(() => expect(propOf(ABOVE, "field.status")).toHaveLength(1));
      expect(useGraphStore.getState().undoStack).toHaveLength(1);
      await act(() => mutations.undo());
      await vi.waitFor(() => expect(outlineNodes().get(ABOVE)?.children).toEqual([LINE]));
      expect(propOf(ABOVE, "field.status")).toEqual([]);
      expect(textOf(LINE)).toBe(">stat");
    });

    it("stays text on a row that holds more than its text, or sits under no node", async () => {
      // Children.
      await typed(">stat", ABOVE);
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      // A tag and a field, at the top.
      await typed(">stat", "n.root-b");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      // Nothing but its text, at the top: no node to be a field of.
      await typed(">stat");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });

    it("stays text after other text, and as a quote", async () => {
      await typedOnLine("a >stat");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      await typedOnLine("> quoted");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });
  });

  describe("@", () => {
    afterEach(() => syncPagePlugins([outlineUiPlugin]));

    it("offers the nodes, and a pick inserts a reference, as [[ does", async () => {
      const el = await typed("See @Search jumps");
      expect(listed()[0]).toContain("Search jumps to matching nodes");
      await press(el, "Enter");
      expect(textOf(ROW)).toBe("See [[n.root-b|Search jumps to matching nodes]]");
    });

    it("with days on, offers the date the query names first, and references its day", async () => {
      syncPagePlugins([outlineUiPlugin, days]);
      const now = new Date();
      const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
      const iso = present(parseDateInput("tomorrow", today), "tomorrow");
      const el = await typed("Due @tomorrow");
      const [first] = listed();
      expect(first).toContain("Tomorrow");
      await press(el, "Enter");
      await vi.waitFor(() =>
        expect(textOf(ROW)).toMatch(new RegExp(`^Due \\[\\[days\\.${iso}\\|`, "u")),
      );
    });

    it("does not offer the row it is typed in", async () => {
      await typed("Quokka notes @Quokka");
      expect(listed().filter((label) => label.includes("Quokka notes"))).toEqual([]);
    });

    it("does not offer a node the row sits under, and offers it to a row elsewhere", async () => {
      // n.grandchild sits under "Render outline…", under "Ship kb ui shell".
      await typed("Ask @Ship", "n.grandchild");
      expect(listed().filter((label) => label.includes("Ship kb ui shell"))).toEqual([]);
      await typed("Ask @Render", "n.grandchild");
      expect(listed().filter((label) => label.includes("Render outline"))).toEqual([]);
      await typed("Ask @Render");
      expect(listed()[0]).toContain("Render outline");
    });

    it("with days off, offers no date: a date leads nowhere", async () => {
      await typed("Due @tomorrow");
      expect(listed().filter((label) => label.includes("Tomorrow"))).toEqual([]);
    });

    it("stays text in an address and before a space", async () => {
      await typed("mail me@example.com");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      await typed("meet @ noon");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });
  });

  it("Escape closes a trigger's picker and keeps the text", async () => {
    const el = await typed("Read-only #to");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    await press(el, "Escape");
    await act(async () => {
      root.render(
        <NodeBlock nodeId={ROW} instanceKey={outlineInstanceKey(ROW, outlineNodes())} depth={0} />,
      );
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(textOf(ROW)).toBe("Read-only #to");
    expect(useOutlineStore.getState().activeNodeId).toBe(ROW);
  });

  describe("[[", () => {
    it("offers the nodes matching what follows, and a pick inserts a reference to one", async () => {
      const el = await typed("See [[Search jumps");
      expect(listed()[0]).toContain("Search jumps to matching nodes");
      expect(await press(el, "Enter")).toBe(true);
      expect(textOf(ROW)).toBe("See [[n.root-b|Search jumps to matching nodes]]");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });
  });

  /** Press ⌘Z (⌘⇧Z with `shift`) in `el`, the chord the text host answers. */
  async function chord(el: HTMLElement, shift = false): Promise<void> {
    await act(async () => {
      const key = shift ? "Z" : "z";
      const ev = new dom.KeyboardEvent("keydown", {
        key,
        metaKey: true,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev as unknown as Event);
    });
  }

  /** The editor of row `row` as it is drawn now. */
  const editorOf = (row = ROW) =>
    present(
      container.querySelector<HTMLElement>(
        `[data-instance-key="${outlineInstanceKey(row, outlineNodes())}"] [contenteditable]`,
      ),
      "editor",
    );

  describe("a pick is one write", () => {
    it("# : one undo step, one node.batch with the text and the tag; ⌘Z in the row takes it back", async () => {
      const el = await typed("x #to");
      const undoBefore = useGraphStore.getState().undoStack.length;
      await press(el, "Enter");
      await vi.waitFor(() =>
        expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: "tag.todo" }),
      );
      expect(textOf(ROW)).toBe("x ");
      const { undoStack } = useGraphStore.getState();
      expect(undoStack).toHaveLength(undoBefore + 1);
      // The step is both writes, sent as one call (`oneWrite`).
      expect(undoStack.at(-1)?.redo.map((a) => a.id)).toEqual(["node.update", "node.update"]);

      await chord(el);
      await vi.waitFor(() => expect(textOf(ROW)).toBe("x #to"));
      expect(propOf(ROW, SYSTEM_IDS.typeField)).not.toContainEqual({ t: "ref", v: "tag.todo" });
      expect(el.textContent).toBe("x #to");

      await chord(el, true);
      await vi.waitFor(() => expect(textOf(ROW)).toBe("x "));
      expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: "tag.todo" });
    });

    it("[[ : the reference and the text it replaced are one undo step", async () => {
      const el = await typed("See [[Search jumps");
      await press(el, "Enter");
      expect(textOf(ROW)).toBe("See [[n.root-b|Search jumps to matching nodes]]");
      await chord(el);
      await vi.waitFor(() => expect(textOf(ROW)).toBe("See [[Search jumps"));
    });

    it("typing after a pick undoes first, then the pick", async () => {
      const el = await typed("x #to");
      await press(el, "Enter");
      await vi.waitFor(() => expect(textOf(ROW)).toBe("x "));
      await act(async () => mutations.updateNodeContent(ROW, "x y"));
      await chord(el);
      await vi.waitFor(() => expect(textOf(ROW)).toBe("x "));
      expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: "tag.todo" });
      await chord(el);
      await vi.waitFor(() => expect(textOf(ROW)).toBe("x #to"));
      expect(propOf(ROW, SYSTEM_IDS.typeField)).not.toContainEqual({ t: "ref", v: "tag.todo" });
    });
  });

  describe("/", () => {
    /** The labels listed when `text` is typed in the row, or null when no picker opens. */
    async function offered(text: string): Promise<string[] | null> {
      await typed(text);
      return container.querySelector('[role="listbox"]') === null ? null : listed();
    }

    it("opens at the start and after a space, never inside a word, an address or [[", async () => {
      expect(await offered("/")).toContain("Indent");
      expect(await offered("then /ind")).toContain("Indent");
      expect(await offered("a/b")).toBeNull();
      expect(await offered("see https://x")).toBeNull();
      expect(await offered("[[/")).not.toContain("Indent");
      // Its query is one word: a space after it closes the picker.
      expect(await offered("/ind more")).toBeNull();
    });

    it("lists the node menu's commands for the row, in its order", async () => {
      const all = await offered("/");
      const menu = browserHost().nodeCommands(
        { nodeId: ROW, frameId: ROW, nodeIds: [ROW] },
        { close: () => {}, openStep: () => {} },
      );
      expect(all).toEqual(menu.map((command) => command.label));
    });

    it("runs a command about the row: /ind indents it, and the text goes, in one undo step", async () => {
      const el = await typed("/ind");
      const parentBefore = outlineNodes().get(ROW)?.parentId ?? null;
      const undoBefore = useGraphStore.getState().undoStack.length;
      await press(el, "Enter");
      await vi.waitFor(() => expect(outlineNodes().get(ROW)?.parentId).toBe("n.root-b"));
      expect(textOf(ROW)).toBe("");
      expect(useGraphStore.getState().undoStack).toHaveLength(undoBefore + 1);
      await act(() => mutations.undo());
      await vi.waitFor(() => expect(outlineNodes().get(ROW)?.parentId ?? null).toBe(parentBefore));
      expect(textOf(ROW)).toBe("/ind");
    });

    it("a command that is a picker step opens it in the node palette, where a pick writes", async () => {
      const key = outlineInstanceKey(ROW, outlineNodes());
      await act(async () => mutations.updateNodeContent(ROW, "/tag"));
      act(() => useOutlineStore.getState().activateNode(ROW, 4, key));
      function Page() {
        const open = useUiStore((s) => s.nodePaletteOpen);
        return (
          <>
            <NodeBlock nodeId={ROW} instanceKey={key} depth={0} />
            <NodeCommandPalette
              open={open}
              onClose={() => useUiStore.getState().setNodePaletteOpen(false)}
            />
          </>
        );
      }
      await act(async () => root.render(<Page />));
      expect(listed()[0]).toBe("Add tag");
      await press(editorOf(), "Enter");
      await vi.waitFor(() => expect(useUiStore.getState().nodePaletteOpen).toBe(true));
      expect(useUiStore.getState().nodePaletteStep).toBe("outline.add-tag");
      expect(textOf(ROW)).toBe("");
      const todo = present(
        [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
          (b) => b.textContent.trim() === "todo",
        ),
        "the todo row",
      ) as unknown as HTMLElement;
      await act(async () => todo.click());
      await vi.waitFor(() =>
        expect(propOf(ROW, SYSTEM_IDS.typeField)).toContainEqual({ t: "ref", v: "tag.todo" }),
      );
      act(() => useUiStore.getState().setNodePaletteOpen(false));
    });
  });
});
