import type { ThemeArtProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "@kb/theme-art";
import { SkylineSvg } from "./skyline-svg";

/** The light rails over the city: height above the ground (vh), length (vw), period (s) and phase. */
const RAILS: readonly { bottom: number; length: number; period: number; delay: number }[] = [
  { bottom: 7, length: 26, period: 22, delay: -3 },
  { bottom: 11.5, length: 18, period: 31, delay: -17 },
  { bottom: 15, length: 34, period: 27, delay: -9 },
  { bottom: 4.5, length: 14, period: 19, delay: -12 },
];

/**
 * Cloudbank's ground: a painted dusk (the cyan haze, the city's magenta
 * glow on the horizon), a faint Art Nouveau halo, the skyline along the
 * bottom edge with its windows, and light rails gliding through it. A
 * structural write sends one bright trail across the city: the function
 * executing. Everything moves by transform and opacity alone.
 */
export function CloudbankGround({ activity }: Pick<ThemeArtProps, "activity">) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const trail = useGesture(useBeat(writes, 900, activity.editing));
  return (
    <div className="kb-cloudbank-ground" data-editing={activity.editing || undefined}>
      <div className="kb-cloudbank-wash" />
      <div className="kb-cloudbank-halo" />
      <SkylineSvg className="kb-cloudbank-city" />
      {RAILS.map(({ bottom, length, period, delay }) => (
        <span
          key={bottom}
          className="kb-cloudbank-rail"
          style={{
            bottom: `${bottom}vh`,
            width: `${length}vw`,
            animationDuration: `${period}s`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
      {trail.key === null ? null : (
        <span
          key={trail.key}
          className="kb-cloudbank-trail"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) trail.end();
          }}
        />
      )}
    </div>
  );
}

/**
 * Jaunt(): a page change is the Process whitewashing the frame. A sheet of
 * Process white under a cyan cell grid crosses the page in steps, its edges
 * dissolving in bands, named as the game names its functions. Nothing at
 * rest. Turn() itself is the command palette (`--palette-mark`, the
 * segmented bar, the desaturating cyan scrim), which freezes the page to
 * plan; it is not yet a plan mode. GAP [[01M5S0J203QE0ZMB7MGN7GJXD8]] no
 * staged edit to preview
 */
export function JauntVeil({ path }: Pick<ThemeArtProps, "path">) {
  const jaunt = useGesture(useBeat(path));
  if (jaunt.key === null) return null;
  return (
    <div key={jaunt.key} className="kb-jaunt">
      <div
        className="kb-jaunt-cells"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) jaunt.end();
        }}
      >
        <span className="kb-jaunt-label">Jaunt()</span>
      </div>
    </div>
  );
}
