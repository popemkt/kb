/**
 * A query a component reads through its graph view is that component's
 * dependency: when the replica moves the query is asked again, and the
 * component re-renders with the new answer. Before, a read through the view
 * was not watched, and a move left the old rows on screen (review of #5).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KbNode } from "@kb/model";
import { answerOf, DatascriptIndex, derivedWith } from "@kb/query";
import { type GraphSource, useGraphReadThrough } from "./graph-read";
import { ReplicaQueries } from "./replica-queries";
import { schemaOfGraph } from "./schema";
import type { NodeMap } from "./types";

const IDS = "[:find ?id :where [?n :node/id ?id]]";

function node(id: string): KbNode {
  return {
    id,
    text: id,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const turns = async () => {
  for (let turn = 0; turn < 4; turn += 1) await new Promise((r) => setTimeout(r, 0));
};

describe("a graph view's query reads (component)", () => {
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
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks a query read through the view again when the replica moves, and shows its answer", async () => {
    const index = new DatascriptIndex([node("a")], { derived: derivedWith({}) });
    let asked = 0;
    const queries = new ReplicaQueries(
      {
        run: async (request) => {
          asked += 1;
          return answerOf(index, request, () => performance.now());
        },
      },
      () => index.generation,
      {
        now: () => Date.now(),
        set: (run, ms) => {
          const handle = setTimeout(run, ms);
          return () => clearTimeout(handle);
        },
      },
    );
    // Nothing but the graph store tells the view of a move: no other watched
    // query brings an answer by the way.
    const listeners = new Set<() => void>();
    const tell = () => {
      for (const listener of listeners) listener();
    };
    queries.subscribe(tell);
    const outline: NodeMap = new Map();
    const schema = schemaOfGraph(outline);
    const source: GraphSource = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      nodes: () => outline,
      schema: () => schema,
      queries: () => queries,
    };
    function Ids() {
      const graph = useGraphReadThrough(source);
      const run = graph.queries?.runner() ?? (() => []);
      return createElement(
        "p",
        null,
        run(IDS)
          .map(([id]) => String(id))
          .toSorted()
          .join(","),
      );
    }

    await act(async () => {
      root.render(createElement(Ids));
      await turns();
    });
    expect(container.textContent).toBe("a");
    const before = asked;

    await act(async () => {
      index.applyTx({ upserts: [node("b")], deletes: [] });
      queries.moved();
      tell();
      await turns();
    });
    expect(asked).toBeGreaterThan(before);
    expect(container.textContent).toBe("a,b");
  });
});
