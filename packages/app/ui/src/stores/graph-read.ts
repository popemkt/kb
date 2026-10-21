/**
 * The page's graph as a graph source (`@kb/ui-sdk` → `lib/graph-read`):
 * what a row's tracked read of the graph answers from — the rows of the
 * projection the page stands in (`pageRows`), and the graph store's schema
 * and query answers. The page's `BrowserHost` answers its graph reads from
 * this same source.
 */
import { type GraphSource, schemaOf } from "@kb/ui-sdk";
import { subscribeAnswers, useGraphStore } from "@/stores/graph.store";
import { pageRows, subscribePage } from "@/stores/page";

export const pageGraph: GraphSource = {
  subscribe: (listener) => {
    const offPage = subscribePage(listener);
    const offAnswers = subscribeAnswers(listener);
    return () => {
      offPage();
      offAnswers();
    };
  },
  nodes: pageRows,
  schema: () => schemaOf(useGraphStore.getState()),
  queries: () => useGraphStore.getState().queries,
};
