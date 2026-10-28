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
import { bundledOwners } from "@kb/bundled";
import { useNode } from "@kb/ui-sdk";

/** Who declares each node of the bundled seed: read once, where a card first needs it. */
let owners: ReadonlyMap<string, string> | undefined;

/** The node a ref of `field` on `node` names, if any. */
function chosenId(node: KbNode | undefined, field: string): string | undefined {
  return firstRef(field)(node?.props ?? {});
}

/**
 * What a theme brings, in a line each, read from the graph: the extension
 * whose declaration declares its option node (the fold's owner of it, as
 * `bundledOwners` reads it; none for a repository extension's, which the
 * page does not fold), the backdrop its option node pairs it with, and its
 * motion preset (the motion fields its option node holds).
 */
function useThemeFacts(id: string): {
  by: string | null;
  pairs: string | null;
  motion: string | null;
} {
  const optionId = designSystemOptionId(id);
  const option = useNode(optionId);
  owners ??= bundledOwners();
  const family = owners.get(optionId);
  const owner = useNode(family === undefined ? undefined : extensionNodeId(family));
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
    by: owner?.text ?? family ?? null,
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
export default function DesignSystemCard({ id }: { readonly id: string }) {
  const facts = useThemeFacts(id);
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
        {facts.by === null ? null : <span>{facts.by}</span>}
        {facts.pairs === null ? null : <span>pairs {facts.pairs}</span>}
        {facts.motion === null ? null : <span>{facts.motion}</span>}
      </span>
    </span>
  );
}
