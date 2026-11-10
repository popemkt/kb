import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn, IconButton, useDismiss } from "@kb/ui-sdk";

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

/**
 * The calendar's modal: a panel over a scrim, dismissed as every popover is
 * (Escape, or a press outside it), with a close button, and Tab kept inside
 * it. On a phone it is a sheet from the bottom.
 */
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

export const BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-3 text-ui text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md bg-primary px-3 text-ui text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
/** An action drawn as its icon alone, as tall as the buttons beside it; its name is its label. */
export const ICON_BUTTON_CLASS =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
