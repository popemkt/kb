import { memo } from "react";
import { useOpenNode, usePane } from "@kb/ui-sdk";
import { useBacklinkCount } from "./backlink-counts";
import { requestReferencesScroll } from "./references-scroll";

/** Subscribes separately so new mention edges do not render the outline row again. */
export const RowReferenceCounter = memo(function RowReferenceCounter({
  nodeId,
}: {
  readonly nodeId: string;
}) {
  const open = useOpenNode();
  const pane = usePane();
  const count = useBacklinkCount(nodeId);
  if (count === 0) return null;

  const label = `Open References (${count})`;
  return (
    <button
      type="button"
      className="ml-1.5 mr-1 shrink-0 rounded-xs px-1.5 py-0.5 text-caption font-medium tabular-nums text-foreground/60 hover:bg-foreground/5 hover:text-foreground transition-colors duration-100 cursor-pointer"
      data-reference-counter={nodeId}
      title={label}
      aria-label={label}
      onClick={() => {
        requestReferencesScroll(pane, nodeId);
        open(nodeId);
      }}
    >
      {count}
    </button>
  );
});
