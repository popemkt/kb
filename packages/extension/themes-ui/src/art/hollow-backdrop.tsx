import type { BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/** The order the lit tile walks the Hollow's grid of screens: a snake. */
const WALK = [0, 1, 2, 5, 4, 3] as const;
const TILES = [0, 1, 2, 3, 4, 5] as const;
const MARKS: Readonly<Record<number, string>> = { 2: "!", 3: "?" };

/**
 * Hollow, ZZZ's second page head: the rift. A comic panel torn open on its
 * left edge (a thick outline, a hard offset shadow) shows the ether turning
 * inside, purple-black with the head's colour (its tag's, else the accent)
 * bleeding into its eye, under a halftone screen; a sticker names the zone
 * and a strip of caution tape runs under it. Beside it, the grid of screens
 * a Hollow is explored through: one tile is lit, and each structural write
 * moves it a step and sends a surge out of the rift. Editing wakes the
 * sparks around the eye.
 */
export function HollowBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const surge = useGesture(useBeat(writes, 500));
  const lit = WALK[writes % WALK.length];
  return (
    <div
      className="kb-hollow"
      style={{ opacity, ["--kb-head" as string]: color }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <div className="kb-hollow-panel">
        <div className="kb-hollow-cut">
          <div className="kb-hollow-ether">
            <div className="kb-hollow-swirl" />
            <div className="kb-hollow-eye" />
            <div className="kb-hollow-dots" />
            {surge.key === null ? null : (
              <span
                key={surge.key}
                className="kb-hollow-surge"
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) surge.end();
                }}
              />
            )}
          </div>
        </div>
      </div>
      <span className="kb-hollow-spark" />
      <span className="kb-hollow-spark" />
      <span className="kb-hollow-spark" />
      <span className="kb-hollow-spark" />
      <div className="kb-hollow-tape">
        <span>
          C A U T I O N &nbsp; ◆ &nbsp; R I F T &nbsp; A C T I V E &nbsp; ◆ &nbsp; K E E P &nbsp; O
          U T
        </span>
      </div>
      <div className="kb-hollow-tab">HOLLOW · ZONE 06</div>
      <div className="kb-hollow-tiles">
        {TILES.map((tile) => (
          <span key={tile} className="kb-hollow-tile" data-lit={tile === lit || undefined}>
            {tile === lit ? null : MARKS[tile]}
          </span>
        ))}
      </div>
    </div>
  );
}
