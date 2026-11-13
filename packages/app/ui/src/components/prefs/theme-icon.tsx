import type { IconProps } from "@phosphor-icons/react";
import { THEME_GLYPHS } from "./theme-glyphs";
import { forwardRef } from "react";
import { cn, type ThemePref } from "@kb/ui-sdk";

/** One glyph for the device theme, shared by settings and their entry points. */
export const ThemeIcon = forwardRef<SVGSVGElement, IconProps & { theme: ThemePref }>(
  function ThemeIcon({ theme, className, ...props }, ref) {
    const Glyph = THEME_GLYPHS[theme];
    return <Glyph key={theme} ref={ref} {...props} className={cn("kb-theme-glyph", className)} />;
  },
);
