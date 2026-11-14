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
import { DateTargetService, outlineInstanceKey, syncUiPlugins } from "@kb/ui-sdk";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, outlineNodes, useOutlineStore } from "@kb/outline-ui";
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

  /** Edit the row with `text` in it, the caret at its end. */
  async function typed(text: string): Promise<HTMLElement> {
    await act(async () => mutations.updateNodeContent(ROW, text));
    const key = outlineInstanceKey(ROW, outlineNodes());
    act(() => useOutlineStore.getState().activateNode(ROW, text.length, key));
    await act(async () => {
      root.render(<NodeBlock nodeId={ROW} instanceKey={key} depth={0} />);
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
    it("on a row that is only it, offers the fields, and a pick empties the row and adds one", async () => {
      const el = await typed(">stat");
      expect(listed()).toContain("status");
      await press(el, "Enter");
      await vi.waitFor(() => expect(propOf(ROW, "field.status")).toHaveLength(1));
      expect(textOf(ROW)).toBe("");
    });

    it("stays text after other text, and as a quote", async () => {
      await typed("a >stat");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
      await typed("> quoted");
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
});
