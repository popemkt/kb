/**
 * What a surface that shows "nodes as a node opens" draws: the store's
 * default view type, for no node (`resolveDefaultViewType`), so the surface
 * names no view itself. The page's home (`HomeView`) and an ontology's scope
 * both show it. Where the store names a default this page holds no key for,
 * the resolver reads the nodes instead (`NodeReadView`, core's), so no
 * family is one the surface needs.
 */
import { useMemo } from "react";
import { Result } from "effect";
import { paramsFrom, resolveDefaultViewType } from "@kb/views";
import { logWarn, ViewNotLoaded, ViewSlot } from "@kb/ui-sdk";
import { usePageCatalog } from "@/lib/view-catalog";

/** A node as the resolver reads it: its props, and its text when it names a view. */
type Lookup = Parameters<typeof resolveDefaultViewType>[2];

export function DefaultViewSlot({
  subject,
  lookup,
  warnAs,
}: {
  /** What the slot is shown for: the ontology a scope is of, or the node the page stands at. */
  readonly subject: string;
  /** The graph the resolver reads views from: the whole graph, whatever the scope. */
  readonly lookup: Lookup;
  /** Where a warning is logged from (`[kb/<warnAs>]`). */
  readonly warnAs: string;
}) {
  const catalog = usePageCatalog();
  const target = useMemo(() => {
    const resolved = resolveDefaultViewType(subject, catalog, lookup, (warning) =>
      logWarn(`[kb/${warnAs}] ${subject}: ${warning}`),
    );
    if (Result.isFailure(resolved) || resolved.success.key === null) return null;
    const { key, input } = resolved.success;
    const params = paramsFrom(key, input);
    return Result.isSuccess(params) ? { key, params: params.success } : null;
  }, [subject, catalog, lookup, warnAs]);
  if (target === null) return <ViewNotLoaded label="Default view" placement="page" />;
  return (
    <ViewSlot
      view={target.key}
      params={target.params}
      placement="page"
      subject={subject}
      fallback={<ViewNotLoaded label={target.key.label} placement="page" />}
    />
  );
}
