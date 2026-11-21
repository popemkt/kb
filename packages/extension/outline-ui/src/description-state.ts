/**
 * Which drawn node's description a gesture opened (DESIGN-UI.md → Outline
 * editor, "A node's description"): ⌘K's Add or Edit description, or its
 * key, names the row instance (or the page's title) whose description slot
 * opens for editing. The page's screen state, never the graph's: the
 * description itself is the node's `sys.f.description` value.
 */
import { descriptionOf, SYSTEM_IDS } from "@kb/model";
import { pageTitleInstanceKey, useFieldWrite, useGraphRead } from "@kb/ui-sdk";
import { create } from "zustand";
import { useOutlineStore } from "./outline.store";

/**
 * The instance whose description slot is open for a gesture, null when none
 * is, and which gesture it was, so asking again where one is open opens the
 * editor again. The slot stays drawn until the keyboard leaves it.
 */
export const useDescribing = create<{ readonly at: string | null; readonly gesture: number }>(
  () => ({ at: null, gesture: 0 }),
);

/**
 * Open node `nodeId`'s description for editing where the command found it:
 * the row selected or edited on it, else the page's title.
 */
export function describe(nodeId: string): void {
  const s = useOutlineStore.getState();
  const at =
    s.selectedNodeId === nodeId && s.selectedInstanceKey !== null
      ? s.selectedInstanceKey
      : s.activeNodeId === nodeId && s.activeInstanceKey !== null
        ? s.activeInstanceKey
        : pageTitleInstanceKey(nodeId);
  useDescribing.setState((was) => ({ at, gesture: was.gesture + 1 }));
}

/**
 * The gesture at `instanceKey` is over: the slot it opened closes, or stays
 * only while it holds a description. A gesture since opened elsewhere stays.
 */
export const doneDescribing = (instanceKey: string): void => {
  useDescribing.setState((was) => (was.at === instanceKey ? { at: null } : was));
};

/**
 * Whether node `nodeId`'s description line is drawn at `instanceKey`: it
 * has a description, or a gesture opened its slot there and it may be
 * written. A place that frames the line (the page's head) asks this, so it
 * draws no empty line for a node without one.
 */
export function useDescriptionShown(nodeId: string, instanceKey: string): boolean {
  const { schema } = useGraphRead();
  const asked = useDescribing((s) => s.at === instanceKey);
  const { readOnly } = useFieldWrite(nodeId, SYSTEM_IDS.descriptionField, schema);
  return descriptionOf(schema.get(nodeId)) !== null || (asked && !readOnly);
}
