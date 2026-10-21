import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode, KbLinkMode } from "@kb/canvas";
import { removeCanvasEdge, upsertCanvasEdge } from "@kb/canvas";
import type { useCanvasDoc } from "./use-canvas-doc";
import { planEdgeRelink, type EdgeRelink, type EdgeRelinkContext } from "./canvas-edge-link";
import { type CanvasSelection, EMPTY_SELECTION } from "./canvas-selection";
import { toast, type EdnRunner, type QueryAnswers } from "@kb/ui-sdk";

interface CanvasEdgeActionContext {
  selectedEdge: CanvasEdge | null;
  byId: Map<string, CanvasNode>;
  docRef: RefObject<CanvasDoc>;
  nodes: EdgeRelinkContext["nodes"];
  /** The page's query answers, which the plan's field check reads; none reads no target query. */
  queries: QueryAnswers | null;
  flushPersist: ReturnType<typeof useCanvasDoc>["flushPersist"];
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
}

/**
 * Apply what the planner decided: a toast, nothing, or one atomic write. The
 * plan reads the answers to the field's target query as of the click, so a
 * write is never accepted or refused on an answer from before it.
 */
async function relinkEdge(context: CanvasEdgeActionContext, change: EdgeRelink) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const bindingId = ulid();
  const plan = (run: EdnRunner | null) =>
    planEdgeRelink(edge, change, { byId: context.byId, nodes: context.nodes, run, bindingId });
  const decided = context.queries === null ? plan(null) : await context.queries.settle(plan);
  if (decided.kind === "reject") {
    toast(decided.reason);
    return;
  }
  if (decided.kind === "none") return;
  await context.flushPersist(upsertCanvasEdge(context.docRef.current, decided.edge), decided.props);
}

async function deleteEdge(context: CanvasEdgeActionContext) {
  const edge = context.selectedEdge;
  if (!edge) return;
  const link = edge.kbLink;
  const next = removeCanvasEdge(context.docRef.current, edge.id);
  const offerUnset =
    link?.mode === "native" &&
    !!link.fieldId &&
    window.confirm("Also remove the bound prop from the source node?");
  if (offerUnset) {
    await context.flushPersist(next, {
      propTargetId: link.sourceNodeId,
      unsetProps: [
        {
          field: link.fieldId,
          value: { t: "ref", v: link.targetNodeId },
        },
      ],
    });
  } else {
    await context.flushPersist(next);
  }
  context.setSelection(EMPTY_SELECTION);
  context.setInspectorAnchor(null);
}

export function createCanvasEdgeActions(context: CanvasEdgeActionContext) {
  return {
    onDeleteEdge: () => deleteEdge(context),
    onFieldChange: (fieldId: string) => relinkEdge(context, { kind: "field", fieldId }),
    onModeChange: (mode: KbLinkMode) => relinkEdge(context, { kind: "mode", mode }),
  };
}
