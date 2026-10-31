/**
 * A row's handler as the outline draws it (DESIGN-UI.md → Opening a node →
 * a row's handler): `nodeHandlerOf` over the page's views, with the view's
 * label and its picker's icon, which the row's "Open in …" shows.
 */
import { createElement, useMemo, type ReactNode } from "react";
import {
  nodeHandlerOf,
  useContributions,
  useGraphRead,
  ViewPoint,
  type NodeHandler,
  type OutlineNode,
} from "@kb/ui-sdk";

/** A row's handler (`nodeHandlerOf`), with its label and its icon drawn. */
export interface RowHandler extends NodeHandler {
  readonly label: string;
  readonly icon: ReactNode;
}

/** The handler of `node`'s row, or null when no tag of it names a view this page draws. */
export function useRowHandler(node: OutlineNode | undefined): RowHandler | null {
  const { schema } = useGraphRead();
  const views = useContributions(ViewPoint);
  return useMemo(() => {
    const handler = nodeHandlerOf(node, views, (id) => schema.get(id));
    if (handler === null) return null;
    const Icon = handler.picker?.icon;
    return {
      ...handler,
      label: handler.key.label,
      icon:
        Icon === undefined
          ? null
          : createElement(Icon, { size: 12, weight: handler.picker?.iconWeight }),
    };
  }, [node, schema, views]);
}
