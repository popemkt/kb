import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "@kb/ui-sdk";

/**
 * The square a checkbox draws: a checkbox field's value and a tag's box
 * alike, so a box reads the same wherever it stands. Its button is the
 * control (`group/check`, which its hover follows); this is only its face.
 */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-xs border",
        "transition-colors duration-100 motion-reduce:transition-none",
        checked
          ? "border-primary/70 bg-primary/10 text-primary"
          : "border-foreground/25 group-hover/check:border-foreground/45",
      )}
    >
      {checked && <CheckIcon size={10} weight="bold" />}
    </span>
  );
}
