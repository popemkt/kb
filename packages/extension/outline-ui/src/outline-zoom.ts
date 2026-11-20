/**
 * Zooming from a row, the step every zoom key runs: in, onto the page of the
 * node the row shows, as its bullet opens one.
 */
import { shownNodeId } from "@kb/ui-sdk";
import { outlineNodes } from "./outline.store";
import { openFromRow } from "./outline-hosts";

/** Open the page of the node the row shows — a reference's original — as its outline opens one. */
export function zoomIntoRow(nodeId: string, instanceKey: string): void {
  const node = outlineNodes().get(nodeId);
  openFromRow(instanceKey, node ? shownNodeId(node) : nodeId);
}
