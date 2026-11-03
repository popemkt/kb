import { reloadNow, type ReloadState } from "@kb/ui-sdk";
import { useUiStore } from "@/stores/ui.store";

/**
 * Where a reload into a newer build stands, as a small chip that blocks
 * nothing (`stores/reload`): waiting for the page to be idle, reloading, or
 * — when a reload would land on this same build — left to the person.
 * Rare: a tab of an older build keeps working unless the wire changed.
 */
export function ReloadChip() {
  const reload = useUiStore((s) => s.reload);
  if (reload === "none") return null;
  const words: Record<Exclude<ReloadState, "none">, string> = {
    waiting: "kb was updated · reloads when you pause",
    reloading: "Reloading into the new version…",
    stuck: "kb was updated",
  };
  return (
    <div
      role="status"
      className="kb-surface-enter fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-foreground/10 bg-popover px-3 py-1 text-label text-muted-foreground shadow-lifted"
    >
      {words[reload]}
      {reload === "reloading" ? null : (
        <button
          type="button"
          onClick={() => reloadNow()}
          title="Reload into the new version now. Where you are is kept."
          className="rounded-full px-1.5 text-label text-foreground/75 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/90"
        >
          Reload now
        </button>
      )}
    </div>
  );
}
