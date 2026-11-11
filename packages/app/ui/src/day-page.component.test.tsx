/**
 * The day page in the browser (DESIGN-UI.md → Days): below the day's own
 * outline come the sections plugins contribute to `days.sections`, in
 * ascending order. Days fills one, "Made or edited this day" (what is dated
 * the day is its References, which the outline draws), and another plugin
 * adds its own without days knowing it. It
 * is drawn as the shell draws it: the days family's page entry loaded
 * beside the page's host, and its view found on the view point.
 */
import { Suspense, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundledPlugin, type WireNode } from "@kb/contracts";
import { DAYS_IDS, DayView, daysExtension } from "@kb/days";
import { DaySectionPoint, daysUiPlugin } from "@kb/days-ui";
import { SYSTEM_IDS } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import { currentView, syncUiPlugins } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";

const AT = "2026-10-03T00:00:00.000Z";

function wire(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}
const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];

const DAY = wire("days.2026-11-12", "Thu, Nov 12", { [DAYS_IDS.keyField]: str("2026-11-12") });
const DUE = wire("f.due", "due", { [SYSTEM_IDS.fieldTypeField]: ref(SYSTEM_IDS.ftDate) });
const NOTE = wire("f.note", "note");
const NODES = [
  DAY,
  DUE,
  NOTE,
  wire("t.plumber", "Call the plumber", { "f.due": str("2026-11-12") }),
  wire("t.later", "File taxes", { "f.due": str("2026-11-13") }),
  wire("t.text", "Says 2026-11-12 in text", { "f.note": str("2026-11-12") }),
];

/** Days' page entry under its own declaration, as the shell binds a bundled family. */
const days = bundledPlugin(daysExtension, daysUiPlugin);

/** A plugin of another family, adding a section to the day page through the declared point. */
const eventsSection = definePlugin({
  name: "test-events-section",
  uses: [DaySectionPoint.name],
  apply: (ctx) =>
    Effect.gen(function* () {
      const point = yield* ctx.point(DaySectionPoint);
      yield* ctx.contribute(point, {
        id: "events",
        value: { order: 10, title: "Events", Component: ({ day }) => `events on ${day}` },
      });
    }),
});

async function settle(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("day page (component)", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  });
  afterAll(() => dom.restore());
  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore
      .getState()
      .hydrateFromWire([...fixtureGraph.nodes, ...NODES], fixtureGraph.rev, "fixtures");
    useUiStore.getState().setWsStatus("idle");
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(): Promise<void> {
    const page = currentView(DayView);
    if (page === null) throw new Error("the days family's page entry provides no day view");
    await act(async () =>
      root.render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(page.Component, { params: { id: DAY.id }, host: { placement: "page" } }),
        ),
      ),
    );
    // The page and each section's body are chunks of their own.
    await settle(() => {
      const sections = [...container.querySelectorAll("[data-day-section]")];
      return (
        sections.length > 0 &&
        sections.every(
          (section) =>
            section.childElementCount > 1 ||
            section.textContent !== section.querySelector("h2")?.textContent,
        )
      );
    });
  }

  const headings = () =>
    [...container.querySelectorAll("[data-day-section] h2")].map((h) => h.textContent);
  const section = (id: string) =>
    container.querySelector(`[data-day-section="${id}"]`)?.textContent ?? "";

  it("shows days' one section; what is dated the day is not a section of its own", async () => {
    syncPagePlugins([days]);
    await show();
    expect(headings()).toEqual(["Made or edited this day"]);
    expect(container.textContent).not.toContain("Call the plumber");
    // Every fixture node was made and edited on another day.
    expect(section("days.touched")).toContain("Nothing yet.");
  });

  it("takes another plugin's section at its order, without days naming it", async () => {
    syncPagePlugins([days, eventsSection]);
    await show();
    expect(headings()).toEqual(["Events", "Made or edited this day"]);
    expect(container.textContent).toContain("events on 2026-11-12");
  });
});
