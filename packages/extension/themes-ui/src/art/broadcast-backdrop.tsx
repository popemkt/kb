import type { BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/**
 * Broadcast, the page head ZZZ pairs with: a stack of slanted panels (a
 * dotted lime slab, a black strip of letter-spaced copy, a yellow ON AIR
 * tab) and an old TV whose screen shows the head's colour (its tag's,
 * else the accent) under scanlines. Editing lights the REC lamp; a
 * structural write is a burst of static on the screen.
 */
export function BroadcastBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const burst = useGesture(useBeat(writes, 500, activity.editing));
  return (
    <div
      className="kb-broadcast"
      style={{ opacity, ["--kb-head" as string]: color }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <div className="kb-broadcast-slab" />
      <div className="kb-broadcast-slab kb-broadcast-slab-back" />
      <div className="kb-broadcast-strip">
        <span>L I V E &nbsp; ◆ &nbsp; P R O X Y &nbsp; F E E D &nbsp; ◆ &nbsp; C H &nbsp; 0 6</span>
      </div>
      <div className="kb-broadcast-tab">ON AIR</div>
      <div className="kb-broadcast-tv">
        <div className="kb-broadcast-screen">
          <div className="kb-broadcast-bars" />
          {burst.key === null ? null : (
            <div
              key={burst.key}
              className="kb-broadcast-static"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) burst.end();
              }}
            />
          )}
        </div>
        <span className="kb-broadcast-rec">REC</span>
        <span className="kb-broadcast-antenna" />
      </div>
    </div>
  );
}
