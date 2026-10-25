import type { ThemeArtProps } from "@kb/ui-sdk";
import { useBeat, useStructuralWrites } from "./beat";
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
  const trail = useBeat(writes, 900);
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
      {trail > 0 ? <span key={trail} className="kb-cloudbank-trail" /> : null}
    </div>
  );
}

/**
 * Turn(): a page change freezes the frame under the planning screen's
 * translucent cyan sheet while the timeline bar along the top fills, then
 * lets the new page run. Nothing at rest. It is a gesture, not yet a plan
 * mode. GAP [[01M5S0J203QE0ZMB7MGN7GJXD8]] no staged edit to preview
 */
export function TurnVeil({ path }: Pick<ThemeArtProps, "path">) {
  const turn = useBeat(path);
  if (turn === 0) return null;
  return (
    <div key={turn} className="kb-turn">
      <div className="kb-turn-sheet" />
      <div className="kb-turn-bar">
        <span className="kb-turn-label">Turn()</span>
        <span className="kb-turn-track">
          <span className="kb-turn-fill" />
        </span>
      </div>
    </div>
  );
}
