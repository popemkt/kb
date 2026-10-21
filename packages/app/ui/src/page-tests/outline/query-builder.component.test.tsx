/**
 * The query builder (docs/brainstorms/2026-10-20-query-builder), driven
 * through the real results section, store and engine: what is asserted is
 * what `sys.f.query` holds after a gesture, what the tabs offer for what it
 * holds, and the count of the one answer the results read.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isQueryNode, present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { fieldTypeValue, syncUiPlugins, SYSTEM_IDS } from "@kb/ui-sdk";
import { OutlineListView } from "@kb/views";
import {
  outlineNodes,
  outlineUiPlugin,
  QueryResultsSection,
  useOutlineStore,
} from "@kb/outline-ui";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";

const ISO = "2026-10-01T00:00:00.000Z";

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}
const wire = (partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode => ({
  props: {},
  children: [],
  createdAt: ISO,
  updatedAt: ISO,
  ...partial,
});
const ref = (v: string) => ({ t: "ref" as const, v });
const isField = { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)] };

const QUERY = "n.query";

/** A todo tag templating status and due; three todos and a plain node; the query node. */
function graph(edn: string): WireNode[] {
  return [
    ...bundledSeed(ISO).filter((node) => !isQueryNode(node)),
    wire({
      id: "f.status",
      text: "status",
      children: ["s.doing", "s.done"],
      props: { ...isField, [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
    }),
    wire({ id: "s.doing", text: "Doing" }),
    wire({ id: "s.done", text: "Done" }),
    wire({
      id: "f.due",
      text: "due",
      props: { ...isField, [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("date")] },
    }),
    wire({
      id: "f.est",
      text: "estimate",
      props: { ...isField, [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("number")] },
    }),
    wire({
      id: "t.todo",
      text: "todo",
      props: {
        [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)],
        [SYSTEM_IDS.fieldsField]: [ref("f.status"), ref("f.due")],
      },
    }),
    wire({
      id: "n.a",
      text: "Ship it",
      props: {
        [SYSTEM_IDS.typeField]: [ref("t.todo")],
        "f.status": [ref("s.doing")],
        "f.est": [{ t: "num", v: 3 }],
      },
    }),
    wire({
      id: "n.b",
      text: "Write it",
      props: { [SYSTEM_IDS.typeField]: [ref("t.todo")], "f.status": [ref("s.done")] },
    }),
    wire({ id: "n.c", text: "Retro notes" }),
    wire({
      id: QUERY,
      text: "Open work",
      props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: edn }] },
    }),
  ];
}

/** What the query node stores now. */
const stored = (): string => {
  const [value] = outlineNodes().get(QUERY)?.props[SYSTEM_IDS.queryField] ?? [];
  return value?.t === "str" ? value.v : "";
};

const TODO_EDN = `[:find ?id :where [?n :node/id ?id] [?v1 :node/id "t.todo"] [?n :f/sys.f.type ?v1]]`;

