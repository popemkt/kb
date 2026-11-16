/**
 * A page section's heading (References, Schema, a family's section, a tag's
 * fields): a line of the outline at depth 0 with an empty glyph column, so
 * its words start on the text column the page's rows start on (DESIGN-UI.md
 * → Outline layout). Every section of a page is titled with it.
 */
import type { ReactNode } from "react";
import { OutlineLine } from "@kb/ui-sdk";

export function SectionHeading({
  children,
  count,
}: {
  readonly children: ReactNode;
  /** How many the section holds, after its name. */
  readonly count?: number;
}) {
  return (
    <OutlineLine
      depth={0}
      className="mt-3 mb-1"
      text={
        <h2 className="text-meta kb-label text-foreground/30">
          {children}
          {count === undefined ? null : (
            <span className="ml-1.5 font-normal normal-case tracking-normal">({count})</span>
          )}
        </h2>
      }
    />
  );
}
