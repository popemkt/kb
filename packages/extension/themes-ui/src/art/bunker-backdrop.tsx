import type { BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/**
 * The Bunker, the page head YoRHa pairs with: an operator's HUD on the
 * beige paper. A bracketed frame, a score's staff with its colons running
 * under a small report label, a ruler of ticks, and a reticle whose ring
 * wears the head's colour (its tag's, else the accent). While a node is
 * being edited the reticle tracks faster; a structural write pings it.
 */
export function BunkerBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const ping = useGesture(useBeat(writes, 600));
  return (
    <div
      className="kb-bunker"
      style={{ opacity, ["--kb-head" as string]: color }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <div className="kb-bunker-grid" />
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
        <span className="kb-bunker-ring kb-bunker-ring-ticks" />
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
