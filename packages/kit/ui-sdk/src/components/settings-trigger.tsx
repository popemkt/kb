// oxlint-disable-next-line no-restricted-imports -- the gear is Settings' own, and this is its one way in
import { GearSixIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { navigate } from "../lib/router";

/** Where the Settings page is drawn (`SettingsView`, DESIGN-UI.md → Settings). */
export const SETTINGS_PATH = "/settings";

/**
 * The one way to Settings on screen: the header's corner. The shell's header
 * renders it, and a page that takes the header's place (the graph's, the
 * lab's) renders it in its own header's corner, so every page shows exactly
 * one. It wears the gear, which nothing else wears (a view's own options
 * wear `ViewOptionsGlyph`), and opens the page in the focused pane.
 */
export function SettingsTrigger({ className }: { readonly className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70",
        className,
      )}
      aria-label="Settings"
      title="Settings"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => navigate(SETTINGS_PATH)}
    >
      <GearSixIcon size={15} />
    </button>
  );
}
