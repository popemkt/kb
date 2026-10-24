import type { CanvasEdge, CanvasNode } from "@kb/canvas";
import { EdgeInspector, type EdgeInspectorProps } from "./edge-inspector";
import { ItemInspector, type ItemInspectorProps } from "./item-inspector";

/**
 * The style panel of what is selected, docked (`CanvasDock`): the item
 * inspector for one item, the edge inspector for one edge, nothing for
 * none or more, nor while presenting. It follows the selection; nothing
 * opens or closes it.
 */
export function CanvasStylePanel({
  presenting,
  item,
  edge,
  ...props
}: {
  /** A canvas is presented: the panel stands aside for the slides. */
  readonly presenting: boolean;
  readonly item: CanvasNode | null;
  readonly edge: CanvasEdge | null;
} & Omit<ItemInspectorProps, "item" | "onChange"> &
  Omit<EdgeInspectorProps, "edge" | "onChange"> & {
    readonly onItemChange: ItemInspectorProps["onChange"];
    readonly onEdgeChange: EdgeInspectorProps["onChange"];
  }) {
  if (presenting) return null;
  if (item !== null) return <ItemInspector item={item} onChange={props.onItemChange} {...props} />;
  if (edge !== null) return <EdgeInspector edge={edge} onChange={props.onEdgeChange} {...props} />;
  return null;
}
