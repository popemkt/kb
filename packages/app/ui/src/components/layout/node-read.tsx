import { useMemo } from "react";
import type { NodeReadParams } from "@kb/views";
import {
  cn,
  MdView,
  NotFound,
  nodePath,
  rowText,
  schemaOf,
  shownNodesOf,
  textOr,
  usePane,
  WORKSPACE_ROOT_ID,
  type ViewProps,
} from "@kb/ui-sdk";
import { readRows } from "@/lib/read-rows";
import { useFollow } from "@/stores/follow";
import { useGraphStore } from "@/stores/graph.store";
import { useRefInk } from "@/stores/ref-ink";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** A row's indent by its depth below the root, one step per level the view lays out. */
const INDENT: readonly string[] = ["ps-0", "ps-5", "ps-10"];

/**
 * A node read, not edited (`NodeReadView`): its text, then its descendants,
 * each a link that opens it. Rooted at `root` (a node opened in a pane), a
 * row opens in that pane; at the page's zoom (the home), a row zooms. It is
 * what a node opens in where the view it would open in is not loaded
 * (`insteadOf`), so the page is never without a way to read the graph.
 */
// GAP [[01M5MWXM43Y12KDBM4JG7X1VRX]] the read view shows no fields: no core field value draws them
export function NodeReadSurface({ params }: ViewProps<NodeReadParams>) {
  const zoom = useGraphStore((s) => s.rootNodeId);
  const wireNodes = useGraphStore((s) => s.wireNodes);
  const ontologyId = useGraphStore((s) => s.ontologyId);
  const ontologyMembers = useGraphStore((s) => s.ontologyMembers);
  const nodes = useMemo(
    () => shownNodesOf({ wireNodes, ontologyId, ontologyMembers }),
    [wireNodes, ontologyId, ontologyMembers],
  );
  const pane = usePane();
  const follow = useFollow();
  const ink = useRefInk();
  const rootId = params.root ?? zoom;
  const root = nodes.get(rootId);
  const schema = useGraphStore(schemaOf);
  const { rows, more } = useMemo(() => readRows(nodes, schema, rootId), [nodes, schema, rootId]);
  if (root === undefined)
    return <NotFound what="Node" id={rootId} back={{ label: "Home", path: "/" }} />;
  const open = (id: string) =>
    params.root === undefined
      ? useGraphStore.getState().zoomTo(id)
      : useWorkspaceStore.getState().navigatePane(pane, nodePath(id));
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" data-node-read={rootId}>
      {params.insteadOf === undefined ? null : (
        <p className="mb-4 text-meta text-foreground/45" data-read-instead-of={params.insteadOf}>
          {params.insteadOf} is not loaded here, so this is shown read-only.
        </p>
      )}
      {rootId === WORKSPACE_ROOT_ID ? null : (
        <h1 className="text-title font-medium text-foreground/85">
          <MdView text={textOr(rowText(root, schema), "Untitled")} onFollow={follow} ink={ink} />
        </h1>
      )}
      {rows.length === 0 ? (
        <p className="mt-2 text-meta text-foreground/40">Nothing under this node.</p>
      ) : (
        <ul className="mt-3 space-y-0.5 text-ui">
          {rows.map((row) => (
            <li
              key={row.id}
              data-read-row={row.id}
              className={cn("flex items-baseline gap-2", INDENT[row.depth - 1] ?? INDENT[2])}
            >
              <span aria-hidden className="text-caption text-foreground/30">
                •
              </span>
              <button
                type="button"
                className="min-w-0 text-left text-foreground/80 hover:text-foreground"
                onClick={() => open(row.opens)}
              >
                <MdView text={textOr(row.text, "Untitled")} onFollow={follow} ink={ink} />
              </button>
              {row.hidden === 0 ? null : (
                <span className="text-label text-foreground/30">+{row.hidden}</span>
              )}
            </li>
          ))}
          {more === 0 ? null : (
            <li className="ps-5 text-meta text-foreground/40" data-read-more={more}>
              {more} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
