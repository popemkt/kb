import { lazy, Suspense } from "react";
import { DesignSystemPoint, type PreviewSize, useContributions } from "@kb/ui-sdk";

/** A theme's card: loaded where a gallery first draws one, not with the page. */
const DesignSystemCard = lazy(() => import("./design-system-card"));

/** Whether a system `id` is contributed now: a preview draws nothing for one that is not. */
function useContributed(id: string): boolean {
  return useContributions(DesignSystemPoint).some(({ value }) => value.key.id === id);
}

/**
 * A design system's swatch: a live sample, not a picture. It carries
 * `data-theme`, so the system's own sheet (the painter adds every
 * contributed one) paints its ground, ink, accent, face, radius and border,
 * in the page's light or dark. Nothing for a system nobody contributes now.
 */
export function DesignSystemSwatch({ id }: { readonly id: string }) {
  if (!useContributed(id)) return null;
  return (
    <span
      data-theme={id}
      data-option-preview={id}
      className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1 py-0.5 font-sans text-caption leading-none text-foreground"
    >
      Aa
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
    </span>
  );
}

/** The design-system field's option preview, at either size (DESIGN-UI.md → Option previews). */
export function DesignSystemPreview({
  id,
  size,
}: {
  readonly id: string;
  readonly size: PreviewSize;
}) {
  const contributed = useContributed(id);
  if (size === "chip") return <DesignSystemSwatch id={id} />;
  if (!contributed) return null;
  return (
    <Suspense fallback={null}>
      <DesignSystemCard id={id} />
    </Suspense>
  );
}
