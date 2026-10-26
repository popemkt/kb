/**
 * How a slot sits in the page: its place in the builder's keyboard order,
 * read from the page (`data-qb-slot` in reading order, within its row and
 * its builder), and the box it draws.
 */
import { cn } from "@kb/ui-sdk";

/** A slot's element, found in the page by the builder's keyboard. */
const SLOT = "[data-qb-slot]";
/** The row a slot is in. */
const ROW = "[data-qb-row]";
/** The builder a slot belongs to: its keyboard never leaves it. */
const ROOT = "[data-query-builder]";

/** The slot `delta` slots away from `from`, in the builder's reading order. */
export function neighbourSlot(from: Element, delta: -1 | 1): HTMLElement | null {
  const root = from.closest(ROOT);
  if (root === null) return null;
  const slots = [...root.querySelectorAll<HTMLElement>(SLOT)];
  const at = slots.findIndex((slot) => slot === from);
  return at < 0 ? null : (slots[at + delta] ?? null);
}

/**
 * Move the keyboard on from `from`: to the first slot after it in its row
 * that holds nothing yet, opened — the row is said slot by slot — or, when
 * the row is said, to the next slot.
 */
export function advanceFrom(from: Element | null): void {
  if (from === null) return;
  const row = from.closest(ROW);
  const after = row === null ? [] : [...row.querySelectorAll<HTMLElement>(SLOT)];
  const empty = after
    .slice(after.findIndex((slot) => slot === from) + 1)
    .find((slot) => slot.dataset.qbEmpty === "true");
  if (empty !== undefined) {
    empty.focus();
    empty.click();
    return;
  }
  neighbourSlot(from, 1)?.focus();
}

/**
 * How a slot is drawn: the subject, bold; an operator, quiet; a value in a
 * box; or a value that is chips (a tag, options), which are their own box,
 * so the slot draws none around them.
 */
export type SlotTone = "subject" | "operator" | "value" | "chips";

/** The box every slot draws: the mockup's chip, from the design tokens. */
export function slotClass(tone: SlotTone): string {
  return cn(
    "inline-flex min-h-5 max-w-full items-center gap-1 rounded-sm text-meta",
    "whitespace-nowrap outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    tone !== "chips" && "border border-border px-1.5",
    tone === "operator" && "bg-transparent text-foreground/50 hover:text-foreground/75",
    (tone === "subject" || tone === "value") &&
      "bg-foreground/[0.04] text-foreground/80 hover:bg-foreground/[0.07]",
    tone === "subject" && "font-semibold",
  );
}
