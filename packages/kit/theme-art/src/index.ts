/**
 * `@kb/theme-art`: what a theme's art is drawn with (DESIGN-UI.md → Design
 * tokens → Themes; ART-DIRECTION.md), whichever family brings the theme:
 * the beat a passing gesture is keyed on (`useBeat`), the count of
 * structural writes (`useStructuralWrites`), the gesture a beat draws
 * (`useGesture`), and a piece of art whose code loads the first time it is
 * drawn (`deferred`), framed while it loads if its slot counts what it
 * was handed; the band a theme's second head is drawn in (`band`), and
 * the path a veil is handed on the plane that hears no page change
 * (`NOWHERE`; on the plane that hears no write it is handed `QUIET_ACTIVITY`).
 * Mechanism only: it knows no theme.
 */
import "./frame.css";

export { useBeat, useGesture, useStructuralWrites } from "./beat";
export { deferred } from "./deferred";
export { NOWHERE, band } from "./head";
