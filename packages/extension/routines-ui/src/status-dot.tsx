import type { SyncStatus } from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { SYNC_DOTS, syncShown } from "./sync-shown";

/** A routine instance's sync state as a small dot, what it means as the tooltip. */
export function StatusDot({
  status,
  calendarMode,
  className,
}: {
  readonly status: SyncStatus | null;
  readonly calendarMode: string | undefined;
  readonly className?: string;
}) {
  const shown = syncShown(status, calendarMode);
  return (
    <span
      role="img"
      aria-label={shown.text}
      title={shown.text}
      data-sync-status={shown.state}
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        SYNC_DOTS[shown.state],
        className,
      )}
    />
  );
}
