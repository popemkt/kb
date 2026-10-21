/**
 * Query nodes in the UI: the definition a new one starts with. What a query
 * node is (its field, its EDN and limit) is `@kb/model`'s `query-node.ts`,
 * read the same way by the server; its rows are the replica's answer
 * (`useQueryRows`), and the ids they name are the kit's (`resultNodeIds`).
 */

/** Default definition for palette-minted query nodes. */
export const DEFAULT_QUERY_EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
