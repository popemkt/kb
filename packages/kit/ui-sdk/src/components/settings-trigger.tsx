import { GearSixIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { navigate } from "../lib/router";

/** Where the Settings page is drawn (`SettingsView`, DESIGN-UI.md → Settings). */
export const SETTINGS_PATH = "/settings";

/**
 * The one way to Settings from a header: the shell's header and every page
 * header that has its own (the graph's, the lab's) render this. It wears a
 * neutral gear, since the theme is one setting among those it opens, and
 * opens the page in the focused pane.
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
