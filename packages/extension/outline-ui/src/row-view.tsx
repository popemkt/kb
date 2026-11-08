/**
 * A row drawn as the view its tag names (DESIGN-UI.md → Row views): the
 * view at placement `row`, handed the row it draws (`RowSubject`), in
 * place of the row's text while no one edits it. The text host still owns
 * the text: the view places the text the host drew, so pressing it edits
 * the row there, and an edit is the row's own, caret, history and keys.
 * Where the view cannot draw (its params do not decode, its owner is gone,
 * it is still loading), the row is its text.
 */
import { useMemo, type ReactElement } from "react";
import { Result } from "effect";
import type { NodeId } from "@kb/model";
import { ignoreReport, paramsFromProps, type ViewKey } from "@kb/views";
import { ViewSlot, type RowSubject } from "@kb/ui-sdk";

export function RowView({
  view,
  nodeId,
  markdown,
  text,
}: {
  readonly view: ViewKey<unknown>;
  /** The node the row shows. */
  readonly nodeId: NodeId;
  readonly markdown: string;
  /** The row's text, as the text host draws it. */
  readonly text: ReactElement;
}) {
  const params = useMemo(() => paramsFromProps(view, {}, nodeId, ignoreReport), [view, nodeId]);
  const row = useMemo((): RowSubject => ({ id: nodeId, markdown, text }), [nodeId, markdown, text]);
  if (Result.isFailure(params)) return text;
  return (
    // Its own block formatting context, so it sits beside the row's tag
    // chips (a float) rather than running under them.
    <div className="flow-root min-w-0" data-row-view={view.id}>
      <ViewSlot
        view={view}
        params={params.success}
        placement="row"
        subject={nodeId}
        row={row}
        fallback={text}
        pending={text}
      />
    </div>
  );
}
