/**
 * A query node answers with rows or with an error, and both reach the
 * results section. Before, only rows did: a query that could not run left
 * "Loading results…" on screen forever (closing audit P1-6). The answer is
 * the replica's engine's, socket open or not (DESIGN-UI.md → Replica
 * queries).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/api/fixture-graph";
import { SYSTEM_IDS } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { OutlineListView } from "@kb/views";
import { QueryResultsSection } from "@kb/outline-ui";

const BAD_EDN = "[:find ?id :where";

function queryWire(): WireNode {
  return {
    id: "n.bad",
    text: "Broken query",
    props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: BAD_EDN }] },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("query results: the replica's error answer (component)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
  });

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore
      .getState()
      .hydrateFromWire([...fixtureGraph.nodes, queryWire()], fixtureGraph.rev, "fixtures");
    useUiStore.getState().setWsStatus("open");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useUiStore.getState().setWsStatus("idle");
  });

  it("shows the engine's error in place of the loading state", async () => {
    act(() =>
      root.render(
        createElement(QueryResultsSection, {
          view: OutlineListView,
          nodeId: "n.bad",
          depth: 0,
          renderNode: () => null,
        }),
      ),
    );
    expect(container.textContent).toContain("Loading results…");

    // The reader that asks it throws the refusal; the section shows it.
    await act(async () => {
      await useGraphStore
        .getState()
        .queries?.settle((run) => run(BAD_EDN))
        .catch(() => undefined);
    });
    expect(container.textContent).not.toContain("Loading results…");
    const shown = container.querySelector('[data-query-results-for="n.bad"] .text-destructive');
    expect(shown?.textContent).toContain("Unexpected EOF");
  });
});
