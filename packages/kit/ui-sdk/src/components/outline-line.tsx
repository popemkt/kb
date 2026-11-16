import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../lib/cn";
import { GLYPH_COLUMN, indentStyle, TEXT_INSET } from "../lib/indent";

export interface OutlineLineProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Indent steps before the line. */
  readonly depth: number;
  /** What the glyph column holds, centred in it; none leaves the column empty. */
  readonly glyph?: ReactNode;
  /**
   * The one lead mark a line may carry, a tag's box: a second glyph column
   * after the first, so the text starts exactly one step further in.
   */
  readonly lead?: ReactNode;
  /** The text column: everything the line says, from its first letter on. */
  readonly text: ReactNode;
  /** The text column's own classes (its flow, gap, hover ground). */
  readonly textClassName?: string | undefined;
  readonly ref?: Ref<HTMLDivElement> | undefined;
}

/** One glyph column, its content centred. */
function GlyphColumn({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-center self-start" style={GLYPH_COLUMN}>
      {children}
    </span>
  );
}

/**
 * The outline's one line (DESIGN-UI.md → Outline layout): a glyph column and
 * a text column, at a depth. A node row, a field row, the page's title, a
 * ghost row and a chips line are each this line with their own content, so
 * every glyph centres on one column and every text starts on one column,
 * whatever the line is.
 */
export function OutlineLine({
  depth,
  glyph,
  lead,
  text,
  className,
  textClassName,
  style,
  ref,
  ...rest
}: OutlineLineProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn("flex items-start", className)}
      style={{ ...indentStyle(depth), ...style }}
    >
      <GlyphColumn>{glyph}</GlyphColumn>
      {lead === undefined ? null : <GlyphColumn>{lead}</GlyphColumn>}
      <div className={cn("min-w-0 flex-1", textClassName)} style={TEXT_INSET}>
        {text}
      </div>
    </div>
  );
}
