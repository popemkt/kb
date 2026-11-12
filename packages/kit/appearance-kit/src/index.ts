/**
 * `@kb/appearance-kit`: what a theme's art is drawn with (DESIGN-UI.md → Design
 * tokens → Themes; ART-DIRECTION.md), whichever family brings the theme:
 * the beat a passing gesture is keyed on (`useBeat`), the count of
 * structural writes (`useStructuralWrites`), the gesture a beat draws
 * (`useGesture`), and the box a piece of art is framed in while its code
 * loads (`ART_FRAME`, for the kit's `deferred`) if its slot counts what it
 * was handed; the band a theme's second head is drawn in (`band`), and
 * the path a veil is handed on the plane that hears no page change
 * (`NOWHERE`; on the plane that hears no write it is handed `QUIET_ACTIVITY`).
 * Mechanism only: it knows no theme.
 */
import "./frame.css";

export { useBeat, useGesture, useStructuralWrites } from "./beat";
export { ART_FRAME } from "./frame";
export { NOWHERE, band } from "./head";

export {
  type Backdrop,
  type BackdropAction,
  BackdropActionPoint,
  BackdropPoint,
  provideBackdrop,
  type DesignSystem,
  DesignSystemPoint,
  provideDesignSystem,
  type ThemeArtProps,
  THEME_GESTURE_MAX_MS,
  type ThemeArtPlane,
  type BackdropPresentation,
  BACKDROP_CUE_LABELS,
  type BackdropCue,
  type BackdropInteraction,
  type BackdropProps,
} from "./lib/appearance-points.ts";
export { decodeBackdrop, type RefusedBackdrop } from "./lib/backdrop-decode.ts";
export {
  type FrameCost,
  type FrameMeter,
  type FrameMeterOptions,
  type FrameMeterReading,
  meterFrames,
  readFrameMeter,
} from "./lib/frame-meter.ts";
export {
  BackdropFrame,
  HeadBackdropFrame,
  PageBackdrop,
  PageBackdropHost,
} from "./components/page-backdrop.tsx";
export { BackdropCard } from "./components/backdrop-card.tsx";
export { ThemeArt } from "./components/theme-art.tsx";
export { chooseDesignSystem, shownDesignSystem } from "./lib/design-system.ts";

export {
  useBackdropKnobs,
  useBackdrops,
  usePageBackdrop,
  useShownDesignSystem,
  type PageBackdropChoice,
} from "./appearance-hooks";
