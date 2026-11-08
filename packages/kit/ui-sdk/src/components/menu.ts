/**
 * What every menu in kb is made of: a floating surface,
 * its rows, a rule between kinds of row, and its keys. The arrows, Home and
 * End move the focus through its enabled rows, and none of them reaches
 * the keys of what it floats over (a canvas's nudge and escape) while it is
 * open. Dismissal is `useDismiss`'s, as every popover's; where a menu opens
 * is its caller's. The rule is `MenuSeparator` (`menu-separator.tsx`).
 */
import { useRef, type KeyboardEvent, type RefObject } from "react";
import { cn } from "../lib/cn";

/** A menu's look: a floating surface. */
export const MENU_SURFACE =
  "kb-surface-enter z-30 w-56 rounded-lg border border-border bg-popover p-1 text-ui text-popover-foreground shadow-overlay";

/** A menu row's look. */
export const MENU_ROW = cn(
  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left outline-none",
  "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] disabled:opacity-40",
);

/** A menu's element and what its keys do. */
export interface MenuKeys {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (e: KeyboardEvent) => void;
}

/** A menu's element and its keys: the arrows, Home and End move the focus through its enabled rows. */
export function useMenuKeys(): MenuKeys {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const all = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ??
        []),
    ];
    const at = all.findIndex((item) => item === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) all[(at + step + all.length) % all.length]?.focus();
    else if (e.key === "Home") all[0]?.focus();
    else if (e.key === "End") all.at(-1)?.focus();
    else return;
    // The keys of what the menu floats over stay out of an open menu.
    e.preventDefault();
    e.stopPropagation();
  };
  return { ref, onKeyDown };
}
