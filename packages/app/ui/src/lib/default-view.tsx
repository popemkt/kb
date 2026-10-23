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
import { logWarn, ViewNotLoaded, ViewSlot, ViewUnavailable } from "@kb/ui-sdk";
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
  const shown = useMemo(() => {
    const resolved = resolveDefaultViewType(subject, catalog, lookup, (warning) =>
      logWarn(`[kb/${warnAs}] ${subject}: ${warning}`),
    );
    if (Result.isFailure(resolved)) return { kind: "broken", why: resolved.failure } as const;
    const target = resolved.success;
    // A view this host holds no key for is named by the view's own label.
    if (target.key === null) return { kind: "unloaded", label: target.listed.label } as const;
    const { key, input } = target;
    const params = paramsFrom(key, input);
    return Result.isSuccess(params)
      ? ({ kind: "shown", key, params: params.success } as const)
      : ({ kind: "unloaded", label: key.label } as const);
  }, [subject, catalog, lookup, warnAs]);
  if (shown.kind === "broken") return <ViewUnavailable why={shown.why} placement="page" />;
  if (shown.kind === "unloaded") return <ViewNotLoaded label={shown.label} placement="page" />;
  const target = shown;
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
