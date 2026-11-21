import { pageTitleInstanceKey } from "@kb/ui-sdk";
import { useOutlineStore } from "./outline.store";

/**
 * The row the keyboard goes on to from instance `instanceKey` of node
 * `nodeId`, drawn by outline host `host`: the next row of its walk. A
 * page's title is drawn by the page head, not by the walk of its rows, and
 * stands before them, so after it comes the page's first row. Null when
 * nothing follows.
 */
export function rowAfter(instanceKey: string, nodeId: string, host: string) {
  const s = useOutlineStore.getState();
  if (instanceKey === pageTitleInstanceKey(nodeId, host))
    return s.getVisibleInstances(host)[0] ?? null;
  return s.getNextVisibleInstance(instanceKey);
}