describe("the query builder", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncPagePlugins([outlineUiPlugin]);
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
    syncUiPlugins([]);
  });

  async function mount(edn: string) {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(edn), 1, "fixtures");
    await act(async () => {
      root.render(
        <QueryResultsSection
          nodeId={QUERY}
          depth={0}
          view={OutlineListView}
          renderNode={({ nodeId }) => <div key={nodeId} data-result={nodeId} />}
        />,
      );
    });
    await answered();
  }

  /** Wait for the engine to answer the stored query, and the page to draw it. */
  async function answered() {
    await act(async () => {
      await useGraphStore
        .getState()
        .queries?.settle((run) => run(stored()))
        .catch(() => undefined);
    });
  }

  beforeEach(() => {
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const $ = (selector: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(selector);
  const ednEditor = () => present(container.querySelector("textarea"), "EDN editor");
  const tabs = () => [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
  const slot = (name: string): HTMLElement =>
    present(
      [...container.querySelectorAll<HTMLElement>("[data-qb-slot]")].find(
        (b) => b.getAttribute("aria-label")?.startsWith(name) === true,
      ),
      `slot ${name}`,
    );
  const results = () =>
    [...container.querySelectorAll("[data-result]")].map((r) => r.getAttribute("data-result"));
  const count = () => $("[data-qb-count]")?.textContent ?? null;

  /** Type `text` into `field`, replacing what it holds: the focused input when none is named. */
  async function type(text: string, field?: HTMLInputElement | HTMLTextAreaElement) {
    const input = present(
      field ?? (dom.window.document.activeElement as unknown as HTMLInputElement | null),
      "focused input",
    );
    await act(async () => {
      // React tracks the value it last set through the element's own
      // setter; the prototype's leaves that tracker behind, so it sees a
      // change. A textarea's change is read on keyup as well as on input.
      Reflect.set(Object.getPrototypeOf(input) as object, "value", text, input);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }) as unknown as Event);
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event,
      );
    });
  }

  async function key(
    target: Element,
    k: string,
    init: { metaKey?: boolean; shiftKey?: boolean } = {},
  ) {
    await act(async () => {
      target.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
          ...init,
        }) as unknown as Event,
      );
    });
  }

  /** Pick the row labelled `label` in the open picker. */
  async function pick(label: string) {
    const option = present(
      [...container.ownerDocument.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent.trim() === label,
      ),
      `option ${label}`,
    );
    await click(option);
  }

  it("a new query node opens on Conditions, with nothing said yet and every node counted", async () => {
    await mount(DEFAULT_QUERY_EDN);
    expect(tabs()).toEqual(["Conditions", "EDN"]);
    expect($('[role="tab"][aria-selected="true"]')?.textContent).toBe("Conditions");
    expect(container.textContent).toContain("No conditions: every node matches.");
    // One answer: the count is the results' own, every node but the query node.
    expect(count()).toBe(`${results().length} nodes`);
    // Opening never writes.
    expect(stored()).toBe(DEFAULT_QUERY_EDN);
  });

  it("adding a condition writes the canonical EDN, and the results and count follow", async () => {
    await mount(DEFAULT_QUERY_EDN);
    await click(present($('[data-qb-slot="add-condition"]'), "add condition"));
    // The new row's subject picker is open: the todo tag's fields come first.
    const offered = [...dom.window.document.querySelectorAll('[role="option"]')].map((o) =>
      o.textContent.trim(),
    );
    expect(offered.slice(0, 3)).toEqual(["has tag", "does not have tag", "text"]);
    await pick("has tag");
    // The tag slot opened next, with the add-tag step's candidates.
    await pick("todo");
    await vi.waitFor(() =>
      expect(stored()).toBe(
        '[:find ?id :where\n [?n :node/id ?id]\n [?v1 :node/id "t.todo"]\n [?n :f/sys.f.type ?v1]]',
      ),
    );
    await answered();
    expect(results().toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["n.a", "n.b"]);
    expect(count()).toBe("2 nodes");
  });

  it("the fields of the tags the query names are offered first", async () => {
    await mount(TODO_EDN);
    await click(present($('[data-qb-slot="add-condition"]'), "add condition"));
    const offered = [...dom.window.document.querySelectorAll('[role="option"]')].map((o) =>
      o.textContent.trim(),
    );
    expect(offered.slice(0, 2).toSorted()).toEqual(["due", "status"]);
  });

  it("editing an operator and its values writes them; removing the row writes it away", async () => {
    await mount(TODO_EDN);
    await click(present($('[data-qb-slot="add-condition"]'), "add condition"));
    await pick("status");
    // The values slot opened next: the field's own picker, over its options.
    await pick("Done");
    await vi.waitFor(() => expect(stored()).toContain(":f/f.status"));
    await answered();
    expect(results()).toEqual(["n.b"]);

    await click(slot("operator"));
    await pick("is not");
    await vi.waitFor(() => expect(stored()).toContain("(not-join [?n]"));
    await answered();
    expect(results()).toEqual(["n.a"]);
    expect(count()).toBe("1 node");

    const rows = container.querySelectorAll('[aria-label="remove condition"]');
    await click(present(rows[1] as HTMLElement | undefined, "second row's remove"));
    await vi.waitFor(() => expect(stored()).toBe(printed(TODO_EDN)));
  });

  it("a query that does not lift says why and offers only the EDN tab", async () => {
    const raw = '[:find ?id :where [?n :node/id ?id] [(get-else $ ?n :f/room "") ?r]]';
    await mount(raw);
    expect(tabs()).toEqual(["EDN"]);
    expect($("[data-qb-unlifted]")?.textContent).toMatch(/^Can't show as conditions: .+\.$/);
    const editor = ednEditor();
    expect(editor.value).toBe(raw);
    // Nothing is rewritten.
    expect(stored()).toBe(raw);
  });

  it("a write from elsewhere is lifted again", async () => {
    await mount(DEFAULT_QUERY_EDN);
    expect(container.textContent).toContain("No conditions");
    await act(async () => {
      useGraphStore.getState().hydrateFromWire(graph(TODO_EDN), 2, "fixtures");
    });
    await answered();
    expect(slot("condition").getAttribute("aria-label")).toBe("condition: has tag");
    expect(slot("tag").getAttribute("aria-label")).toBe("tag: todo");
    expect(count()).toBe("2 nodes");
  });

  it("the EDN tab writes the text as typed, and the last tab used is kept for the node", async () => {
    await mount(DEFAULT_QUERY_EDN);
    await click(present($('[data-qb-tab="edn"]'), "EDN tab"));
    expect(useOutlineStore.getState().queryTabs[QUERY]).toBe("edn");
    const editor = ednEditor();
    await act(async () => {
      editor.focus();
    });
    await type(TODO_EDN, editor);
    expect(present($("[data-qb-count]"), "count").getAttribute("data-qb-count")).toBe("current");
    await key(editor, "Enter", { metaKey: true });
    await vi.waitFor(() => expect(stored()).toBe(TODO_EDN));
    await answered();
    expect(count()).toBe("2 nodes");
    // Remounted, the node opens where it was left.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryResultsSection
          nodeId={QUERY}
          depth={0}
          view={OutlineListView}
          renderNode={({ nodeId }) => <div key={nodeId} data-result={nodeId} />}
        />,
      );
    });
    expect($('[role="tab"][aria-selected="true"]')?.textContent).toBe("EDN");
  });

  it("while the EDN tab holds text that does not parse, the count is the last one, dimmed", async () => {
    await mount(TODO_EDN);
    await click(present($('[data-qb-tab="edn"]'), "EDN tab"));
    const editor = ednEditor();
    await act(async () => {
      editor.focus();
    });
    await type("[:find ?id :where", editor);
    const chip = present($("[data-qb-count]"), "count");
    expect(chip.getAttribute("data-qb-count")).toBe("stale");
    expect(chip.textContent).toBe("2 nodes");
  });

  it("a run over its budget is counted as too long, never as a number", async () => {
    const slow = '[:find ?id :where [?n :node/id ?id] [?n :node/text "slow"]]';
    await mount(slow);
    const queries = present(useGraphStore.getState().queries, "queries");
    const read = queries.read.bind(queries);
    const over = {
      answer: { kind: "over-budget" as const, budgetMs: 3000, generation: 99 },
      current: true,
    };
    vi.spyOn(queries, "read").mockImplementation((edn) => (edn === slow ? over : read(edn)));
    await act(async () => {
      root.render(
        <QueryResultsSection
          nodeId={QUERY}
          depth={0}
          view={OutlineListView}
          renderNode={({ nodeId }) => <div key={nodeId} data-result={nodeId} />}
        />,
      );
    });
    expect(count()).toBe("took too long to count");
    expect(container.textContent).toContain("took longer than 3 s to run");
    vi.restoreAllMocks();
  });

  it("every slot is a button with an accessible name", async () => {
    await mount(
      '[:find ?id :where [?n :node/id ?id] [?v1 :node/id "t.todo"] [?n :f/sys.f.type ?v1] (not-join [?n] [?v2 :node/id "s.done"] [?n :f/f.status ?v2])]',
    );
    const names = [...container.querySelectorAll("[data-qb-slot]")].map((s) => [
      s.tagName,
      s.getAttribute("aria-label") ?? s.textContent,
    ]);
    expect(names).toEqual([
      ["BUTTON", "condition: has tag"],
      ["BUTTON", "tag: todo"],
      ["BUTTON", "remove condition"],
      ["BUTTON", "field: status"],
      ["BUTTON", "operator: is not"],
      ["BUTTON", "values: Done"],
      ["BUTTON", "remove condition"],
      ["BUTTON", "+ condition"],
      ["BUTTON", "+ group"],
    ]);
  });

  it("⌘↵ adds a condition below, and ⌫ on a row that says nothing removes it", async () => {
    await mount(TODO_EDN);
    const tag = slot("tag");
    await key(tag, "Enter", { metaKey: true });
    // A new row below, its subject picker open.
    expect(container.querySelectorAll("[data-qb-row]").length).toBe(2);
    expect($('[data-qb-picker="condition"] input')).not.toBeNull();
    await key(present($('[data-qb-picker="condition"] input'), "picker"), "Escape");
    const blank = slot("condition: none");
    expect(dom.window.document.activeElement).toBe(blank);
    await key(blank, "Backspace");
    expect(container.querySelectorAll("[data-qb-row]").length).toBe(1);
    // A row that says something is not removed by ⌫.
    await key(slot("tag"), "Backspace");
    expect(container.querySelectorAll("[data-qb-row]").length).toBe(1);
    expect(stored()).toBe(TODO_EDN);
  });

  it("a group is any of, all of or none of its conditions", async () => {
    await mount(TODO_EDN);
    await click(present($('[data-qb-slot="add-group"]'), "add group"));
    await pick("status");
    await pick("Doing");
    await vi.waitFor(() => expect(stored()).toContain('"s.doing"'));
    await answered();
    expect(results()).toEqual(["n.a"]);
    await click(slot("group"));
    await pick("none of");
    await vi.waitFor(() => expect(stored()).toContain("(not-join [?n]"));
    await answered();
    expect(results()).toEqual(["n.b"]);
  });
});

/** `edn` as the builder prints it. */
function printed(edn: string): string {
  return edn.replace(" :where ", " :where\n ").replaceAll("] [", "]\n [");
}
