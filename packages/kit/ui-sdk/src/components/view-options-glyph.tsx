import { SlidersHorizontalIcon, type IconProps } from "@phosphor-icons/react";

/**
 * The glyph of a view's own options: what one view shows and how (a
 * graph's layout and lens, an outline frame's view and filters). The gear
 * is Settings' alone (`SettingsTrigger`), so a view's options never read as
 * a second way to Settings (DESIGN-UI.md → Settings → One way in).
 */
export function ViewOptionsGlyph(props: IconProps) {
  return <SlidersHorizontalIcon {...props} />;
}
