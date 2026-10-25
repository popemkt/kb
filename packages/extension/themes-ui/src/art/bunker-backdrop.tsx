import { useEffect, useRef } from "react";
import { THEME_GESTURE_MAX_MS, type BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/** How much faster the reticle tracks while a node is being edited. */
const EDITING_RATE = 6;
/** The reticle's own period, held inline so a change of speed never restarts or jumps it. */
const TRACK_PERIOD = "calc(var(--motion-ambient-period) * 3)";

/**
 * The Bunker, the page head YoRHa pairs with: an operator's HUD on the
 * beige paper. A bracketed frame, a score's staff with its colons running
 * under a small report label, a ruler of ticks, and a reticle whose ring
 * wears the head's colour (its tag's, else the accent). While a node is
 * being edited the reticle tracks faster; a structural write pings it.
 *
 * Nothing the owner does restarts it. The faster tracking is the running
 * animation's playback rate, so the reticle speeds up from where it is
 * rather than jumping (a new duration would move it to a new place). A ping
 * plays to its end: writes during it fold into it (`useBeat`'s gap is the
 * longest a gesture lasts), so a burst of edits is one ping, never one
 * started over and over.
 */
export function BunkerBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const ping = useGesture(useBeat(writes, THEME_GESTURE_MAX_MS, activity.editing));
  const ticks = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ticks.current;
    // A DOM without Web Animations (a test's) has nothing to speed up.
    const animations =
      element !== null && "getAnimations" in element ? element.getAnimations() : [];
    for (const animation of animations) {
      animation.updatePlaybackRate(activity.editing ? EDITING_RATE : 1);
    }
  }, [activity.editing]);
  return (
    <div
      className="kb-bunker"
      style={{ opacity, ["--kb-head" as string]: color }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <span className="kb-yorha-bracket" data-at="tl" />
      <span className="kb-yorha-bracket" data-at="tr" />
      <span className="kb-yorha-bracket" data-at="bl" />
      <span className="kb-yorha-bracket" data-at="br" />
      <div className="kb-bunker-label">
        <span>■ ARCHIVE</span>
        <span>: : NODE RECORD // LOCAL UNIT</span>
      </div>
      <div className="kb-bunker-staff">
        <span className="kb-yorha-colon" />
        <span className="kb-yorha-colon" />
        <span className="kb-bunker-note" />
        <span className="kb-bunker-note" />
        <span className="kb-bunker-note" />
      </div>
      <div className="kb-bunker-ruler" />
      <div className="kb-bunker-reticle">
        <span className="kb-bunker-ring" />
        <span
          ref={ticks}
          className="kb-bunker-ring kb-bunker-ring-ticks"
          style={{ animationDuration: TRACK_PERIOD }}
        />
        <span className="kb-bunker-cross" />
        {ping.key === null ? null : (
          <span
            key={ping.key}
            className="kb-bunker-ping"
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) ping.end();
            }}
          />
        )}
      </div>
    </div>
  );
}
