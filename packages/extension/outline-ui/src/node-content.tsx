import type { ReactElement } from "react";
import type { ViewKey } from "@kb/views";
import {
  browserHost,
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
  type OutlineNode,
  rowText,
  shownNodeId,
  useNodeTextBinding,
} from "@kb/ui-sdk";
import { useRowIngest } from "./ingest";
import { RowView } from "./row-view";

/** The text host's `display`: the row's text, placed by the row view `view`. */
function drawnAs(view: ViewKey<unknown>, nodeId: string, markdown: string) {
  return (text: ReactElement) => (
    <RowView view={view} nodeId={nodeId} markdown={markdown} text={text} />
  );
}

/**
 * Outline surface binding of the shared node text host.
 *
 * It owns the row's text channel, so no surface can wire it differently: the
 * text shown is `rowText`, and every write — typing, `[[` completion, what a
 * paste or a drop makes (`useRowIngest`) — goes to `shownNodeId`, the node
 * that text belongs to. For an
 * ordinary row that is the row itself; for a contextual reference it is the
 * target, which is what makes a reference edit the original in place. The
 * tag chips are the shown node's too (the surface passes `shownNode(…).tags`),
 * so removing one removes it from the node it is drawn on. Where the shown
 * node's tag names a row view (`useRowView`), the text is drawn inside it
 * while no one edits the row.
 */
export function NodeContent({
  node,
  ...props
}: Omit<
  NodeTextHostProps,
  keyof NodeTextHostBinding | "nodeId" | "content" | "onChange" | "ingest" | "onRemoveTag"
> & {
  /** The row's node, as the surface renders it (a projection may pass its own map). */
  node: OutlineNode;
  /** The view the shown node's row is drawn as, if its tag names one this page draws. */
  rowView?: ViewKey<unknown> | null;
}) {
  const { rowView, ...hostProps } = props;
  const binding = useNodeTextBinding(props.instanceKey);
  const content = rowText(node, binding.schema);
  const textNodeId = shownNodeId(node);
  const ingest = useRowIngest(textNodeId, content);
  return (
    <NodeTextHost
      {...hostProps}
      {...binding}
      nodeId={node.id}
      content={content}
      display={
        rowView === undefined || rowView === null
          ? undefined
          : drawnAs(rowView, textNodeId, content)
      }
      onChange={(next) => {
        if (next !== content) void browserHost().writes.updateNodeContent(textNodeId, next);
      }}
      ingest={ingest}
      onRemoveTag={(tagId) => {
        void browserHost().writes.removeTag(textNodeId, tagId);
      }}
    />
  );
}
