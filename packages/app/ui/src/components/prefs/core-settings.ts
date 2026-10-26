import { extensionNodeId } from "@kb/model";
import { type PropValue, useFieldEditor, useGraphRead } from "@kb/ui-sdk";
import { createElement, type ReactNode } from "react";

const CORE_NODE = extensionNodeId("core");
const NONE: PropValue[] = [];

/**
 * Core's settings as Preferences draws them: each a field of core's node
 * (`sys.extension.core`), drawn with the page's field editor as any field
 * is drawn, under its label. Null until core's node has arrived.
 */
export function useCoreSettings(): ((fieldId: string, label: string) => ReactNode) | null {
  const graph = useGraphRead();
  const Field = useFieldEditor();
  const core = graph.outline.get(CORE_NODE);
  if (core === undefined) return null;
  return (fieldId, label) =>
    createElement(Field, {
      nodeId: CORE_NODE,
      fieldId,
      label,
      values: core.props[fieldId] ?? NONE,
      context: graph,
      depth: -1,
    });
}
