/**
 * A frame shown as a calendar (DESIGN-UI.md → Calendar): its rows on the days
 * of a date field, the undated ones in a list beside them, the walk reaching
 * exactly the rows drawn. A row moves to a day by drag or by ⌘⇧←/→, one write
 * each, and the calendar opens at a day the keys move a row past the days
 * shown. "+ Add" in a day adds a row holding that day. Today is pinned, so no
 * test reads the wall clock.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outlineInstanceKey, providedFrameViews, schemaOf, syncUiPlugins } from "@kb/ui-sdk";
import type { WireNode } from "@kb/contracts";
import { present, SYSTEM_IDS, type PropValue } from "@kb/model";
import { installDomGlobals } from "@kb/ui-test-kit";
import {
  collectVisibleInstances,
  FrameViewSlot,
  outlineNodes,
  useOutlineStore,
  useSelectionKeymap,
} from "@kb/outline-ui";
import { collectionsUiPlugin } from "@kb/collections-ui";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin, collectionsUiPlugin]));
afterAll(() => syncUiPlugins([]));

const AT = "2026-11-14T00:00:00.000Z";
/** A Saturday: its week is Mon Nov 9 to Sun Nov 15. */
const TODAY = "2026-11-14";
const ref = (v: string): PropValue => ({ t: "ref", v });
const day = (v: string): PropValue => ({ t: "str", v });

function row(id: string, text: string, props: WireNode["props"] = {}, children: string[] = []) {
  return { id, text, props, children, createdAt: AT, updatedAt: AT } satisfies WireNode;
}

const DUE = {
  [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)],
  [SYSTEM_IDS.fieldTypeField]: [ref(SYSTEM_IDS.ftDate)],
};

function graph(settings: WireNode["props"]): WireNode[] {
  return [
    ...fixtureGraph.nodes.filter((n) => !viewFieldNodes.some((v) => v.id === n.id)),
    ...viewFieldNodes,
    row("f.due", "Due", DUE),
    ...framedAs(row("plan", "Plan", {}, ["a1", "a2", "a3", "a4"]), "calendar", settings),
    row("a1", "Tuesday's", { "f.due": [day("2026-11-10")] }),
    row("a2", "Saturday's", { "f.due": [day("2026-11-14")] }),
    row("a3", "Next week's", { "f.due": [day("2026-11-20")] }),
    row("a4", "Some day", {}),
  ];
}

const WEEK = graph({
  [SYSTEM_IDS.viewDateField]: [ref("f.due")],
  [SYSTEM_IDS.viewSpanField]: [{ t: "str", v: "week" }],
});

const wire = () => useGraphStore.getState().wireNodes;
const dueOf = (id: string) => wire().find((n) => n.id === id)?.props["f.due"];

function walked(): string[] {
  const { frameDays } = useOutlineStore.getState();
  return collectVisibleInstances("plan", {
    nodes: outlineNodes(),
    schema: schemaOf(useGraphStore.getState()),
    run: null,
    views: providedFrameViews().map((view) => view.key),
    chain: [],
    pages: {},
    expansion: new Map(),
    details: {},
    days: frameDays,
    today: TODAY,
  }).map((instance) => instance.nodeId);
}

const chipsIn = (el: Element) =>
  [...el.querySelectorAll("[data-calendar-chip]")].map((c) => c.getAttribute("data-calendar-chip"));

/** A phone's viewport, as the page reads it (`useNarrowViewport`). */
const phone = (query: string) =>
  ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

function Host() {
  useSelectionKeymap();
  return createElement(FrameViewSlot, { frameId: "plan", depth: 0 });
}

