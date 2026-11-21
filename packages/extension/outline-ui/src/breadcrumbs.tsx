import { useContext, useMemo } from "react";
import { CaretRightIcon, HouseIcon } from "@phosphor-icons/react";
import {
  browserHost,
  cn,
  OpenNodeContext,
  usePageGraph,
  useSchema,
  useZoom,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { crumbsTo } from "./crumbs";
import { useOutlineNodes } from "./outline.store";

/**
 * Where the outline is: home, then each node down to its root. The zoomed
 * outline's crumbs zoom; a rooted outline's open the crumb in its pane
 * (`OpenNodeContext`).
 */
export function Breadcrumbs({ root }: { readonly root?: string | undefined }) {
  const zoomRoot = useZoom();
  const homeRoot = usePageGraph((s) => s.homeRootId);
  const rootNodeId = root ?? zoomRoot;
  // A zoomed outline's crumbs run from the scope's home, a rooted one's from the workspace.
  const home = root === undefined ? homeRoot : WORKSPACE_ROOT_ID;
  const nodes = useOutlineNodes();
  const schema = useSchema();
  const crumbs = useMemo(
    () => crumbsTo(rootNodeId, home, nodes, schema),
    [nodes, schema, rootNodeId, home],
  );
  const open = useContext(OpenNodeContext);
  const zoomHomeInStore = browserHost().zoomHome;
  const zoomToInStore = browserHost().zoomTo;
  const zoomTo = open ?? zoomToInStore;
  const zoomHome = open === null ? zoomHomeInStore : () => open(WORKSPACE_ROOT_ID);
  const isAtRoot = rootNodeId === WORKSPACE_ROOT_ID;

  return (
    <nav className="breadcrumbs flex h-11 items-center gap-1 px-1 text-ui" aria-label="Breadcrumb">
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded-sm px-1.5 py-0.5",
          "text-foreground/65 hover:text-foreground hover:bg-foreground/5",
          "transition-colors duration-100",
          isAtRoot && "text-foreground",
        )}
        onClick={() => zoomHome()}
        aria-current={isAtRoot ? "page" : undefined}
      >
        <HouseIcon size={14} weight="bold" />
        <span>Home</span>
      </button>

      {crumbs.map((item) => (
        <div key={item.id} className="flex items-center gap-1">
          <CaretRightIcon size={10} weight="bold" className="text-foreground/40" />
          <button
            type="button"
            title={item.text}
            className={cn(
              "max-w-[12rem] truncate rounded-sm px-1.5 py-0.5",
              "text-foreground/65 hover:text-foreground hover:bg-foreground/5",
              "transition-colors duration-100",
              item.id === rootNodeId && "text-foreground font-medium",
            )}
            onClick={() => zoomTo(item.id)}
            aria-current={item.id === rootNodeId ? "page" : undefined}
          >
            {item.text}
          </button>
        </div>
      ))}
    </nav>
  );
}
