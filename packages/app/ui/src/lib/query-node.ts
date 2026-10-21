/**
 * Query nodes in the UI: the definition a new one starts with. What a query
 * node is (its field, its EDN and limit) is `@kb/model`'s `query-node.ts`,
 * read the same way by the server; its rows are the replica's answer
 * (`useQueryRows`), and the ids they name are the kit's (`resultNodeIds`).
 */

/**
 * What a minted query node asks: every node, no conditions yet. It is the
 * query builder's canonical query (`lowerIr([])`, printed by `printEdn`), so
 * a new query node opens in the Conditions tab with nothing to say yet.
 */
export const DEFAULT_QUERY_EDN = "[:find ?id :where [?n :node/id ?id]]";
