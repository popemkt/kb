import { useContext, useLayoutEffect, useMemo, useRef } from "react";
import { CaretRightIcon, HouseIcon } from "@phosphor-icons/react";
import {
  browserHost,
  cn,
  OpenNodeContext,
  usePageGraph,
  useSchema,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { CRUMB, type Crumb, crumbsTo } from "./crumbs";
import { FoldedCrumbs } from "./folded-crumbs";
import { useOutlineStore, useOutlineNodes } from "./outline.store";

const SEPARATOR = (
  <CaretRightIcon size={10} weight="bold" className="shrink-0 text-foreground/40" aria-hidden />
);

/**
 * Where the outline is: home, then each node down to its root. The zoomed
 * outline's crumbs zoom; a rooted outline's open the crumb in its pane
 * (`OpenNodeContext`).
 *
 * The row never scrolls sideways (DESIGN-UI.md → Node pages): Home and the
 * node the page stands at always show, and the crumbs between fold into
 * "…", the oldest first, as many as the row's width needs, before the
 * current node's name is cut with an ellipsis. "…" names what it holds on
 * hover and opens it as a menu on click or from the keyboard.
 */
export function Breadcrumbs({ root }: { readonly root?: string | undefined }) {
  const zoomRoot = usePageGraph((s) => s.rootNodeId);
  const rootNodeId = root ?? zoomRoot;
  // getBreadcrumbs builds a fresh array; selecting it directly makes the
  // uSES snapshot unstable (infinite rerender). Derive it with useMemo.
  const nodes = useOutlineNodes();
  const schema = useSchema();
  const crumbs = useMemo(
    () =>
      root === undefined
        ? useOutlineStore.getState().getBreadcrumbs()
        : crumbsTo(root, WORKSPACE_ROOT_ID, nodes, schema),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- getBreadcrumbs is read off getState(), so its real inputs are named here by hand
    [nodes, schema, rootNodeId, root],
  );
  const open = useContext(OpenNodeContext);
  const zoomHomeInStore = browserHost().zoomHome;
  const zoomToInStore = browserHost().zoomTo;
  const zoomTo = open ?? zoomToInStore;
  const zoomHome = open === null ? zoomHomeInStore : () => open(WORKSPACE_ROOT_ID);
  const isAtRoot = rootNodeId === WORKSPACE_ROOT_ID;

  const last = crumbs.at(-1);
  const current = last !== undefined && last.id === rootNodeId ? last : null;
  const between = current === null ? crumbs : crumbs.slice(0, -1);
  const nav = useRef<HTMLElement>(null);
  useCrumbFolding(nav, crumbs);

  return (
    <nav
      ref={nav}
      className="breadcrumbs flex h-11 min-w-0 items-center gap-1 overflow-hidden px-1 text-ui"
      aria-label="Breadcrumb"
    >
      <button
        type="button"
        className={cn(CRUMB, "flex shrink-0 items-center gap-1", isAtRoot && "text-foreground")}
        onClick={() => zoomHome()}
        aria-current={isAtRoot ? "page" : undefined}
      >
        <HouseIcon size={14} weight="bold" />
        <span>Home</span>
      </button>

      {between.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1" data-crumb-fold="">
          {SEPARATOR}
          <FoldedCrumbs
            folded={() => between.filter((_, at) => foldedAt(nav.current, at))}
            onOpen={zoomTo}
          />
        </div>
      ) : null}

      {between.map((item) => (
        <div key={item.id} className="flex shrink-0 items-center gap-1" data-crumb-between="">
          {SEPARATOR}
          <button
            type="button"
            title={item.text}
            className={cn(CRUMB, "max-w-[12rem] truncate")}
            onClick={() => zoomTo(item.id)}
          >
            {item.text}
          </button>
        </div>
      ))}

      {current !== null ? (
        <div className="flex min-w-0 items-center gap-1">
          {SEPARATOR}
          <button
            type="button"
            title={current.text}
            className={cn(CRUMB, "min-w-0 truncate font-medium text-foreground")}
            onClick={() => zoomTo(current.id)}
            aria-current="page"
            data-crumb-current=""
          >
            {current.text}
          </button>
        </div>
      ) : null}
    </nav>
  );
}

/** Whether the `at`th crumb between Home and the current node is folded in `row`. */
function foldedAt(row: HTMLElement | null, at: number): boolean {
  return row?.querySelectorAll<HTMLElement>("[data-crumb-between]")[at]?.hidden === true;
}

/**
 * Fold `row`'s crumbs between Home and the current node, the oldest first,
 * while the row would scroll or the current node's name is cut and a crumb
 * is left to fold; "…" shows while any is folded. Measured and written
 * straight to the elements before the frame is painted, as the path or the
 * room changes (the row sits in a box fitted to it, the page head's halo,
 * so the room it has is the outline column's): nothing renders again.
 */
function useCrumbFolding(nav: React.RefObject<HTMLElement | null>, crumbs: readonly Crumb[]) {
  useLayoutEffect(() => {
    const row = nav.current;
    // A path of one node has nothing between Home and it to fold.
    if (row === null || crumbs.length < 2) return undefined;
    const fold = (): void => {
      const between = [...row.querySelectorAll<HTMLElement>("[data-crumb-between]")];
      const ellipsis = row.querySelector<HTMLElement>("[data-crumb-fold]");
      const current = row.querySelector<HTMLElement>("[data-crumb-current]");
      const over = () =>
        row.scrollWidth > row.clientWidth ||
        (current !== null && current.scrollWidth > current.clientWidth);
      for (const crumb of between) crumb.hidden = false;
      if (ellipsis !== null) ellipsis.hidden = true;
      for (const crumb of between) {
        if (!over()) break;
        crumb.hidden = true;
        if (ellipsis !== null) ellipsis.hidden = false;
      }
    };
    fold();
    const room = row.closest<HTMLElement>(".outline-editor") ?? row;
    const observer = new ResizeObserver(fold);
    observer.observe(room);
    return () => observer.disconnect();
  }, [nav, crumbs]);
}
