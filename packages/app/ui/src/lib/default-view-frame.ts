/**
 * How a page that shows the store's default view type is framed: see
 * {@link defaultViewFrame}. Apart from `default-view.tsx` (components only).
 */
import { Result } from "effect";
import { paramsFrom, resolveDefaultViewType } from "@kb/views";
import { pageFrameOf, pointReader, RoutePoint, ViewPoint, type ResolvedRoute } from "@kb/ui-sdk";
import { pageCatalog } from "@/lib/view-catalog";

/** A node as the resolver reads it: its props, and its text when it names a view. */
type Lookup = Parameters<typeof resolveDefaultViewType>[2];

const readRoutes = pointReader(RoutePoint);
const readViews = pointReader(ViewPoint);

/**
 * How the page is framed where it shows the default view type for no node,
 * as that view says a page it is the whole of is framed (`View.frame`, or the
 * route that opens it): a route's frame is read as the path resolves, so
 * this reads the page as it stands. Where the view cannot be shown, the
 * placeholder is framed as a page no route matched is: scrolling.
 */
export function defaultViewFrame(subject: string, lookup: Lookup): ResolvedRoute["frame"] {
  const resolved = resolveDefaultViewType(subject, pageCatalog(), lookup, () => {});
  if (Result.isFailure(resolved) || resolved.success.key === null) return "scroll";
  const { key, input } = resolved.success;
  const params = paramsFrom(key, input);
  if (Result.isFailure(params)) return "scroll";
  return pageFrameOf(readRoutes(), readViews(), key, params.success) ?? "fixed";
}
