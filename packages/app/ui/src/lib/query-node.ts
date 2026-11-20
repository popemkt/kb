/**
 * Query nodes in the UI: the definition a new one starts with. What a query
 * node is (its field, its EDN and limit) is `@kb/model`'s `query-node.ts`,
 * read the same way by the server; its rows are the replica's answer
 * (`useQueryRows`), and the ids they name are the kit's (`resultNodeIds`).
 */
import { SYSTEM_IDS } from "@kb/model";
import { browserHost, conditionsEdn } from "@kb/ui-sdk";

/**
 * What a minted query node asks: every node, no conditions yet. It is the
 * query the builder writes for no conditions (`lowerIr([])`), on one line,
 * so a new query node opens in the Conditions tab with nothing to say yet.
 */
export const DEFAULT_QUERY_EDN = "[:find ?id :where [?n :node/id ?id]]";

/** Save the search as a node with a text condition, then open its results. */
export async function openQueryFromSearch(
  text: string,
  parent: string | undefined,
  zoomTo: (id: string) => void,
): Promise<void> {
  const added = await browserHost().writes.addMatchingNode({
    ...(parent === undefined ? {} : { parent }),
    tags: [],
    props: [
      {
        field: SYSTEM_IDS.queryField,
        value: { t: "str", v: conditionsEdn([{ kind: "text-contains", text, exactCase: false }]) },
      },
    ],
  });
  if (added !== null) zoomTo(added.id);
}
