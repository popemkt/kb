/**
 * The one status pill a Settings card leads with (DESIGN-UI.md → Settings →
 * Extensions): a word in the text colour, and the status's colour on a dot
 * and a tint.
 */
import { cn } from "@kb/ui-sdk";

/** A pill's face: its word, its tint and its dot. */
export interface PillFace {
  readonly word: string;
  readonly tone: string;
  readonly dot: string;
}

export function Pill({
  face,
  data,
}: {
  readonly face: PillFace;
  /** What a test or a link finds the pill by. */
  readonly data: Readonly<Record<`data-${string}`, string>>;
}) {
  return (
    <span
      {...data}
      // The word in the text colour, the status's colour on a dot and a tint: a status colour
      // as text on its own tint falls below AA in the light themes.
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-px text-label font-medium text-foreground/80",
        face.tone,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 flex-none rounded-full", face.dot)} />
      {face.word}
    </span>
  );
}
