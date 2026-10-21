/**
 * Query nodes (DESIGN-REFINE §2 W4): an ordinary node carrying its EDN
 * definition in `sys.f.query`, with an optional `sys.f.query.limit` cap.
 *
 * **The field is the kind** (DESIGN.md → Kinds, roles and options). A `#query`
 * supertag used to mark these rows as well, which meant one distinction had two
 * carriers and the reader picked the wrong one: it matched any tag whose *name*
 * was "query", so a user tag called `query` turned its rows into live
 * subscriptions, and it read `node.tags` — a display array that drops kind refs
 * — as though it were membership. Strip the field and a query node is a plain
 * node, so the field is what a query node is.
 *
 * Pure modeling, read by every runtime: the UI that subscribes to a query
 * node's rows and the server that renders a view of them read it one way.
 */
import { SYSTEM_IDS, type PropValue } from "./model.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

export interface QueryNodeDef {
  readonly edn: string;
  readonly limit: number | null;
}

/** Whether `props` define a query: the field is present (an empty EDN is a query being written). */
export function hasQueryDef(props: Carrier["props"] | undefined): boolean {
  return props?.[SYSTEM_IDS.queryField] !== undefined;
}

/** Whether `node` is a query node, read from its carrier. */
export function isQueryNode(node: Carrier | undefined): boolean {
  return hasQueryDef(node?.props);
}

/**
 * The EDN a query node stores, as written: its field's text, empty while a
 * query is being written; null when it is no query node.
 */
export function queryTextOf(node: Carrier | undefined): string | null {
  if (!isQueryNode(node)) return null;
  const edn = (node?.props[SYSTEM_IDS.queryField] ?? []).find(
    (v) => v.t === "str" && v.v.trim() !== "",
  );
  return edn?.t === "str" ? edn.v : "";
}

/** EDN and limit off the node's props: what it runs; null when it is no query node or holds no EDN yet. */
export function queryDefOf(node: Carrier | undefined): QueryNodeDef | null {
  const edn = queryTextOf(node)?.trim() ?? "";
  if (node === undefined || edn === "") return null;
  const limit = (node.props[SYSTEM_IDS.queryLimitField] ?? []).find((v) => v.t === "num");
  return { edn, limit: limit?.t === "num" ? limit.v : null };
}
