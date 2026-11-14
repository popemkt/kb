import { useEffect } from "react";
import { browserHost, currentKeymap, keyChordEvent, shownNode } from "@kb/ui-sdk";
import { isEditableTarget, mapSelectionKey } from "./selection-keymap";
import { SELECTION_CONTEXT_ID } from "@kb/outline";
import { useOutlineStore, outlineNodes } from "./outline.store";
import { applySelectionAction } from "./selection-actions";
import { fieldSlotCount } from "./value-slot-nav";

/** Window-level selection-mode keymap while a node is selected (not editing). */
export function useSelectionKeymap(): void {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);

  useEffect(() => {
    if (selectedNodeId === null || selectedInstanceKey === null || activeNodeId !== null)
      return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // A key the focused element already handled (the selected row's own
      // Enter/Space) is not a selection key a second time.
      if (e.defaultPrevented) return;

      const store = useOutlineStore.getState();
      const action = mapSelectionKey(
        keyChordEvent(e),
        {
          selectedNodeId: store.selectedNodeId,
          selectedInstanceKey: store.selectedInstanceKey,
          activeNodeId: store.activeNodeId,
          getPreviousVisibleInstance: store.getPreviousVisibleInstance,
          getNextVisibleInstance: store.getNextVisibleInstance,
          laneOf: store.laneOf,
          fieldSlotsOf: fieldSlotCount,
          getNode: (id) => {
            const n = outlineNodes().get(id);
            if (!n) return undefined;
            // Children are the shown node's; collapse and place are the row's.
            return {
              collapsed: n.collapsed,
              childIds: shownNode(n, browserHost().schema()).children,
              parentId: n.parentId,
            };
          },
        },
        currentKeymap(SELECTION_CONTEXT_ID),
      );
      if (!action) return;
      e.preventDefault();
      applySelectionAction(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, selectedInstanceKey, activeNodeId]);
}
