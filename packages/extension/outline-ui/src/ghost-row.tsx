/**
 * The outline's ghost row (DESIGN-UI.md → Outline layout, "A ghost row is
 * an add row"): the place a row is about to be, drawn as one. Its ghost
 * glyph is in the glyph column and its placeholder on the text column,
 * always together, and it is one row tall. It is the only add affordance an
 * outline list draws: under a page's rows, under an open row that has no
 * rows yet, and under a query's results.
 */
import type { HTMLAttributes } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { cn, OutlineLine } from "@kb/ui-sdk";

/** What every ghost row says: the row it adds is a node like any other. */
const PLACEHOLDER = "New node";

interface GhostRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick"> {
  readonly depth: number;
  /** Add the row. */
  readonly onAdd: () => void;
  /**
   * Drawn at rest, faint: the first row's place on an empty page. Every
   * other ghost row shows while it is hovered or focused, and holds its line
   * either way, so showing it moves nothing.
   */
  readonly atRest?: boolean;
  /** What the row adds, for a screen reader and the tooltip. */
  readonly label: string;
}

export function GhostRow({
  depth,
  onAdd,
  atRest = false,
  label,
  className,
  ...rest
}: GhostRowProps) {
  const ink = atRest
    ? "text-foreground/30 group-hover/ghost:text-foreground/50"
    : "text-foreground/0 group-hover/ghost:text-foreground/30 group-focus-visible/ghost:text-foreground/30";
  return (
    <OutlineLine
      {...rest}
      depth={depth}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      className={cn(
        "group/ghost cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
      style={{ minHeight: "var(--kb-row-h)" }}
      data-ghost-row="true"
      data-ghost-at-rest={atRest || undefined}
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onAdd();
      }}
      glyph={
        <PlusIcon size={12} weight="bold" className={cn("transition-colors", ink)} aria-hidden />
      }
      text={
        <span className={cn("kb-text block min-h-6 transition-colors duration-150", ink)}>
          {PLACEHOLDER}
        </span>
      }
    />
  );
}