describe("a calendar over a date field", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });
  afterAll(() => installed.restore());

  async function show(nodes: WireNode[]): Promise<void> {
    useGraphStore.getState().hydrateFromWire(structuredClone(nodes), 1, "fixtures");
    useGraphStore.getState().zoomTo("plan");
    await act(async () => root.render(createElement(Host)));
  }

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.setState({ today: TODAY });
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  const cell = (on: string) =>
    present(container.querySelector(`[data-calendar-day="${on}"]`), `the cell of ${on}`);
  const undated = () =>
    present(container.querySelector("[data-calendar-undated]"), "the undated list");

  it("draws the week's days with their rows, the undated rows beside them, and walks those alone", async () => {
    await show(WEEK);
    expect(container.querySelectorAll("[data-calendar-day]")).toHaveLength(7);
    expect(chipsIn(cell("2026-11-10"))).toEqual(["a1"]);
    expect(chipsIn(cell("2026-11-14"))).toEqual(["a2"]);
    expect(chipsIn(undated())).toEqual(["a4"]);
    // Dated on a day it does not show: neither drawn nor walked.
    expect(container.querySelector('[data-calendar-chip="a3"]')).toBeNull();
    expect(walked()).toEqual(["a1", "a2", "a4"]);
    expect(container.querySelector("[data-calendar-title]")?.textContent).toBe("Nov 9 – 15, 2026");
    expect(undated().getAttribute("aria-label")).toBe("No Due");
  });

  it("steps a week on and back to today, as the host's screen state", async () => {
    await show(WEEK);
    const button = (label: string) =>
      present(container.querySelector<HTMLElement>(`[aria-label="${label}"]`), label);
    await act(async () => button("Next week").click());
    expect(useOutlineStore.getState().frameDays["plan"]).toBe("2026-11-21");
    expect(chipsIn(cell("2026-11-20"))).toEqual(["a3"]);
    expect(walked()).toEqual(["a3", "a4"]);
    const today = present(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Today"),
      "Today",
    );
    await act(async () => today.click());
    expect(useOutlineStore.getState().frameDays["plan"]).toBe(TODAY);
  });

  async function pressOn(id: string, keyName: string): Promise<void> {
    const at = outlineInstanceKey(id, outlineNodes());
    act(() => useOutlineStore.getState().selectNode(id, at));
    await act(async () => {
      dom.document.body.dispatchEvent(
        new dom.KeyboardEvent("keydown", {
          key: keyName,
          metaKey: true,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  it("moves a row a day on with ⌘⇧→, opening at its new day past the days shown", async () => {
    await show(WEEK);
    await pressOn("a2", "ArrowRight");
    expect(dueOf("a2")).toEqual([day("2026-11-15")]);
    expect(useOutlineStore.getState().frameDays["plan"]).toBeUndefined();
    await pressOn("a2", "ArrowRight");
    expect(dueOf("a2")).toEqual([day("2026-11-16")]);
    // Past Sunday: the calendar opens at Monday's week, so the row stays drawn and selected.
    expect(useOutlineStore.getState().frameDays["plan"]).toBe("2026-11-16");
    expect(walked()).toContain("a2");
    expect(useOutlineStore.getState().selectedNodeId).toBe("a2");
  });

  it("moves an undated row onto the day it is open at with ⌘⇧←, and a day back", async () => {
    await show(WEEK);
    await pressOn("a4", "ArrowLeft");
    expect(dueOf("a4")).toEqual([day(TODAY)]);
    await pressOn("a1", "ArrowLeft");
    expect(dueOf("a1")).toEqual([day("2026-11-09")]);
  });

  it("dates a row dropped on a day, and removes the date of one dropped on the list", async () => {
    await show(WEEK);
    // happy-dom leaves a drag event's dataTransfer out of its init, so it is set on the event.
    const data = new dom.DataTransfer();
    const fire = (target: Element, type: string) => {
      const event = new dom.DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: data });
      target.dispatchEvent(event as unknown as Event);
    };
    const drag = async (id: string, target: Element) => {
      const chip = present(container.querySelector(`[data-calendar-chip="${id}"]`), id);
      await act(async () => fire(chip, "dragstart"));
      await act(async () => {
        fire(target, "dragover");
        fire(target, "drop");
      });
    };
    await drag("a4", cell("2026-11-11"));
    expect(dueOf("a4")).toEqual([day("2026-11-11")]);
    await drag("a1", undated());
    expect(dueOf("a1") ?? []).toEqual([]);
  });

  it("adds a row holding the day from the day's + Add", async () => {
    await show(WEEK);
    const add = present(
      container.querySelector<HTMLElement>('[data-add-row][aria-label="Add to Tue, Nov 10"]'),
      "the day's + Add",
    );
    expect(add.tagName).toBe("BUTTON");
    await act(async () => add.click());
    const children = wire().find((n) => n.id === "plan")?.children ?? [];
    const added = present(
      children.find((id) => !["a1", "a2", "a3", "a4"].includes(id)),
      "the added row",
    );
    expect(dueOf(added)).toEqual([day("2026-11-10")]);
  });

  it("on a phone, dots a month's days, lists the open day's rows, and opens the day a selected row is on", async () => {
    Object.defineProperty(dom, "matchMedia", { value: phone, configurable: true });
    try {
      await show(
        graph({
          [SYSTEM_IDS.viewDateField]: [ref("f.due")],
          [SYSTEM_IDS.viewSpanField]: [{ t: "str", v: "month" }],
        }),
      );
      const tuesday = cell("2026-11-10");
      expect(tuesday.tagName).toBe("BUTTON");
      expect(tuesday.getAttribute("aria-label")).toBe("Tue, Nov 10, 1 row");
      const openDay = () =>
        present(container.querySelector("[data-calendar-open-day]"), "the open day's list");
      expect(openDay().getAttribute("data-calendar-open-day")).toBe(TODAY);
      expect(chipsIn(openDay())).toEqual(["a2"]);
      expect(container.querySelector('[data-calendar-chip="a1"]')).toBeNull();

      await act(async () => (tuesday as HTMLElement).click());
      expect(useOutlineStore.getState().frameDays["plan"]).toBe("2026-11-10");
      expect(chipsIn(openDay())).toEqual(["a1"]);

      // A row the keys reach on another day is drawn once it is selected.
      act(() =>
        useOutlineStore.getState().selectNode("a3", outlineInstanceKey("a3", outlineNodes())),
      );
      await act(async () => {});
      expect(useOutlineStore.getState().frameDays["plan"]).toBe("2026-11-20");
      expect(chipsIn(openDay())).toEqual(["a3"]);
    } finally {
      Reflect.deleteProperty(dom, "matchMedia");
    }
  });

  it("with no date field, holds every row in the list and asks for one", async () => {
    await show(graph({}));
    expect(chipsIn(undated())).toEqual(["a1", "a2", "a3", "a4"]);
    expect(undated().textContent).toContain("Choose a date field");
    expect(container.querySelector("[data-calendar-day] [data-add-row]")).toBeNull();
    // A month by default: its weeks cover November.
    expect(container.querySelector('[data-calendar-layout="month"]')).not.toBeNull();
  });
});
