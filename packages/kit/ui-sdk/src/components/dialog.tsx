/**
 * The one modal (DESIGN-UI.md → Cross-surface polish, "A modal is one
 * component"): a panel over the scrim, dismissed as every popover is
 * (Escape, or a press outside it), with its title and a close button, and
 * Tab kept inside it. On a phone it is a sheet from the bottom. It is not the
 * native `<dialog>`: that one's top layer would leave the pickers and
 * popovers a modal opens, which render outside it, inert behind it.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { IconButton } from "./icon-button";
import { useDismiss } from "./use-dismiss";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';

/** Tab and Shift+Tab go round the panel's controls, never out to the page behind it. */
function keepFocusIn(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog({
  title,
  onClose,
  children,
  testId,
  className,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
  /** The panel's own classes, its width above all (`sm:max-w-md` by default). */
  readonly className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(true, { inside: [panel], trigger: null }, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 sm:items-center">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onKeyDown={keepFocusIn}
        className={cn(
          "flex max-h-[90vh] w-full flex-col gap-3 overflow-y-auto rounded-t-xl border border-border bg-popover p-4 text-popover-foreground shadow-modal sm:max-w-md sm:rounded-xl",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-heading text-foreground">{title}</h2>
          <IconButton label="Close" icon={XIcon} size="md" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
