import {
  BACKDROP_OPTIONS,
  MOTION_FIELD_IDS,
  SYSTEM_IDS,
  declaredIdOf,
  designSystemOptionId,
  extensionNodeId,
  firstRef,
  type KbNode,
} from "@kb/model";
import { DesignSystemPoint, type PreviewSize, useContributions, useNode } from "@kb/ui-sdk";

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

/** The node a ref of `field` on `node` names, if any. */
function chosenId(node: KbNode | undefined, field: string): string | undefined {
  return firstRef(field)(node?.props ?? {});
}

/**
 * What a theme brings, in a line each, read from the graph: the extension
 * whose declaration names it (a declared id is `<family>.<local id>`; core's
 * has no family part), the backdrop its option node pairs it with, and its
 * motion preset (the motion fields its option node holds).
 */
function useThemeFacts(id: string): { by: string; pairs: string | null; motion: string | null } {
  const option = useNode(designSystemOptionId(id));
  const family = id.includes(".") ? id.slice(0, id.indexOf(".")) : "core";
  const owner = useNode(extensionNodeId(family));
  const backdropId = chosenId(option, SYSTEM_IDS.backdropField);
  const backdrop = useNode(backdropId);
  const intensity = useNode(chosenId(option, MOTION_FIELD_IDS.intensity));
  const style = useNode(chosenId(option, MOTION_FIELD_IDS.style));
  const speed = useNode(chosenId(option, MOTION_FIELD_IDS.speed));
  const motion = [intensity, style, speed].flatMap((node) =>
    node === undefined ? [] : [node.text],
  );
  const pairs =
    backdrop?.text ??
    (backdropId === undefined ? null : declaredIdOf(BACKDROP_OPTIONS, backdropId));
  return {
    by: owner?.text ?? family,
    pairs: pairs ?? null,
    motion: motion.length === 0 ? null : motion.join(", "),
  };
}

/**
 * A design system as a card: a small page painted by its own sheet (a
 * sidebar, a label, a title in its display face, two rows and its accent),
 * and under it, in the page's own ink, what the theme brings. It is what
 * the field editor's gallery draws for each option of the design-system
 * field (DESIGN-UI.md → Field values → option galleries).
 */
function DesignSystemCard({ id }: { readonly id: string }) {
  const contributed = useContributed(id);
  const facts = useThemeFacts(id);
  if (!contributed) return null;
  return (
    <span className="flex flex-col gap-1.5" data-option-card={id}>
      <span
        data-theme={id}
        data-option-preview={id}
        aria-hidden="true"
        className="grid h-24 grid-cols-[2.75rem_1fr] overflow-hidden rounded-md border border-border bg-background text-foreground"
      >
        <span className="flex flex-col gap-1.5 border-r border-border bg-sidebar p-2">
          <span className="h-1 rounded-full bg-foreground/50" />
          <span className="h-1 rounded-full bg-foreground/20" />
          <span className="h-1 rounded-full bg-foreground/20" />
          <span className="h-1 rounded-full bg-foreground/20" />
        </span>
        <span className="flex min-w-0 flex-col items-start gap-0.5 p-2">
          <span className="kb-label text-micro text-muted-foreground">Pinned</span>
          <span className="kb-display text-lead leading-tight">Home</span>
          <span className="text-caption text-foreground">A thought</span>
          <span className="mt-auto rounded-sm bg-primary px-1.5 text-micro text-primary-foreground">
            Open
          </span>
        </span>
      </span>
      <span className="flex flex-col text-caption text-muted-foreground">
        <span>{facts.by}</span>
        {facts.pairs === null ? null : <span>pairs {facts.pairs}</span>}
        {facts.motion === null ? null : <span>{facts.motion}</span>}
      </span>
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
  return size === "card" ? <DesignSystemCard id={id} /> : <DesignSystemSwatch id={id} />;
}
