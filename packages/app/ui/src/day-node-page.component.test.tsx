/**
 * A day's page in the browser (DESIGN-UI.md → Days): a day opens in the
 * node page, as every node does, and below its outline come the sections
 * contributed for the tags it is (`ui.node-sections`; DESIGN-UI.md → Node
 * pages). Days contributes "Made or edited this day", shown only when the
 * family's `made or edited` setting says so; what is dated the day is its
 * References, never a section. Another family adds a section for `#day`
 * without days knowing it. It is drawn as a node's page is, the outline
 * rooted at the day, with the days family's page entry loaded beside the
 * page's host and the outline's.
 */
import { Suspense, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundledPlugin, type WireNode } from "@kb/contracts";
import { DAYS_IDS, daysExtension } from "@kb/days";
import { daysUiPlugin } from "@kb/days-ui";
import { SYSTEM_IDS } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import { OutlineEditor } from "@kb/outline-ui";
import { NodeSectionPoint, syncUiPlugins } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";

const AT = "2026-10-03T00:00:00.000Z";

function wire(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}
const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];

const DAY = wire("days.2026-11-12", "Thu, Nov 12", {
  [SYSTEM_IDS.typeField]: ref(DAYS_IDS.dayTag),
  [DAYS_IDS.keyField]: str("2026-11-12"),
});
/** The days family's node, its `made or edited` setting saying shown. */
const SHOWN = wire(DAYS_IDS.family, "Days", {
  [DAYS_IDS.touchedField]: ref(DAYS_IDS.touchedShown),
});
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

/** A plugin of another family, adding a section to every day's page through the core point. */
const eventsSection = definePlugin({
  name: "test-events-section",
  apply: (ctx) =>
    ctx.contribute(NodeSectionPoint, {
      id: "events",
      value: {
        tags: [DAYS_IDS.dayTag],
        order: 10,
        title: "Events",
        Component: ({ id }) => `events on ${id}`,
      },
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

  function hydrate(extra: WireNode[] = []): void {
    useGraphStore
      .getState()
      .hydrateFromWire([...fixtureGraph.nodes, ...NODES, ...extra], fixtureGraph.rev, "fixtures");
  }

  beforeEach(() => {
    resetOutlineStore();
    hydrate();
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
    await act(async () =>
      root.render(
        createElement(Suspense, { fallback: null }, createElement(OutlineEditor, { root: DAY.id })),
      ),
    );
    // The outline, then each section's body, which may be a chunk of its own.
    await settle(() => {
      if (container.querySelector("[data-zoomed-root-header]") === null) return false;
      return [...container.querySelectorAll("[data-node-section]")].every(
        (section) => section.textContent !== section.querySelector("h2")?.textContent,
      );
    });
  }

  const headings = () =>
    [...container.querySelectorAll("[data-node-section] h2")].map((h) => h.textContent);
  const section = (id: string) =>
    container.querySelector(`[data-node-section="${id}"]`)?.textContent ?? "";

  it("opens in the node page, with no section while the setting is off", async () => {
    syncPagePlugins([outlineUiPlugin, days]);
    await show();
    expect(container.querySelector("[data-zoomed-root-header]")?.textContent).toContain(
      "Thu, Nov 12",
    );
    expect(headings()).toEqual([]);
  });

  it("shows days' section when the setting says shown; what is dated the day is not one", async () => {
    hydrate([SHOWN]);
    syncPagePlugins([outlineUiPlugin, days]);
    await show();
    expect(headings()).toEqual(["Made or edited this day"]);
    // What is dated the day is a reference, naming the field that dates it.
    const references = container.querySelector(`[data-references-for="${DAY.id}"]`);
    expect(references?.textContent).toContain("due →Call the plumber");
    expect(references?.textContent).not.toContain("File taxes");
    expect(section("days.touched-day")).not.toContain("Call the plumber");
    // Every fixture node was made and edited on another day.
    expect(section("days.touched-day")).toContain("Nothing yet.");
  });

  it("takes another family's section for #day at its order, without days naming it", async () => {
    hydrate([SHOWN]);
    syncPagePlugins([outlineUiPlugin, days, eventsSection]);
    await show();
    expect(headings()).toEqual(["Events", "Made or edited this day"]);
    expect(container.textContent).toContain(`events on ${DAY.id}`);
  });
});
