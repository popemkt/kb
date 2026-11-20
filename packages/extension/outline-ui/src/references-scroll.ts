import { useCallback } from "react";
import { usePane } from "@kb/ui-sdk";

/** A one-shot request in the pane that opened the node, consumed by its References section. */
let pending: { pane: string; nodeId: string } | null = null;
const requests = new EventTarget();

export function requestReferencesScroll(pane: string, nodeId: string): void {
  pending = { pane, nodeId };
  requests.dispatchEvent(new Event("references"));
}

export function useReferencesScroll(nodeId: string) {
  const pane = usePane();
  return useCallback(
    (section: HTMLElement | null) => {
      if (section === null) return undefined;
      const scroll = () => {
        if (pending?.pane !== pane || pending.nodeId !== nodeId) return;
        pending = null;
        requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
      };
      scroll();
      requests.addEventListener("references", scroll);
      return () => requests.removeEventListener("references", scroll);
    },
    [nodeId, pane],
  );
}
