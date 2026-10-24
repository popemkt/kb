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
  in3d,
  world,
  pages,
  onFollow,
  onItemChange,
  refFields,
  onModeChange,
  onFieldChange,
  onDelete,
  onEdgeChange,
}: {
  /** A canvas is presented: the panel stands aside for the slides. */
  readonly presenting: boolean;
  readonly item: CanvasNode | null;
  readonly edge: CanvasEdge | null;
  readonly in3d: ItemInspectorProps["in3d"];
  readonly world: ItemInspectorProps["world"];
  readonly pages: ItemInspectorProps["pages"];
  readonly onFollow: ItemInspectorProps["onFollow"];
  readonly onItemChange: ItemInspectorProps["onChange"];
  readonly refFields: EdgeInspectorProps["refFields"];
  readonly onModeChange: EdgeInspectorProps["onModeChange"];
  readonly onFieldChange: EdgeInspectorProps["onFieldChange"];
  readonly onDelete: EdgeInspectorProps["onDelete"];
  readonly onEdgeChange: EdgeInspectorProps["onChange"];
}) {
  if (presenting) return null;
  if (item !== null) {
    return (
      <ItemInspector
        item={item}
        in3d={in3d}
        world={world}
        pages={pages}
        onFollow={onFollow}
        onChange={onItemChange}
      />
    );
  }
  if (edge !== null) {
    return (
      <EdgeInspector
        edge={edge}
        refFields={refFields}
        onModeChange={onModeChange}
        onFieldChange={onFieldChange}
        onDelete={onDelete}
        onChange={onEdgeChange}
      />
    );
  }
  return null;
}
