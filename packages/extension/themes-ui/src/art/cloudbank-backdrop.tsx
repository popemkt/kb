import type { BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";
import { SkylineSvg } from "./skyline-svg";

/**
 * Cloudbank, the page head Transistor pairs with: a painted dusk falling
 * from the night's teal into the city's magenta glow, a sun inside the
 * concentric rings of an Art Nouveau halo, the skyline on the horizon and a
 * trail of light across it. The head's colour (its tag's, else the accent)
 * tints the halo. While a node is being edited the city's windows burn
 * brighter; a structural write sends a trail over the roofs.
 */
export function CloudbankBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const trail = useGesture(useBeat(writes, 900, activity.editing));
  return (
    <div
      className="kb-cloudbank-backdrop"
      style={{ opacity, ["--kb-head" as string]: color }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <div className="kb-cloudbank-sky" />
      <div className="kb-cloudbank-sun">
        <span />
        <span />
        <span />
      </div>
      <SkylineSvg className="kb-cloudbank-city" />
      <span className="kb-cloudbank-rail kb-cloudbank-rail-head" />
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
