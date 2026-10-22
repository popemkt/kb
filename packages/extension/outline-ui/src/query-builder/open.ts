/**
 * Whether a query node's builder is open: the query is tucked away behind
 * its node's view control, as Tana keeps a search node's query behind "Edit
 * query", and the results are what the node shows.
 *
 * - **Default:** open while the query says nothing yet — no EDN, or no
 *   conditions (a query just made, `DEFAULT_QUERY_EDN`) — so there is
 *   somewhere to start writing it; closed once it says something.
 * - **A person's choice wins** for the rest of the session: opening or
 *   closing it is the outline's screen state (`queryBuilders`), never a
 *   write to the graph.
 * - **A write from the builder keeps it open** (`keepOpen`): the first
 *   condition makes the query say something, and the builder it was typed
 *   into must not fold away under the caret.
 */
import { useOutlineStore } from "../outline.store";
import { readQuery } from "./model";

/** The builder's element id, which the control that opens it points at (`aria-controls`). */
export const queryBuilderId = (nodeId: string): string => `query-builder-${nodeId}`;

/** Whether `edn` says nothing yet: empty, or a query with no conditions. */
function saysNothing(edn: string): boolean {
  if (edn.trim() === "") return true;
  const reading = readQuery(edn);
  return reading.lifted && reading.conditions.length === 0;
}

/** Open as chosen, else by default; never on a node that is no query (`edn` null). */
function isOpen(chosen: boolean | undefined, edn: string | null): boolean {
  if (edn === null) return false;
  return chosen ?? saysNothing(edn);
}

/** Whether the builder of query node `nodeId`, whose query is `edn`, is open. */
export function useQueryBuilderOpen(nodeId: string, edn: string | null): boolean {
  return isOpen(
    useOutlineStore((s) => s.queryBuilders[nodeId]?.open),
    edn,
  );
}

/** `useQueryBuilderOpen`, read once, outside a render. */
export function queryBuilderOpen(nodeId: string, edn: string | null): boolean {
  return isOpen(useOutlineStore.getState().queryBuilders[nodeId]?.open, edn);
}

/** Open or close the builder of query node `nodeId`. */
export function setQueryBuilderOpen(nodeId: string, open: boolean): void {
  useOutlineStore.getState().setQueryBuilder(nodeId, { open });
}

/** Pin the builder of `nodeId` open: its query is being written from it. */
export function keepOpen(nodeId: string): void {
  if (useOutlineStore.getState().queryBuilders[nodeId]?.open !== true) {
    setQueryBuilderOpen(nodeId, true);
  }
}
