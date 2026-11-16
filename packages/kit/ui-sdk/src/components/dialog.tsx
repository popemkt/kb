/**
 * The one modal (DESIGN-UI.md → Cross-surface polish, "A modal is one
 * component"): a panel over the scrim, dismissed as every popover is
 * (Escape, or a press outside it), with its title and a close button, and
 * Tab kept inside it. Its header and its actions stay in view and only its
 * body scrolls, so the action it is for is never below the fold. On a phone
 * it is a sheet from the bottom. It is not the
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
  actions,
  testId,
  className,
}: {
  readonly title: string;
  readonly onClose: () => void;
  /** The body, which scrolls when the panel cannot hold it. */
  readonly children: ReactNode;
  /** The dialog's buttons, in a footer that stays in view below the body. */
  readonly actions?: ReactNode;
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
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-popover text-popover-foreground shadow-modal sm:max-w-md sm:rounded-xl",
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-3">
          <h2 className="min-w-0 flex-1 text-heading text-foreground">{title}</h2>
          <IconButton label="Close" icon={XIcon} size="md" onClick={onClose} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {children}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
