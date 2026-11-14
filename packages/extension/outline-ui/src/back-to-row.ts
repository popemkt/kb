import { useOutlineStore } from "./outline.store";

/**
 * Back from a control drawn for a row (its box, a field value, the
 * hidden-fields fold) to the row: selected, and holding focus, so the
 * selection's keys reach it rather than the control's (DESIGN-UI.md → Two
 * keymaps, one row). The row is its block's tree item, the first in the
 * block, ahead of its fields and children.
 */
export function backToRow(from: Element | null, nodeId: string, instanceKey: string): void {
  from
    ?.closest("[data-node-block='true']")
    ?.querySelector<HTMLElement>("[role='treeitem']")
    ?.focus({ preventScroll: true });
  useOutlineStore.getState().selectNode(nodeId, instanceKey);
}
