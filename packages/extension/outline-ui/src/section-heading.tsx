/**
 * A page section's heading (References, Schema, a family's section, a tag's
 * fields): a line of the outline at depth 0 with an empty glyph column, so
 * its words start on the text column the page's rows start on (DESIGN-UI.md
 * → Outline layout). Every section of a page is titled with it.
 *
 * A section that folds (References) puts its caret in that glyph column,
 * where a row's bullet is, and the whole line opens or closes it.
 */
import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { cn, GLYPH_COLUMN, OutlineLine } from "@kb/ui-sdk";

/** Whether the section's body is shown, and how to switch it. */
interface SectionDisclosure {
  readonly open: boolean;
  readonly toggle: () => void;
}

export function SectionHeading({
  children,
  count,
  disclosure,
}: {
  readonly children: ReactNode;
  /** How many the section holds, after its name: a number, or a short summary. */
  readonly count?: number | string;
  /** The section folds, by this line; closed, its heading is all it draws. */
  readonly disclosure?: SectionDisclosure;
}) {
  const title = (
    <>
      {children}
      {count === undefined ? null : (
        <span className="ml-1.5 font-normal normal-case tracking-normal">({count})</span>
      )}
    </>
  );
  if (disclosure === undefined) {
    return (
      <OutlineLine
        depth={0}
        className="mt-3 mb-1"
        text={<h2 className="text-meta kb-label text-foreground/30">{title}</h2>}
      />
    );
  }
  const { open, toggle } = disclosure;
  return (
    <OutlineLine
      depth={0}
      className="group/heading mt-3 mb-1 cursor-pointer"
      onClick={toggle}
      glyph={
        <CaretRightIcon
          size={10}
          weight="bold"
          aria-hidden
          className={cn(
            "text-foreground/30 transition-transform duration-100 group-hover/heading:text-foreground/60",
            open && "rotate-90",
          )}
        />
      }
      text={
        // As tall as the glyph column, so the caret centres on the words.
        <h2
          className="flex items-center text-meta kb-label text-foreground/30 group-hover/heading:text-foreground/60 transition-colors duration-100"
          style={{ minHeight: GLYPH_COLUMN.height }}
        >
          {/* The click reaches the line, so caret, words and button are one target. */}
          <button
            type="button"
            className="cursor-pointer rounded-xs uppercase outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-expanded={open}
          >
            {title}
          </button>
        </h2>
      }
    />
  );
}
