import { useRef, type ReactNode } from "react";
import { cn, useDismiss } from "@kb/ui-sdk";

/**
 * The calendar's modal: a panel over a scrim, dismissed as every popover is
 * (Escape, or a press outside it). On a phone it is a sheet from the bottom.
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
        className={cn(
          "flex max-h-[90vh] w-full flex-col gap-3 overflow-y-auto rounded-t-xl border border-border bg-popover p-4 text-popover-foreground shadow-modal sm:max-w-md sm:rounded-xl",
          className,
        )}
      >
        <h2 className="text-heading text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export const BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-3 text-ui text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md bg-primary px-3 text-ui text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
