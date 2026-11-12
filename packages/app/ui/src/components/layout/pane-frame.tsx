import { useRef, type ReactNode } from "react";
import {
  cn,
  matchRoute,
  NotFound,
  RoutePoint,
  useContributions,
  ViewSlot,
  WorkspaceState,
  type ResolvedRoute,
} from "@kb/ui-sdk";
import { PageBackdropHost, ThemeArt } from "@kb/appearance-kit";
import { RegionScrollbar } from "./region-scrollbar";

const NOT_FOUND = <NotFound what="Page" back={{ label: "Home", path: "/" }} />;

/**
 * A pane's scroll region.
 *
 * It keeps no scrollbar gutter (index.css): its scrollbar is kb's own thumb
 * over its right edge (`RegionScrollbar`). So its content box is the pane's
 * whole width whether or not this view overflows and whatever scrollbars
 * the platform shows: a long view and a short one resolve to the same width
 * (a width that changed between them once shifted the centered column, the
 * breadcrumb with it, ~3px), and a breakout (a region-spanning backdrop, a
 * table) runs to the pane's edge, where a classic scrollbar's track would
 * have left it short (nothing inside a scroller paints under its own
 * scrollbar). Fixing it here is what keeps every downstream element free of
 * compensating offsets.
 *
 * A scrolling region leaves room after the page's end, so whatever the page
 * ends with (an outline's References, a section below them) can be
 * scrolled up off the pane's bottom edge. The room is the region's, never a
 * part's: a view drawn inside another page adds none, so it opens no gap
 * before what follows it.
 *
 * It is the page's paint root (`isolate`): what a page paints behind its
 * content, a page head's backdrop (`PageBackdrop`), stands in the region's
 * negative layer, under every box of the page and over the shell's ground,
 * and is never carried under a background an ancestor paints.
 */
function ScrollRegion({
  scroll,
  children,
}: {
  /** Canvas owns its own viewport and deliberately does not scroll. */
  readonly scroll: boolean;
  readonly children: ReactNode;
}) {
  const region = useRef<HTMLElement>(null);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <main
        ref={region}
        className={cn(
          "isolate min-h-0 flex-1",
          scroll ? "overflow-x-auto overflow-y-auto" : "overflow-hidden",
          // The room after the page's end is the region's (above).
          scroll && "pb-40",
        )}
        data-main-region={scroll ? "scroll" : "fixed"}
      >
        {children}
      </main>
      {scroll && <RegionScrollbar region={region} />}
    </div>
  );
}

/**
 * A page framed as its route says (its `frame`): in a scroll region that
 * scrolls, in one that does not (a page with its own viewport), or not at
 * all (a page that frames itself). The one place a page is framed, so a page
 * reached through a route and one a route resolves to another view
 * (`/node/<id>`, `NodeViewSurface`) are framed alike, and a pane holds
 * exactly one scroll region, never one nested in another.
 */
export function PageFrame({
  frame,
  children,
}: {
  readonly frame: ResolvedRoute["frame"];
  readonly children: ReactNode;
}) {
  return frame === "full" ? (
    children
  ) : (
    <ScrollRegion scroll={frame === "scroll"}>{children}</ScrollRegion>
  );
}

/**
 * The matched route's view, in the page slot. A plugin's page owns its own
 * boundary; the slot's only keeps a page that lacks one from taking the pane
 * down with it. A route whose view is not loaded is not found.
 */
function RouteBody({ route, subject }: { route: ResolvedRoute; subject: string | undefined }) {
  return (
    <ViewSlot
      view={route.view}
      params={route.params}
      placement="page"
      fallback={NOT_FOUND}
      pending={<WorkspaceState title={route.pendingTitle} loading />}
      {...(subject === undefined ? {} : { subject })}
    />
  );
}

/**
 * What a pane shows at `path`: the page the route table resolves it to, with
 * the route's chrome above it and, unless the page owns its own viewport, a
 * scroll region around it, and the theme's pane plane over it. A path no
 * route owns is not found.
 *
 * `subject` is what the pane's slot shows its page for where panes nest (a
 * dashboard's panes give their locations), so a layout open inside itself is
 * a repeat the slot refuses rather than a page drawn forever.
 */
export function PaneFrame({ path, subject }: { readonly path: string; readonly subject?: string }) {
  const route = matchRoute(useContributions(RoutePoint), path);
  const body = route === null ? NOT_FOUND : <RouteBody route={route} subject={subject} />;
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col" data-pane-path={path}>
      {route?.chrome}
      {/* Above the router: the backdrop outlives the page under it, drawn in whichever head declares it. */}
      <PageBackdropHost>
        <PageFrame frame={route?.frame ?? "scroll"}>{body}</PageFrame>
      </PageBackdropHost>
      {/* Over this pane: the theme's gesture for this pane's own page change,
       * keyed on its path, so moving the focus between panes plays nothing
       * (`.kb-veil`: hidden under reduced motion and with `pageWipe` off). */}
      <div className="kb-veil pointer-events-none absolute inset-0 z-40">
        <ThemeArt plane="pane" path={path} />
      </div>
    </div>
  );
}
