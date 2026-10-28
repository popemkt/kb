import type { BackdropProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "@kb/theme-art";

/** The tally's segments, and how many of them the count starts with lit. */
const SEGMENTS = 10;
const FIRST = 5;

/**
 * OVC Terminal, Transistor's second page head: one of the city's voting
 * terminals, a dark screen in a gold Art Deco frame (notched corners, a
 * sunburst crown), reading in amber terminal type over a violet-blue night
 * and the city's amber lights. The head's colour (its tag's, else the
 * accent) fills the tally, which counts one more segment for each structural
 * write as the screen refreshes; editing brings the screen up and lights
 * the cursor in the head's colour.
 */
export function OvcBackdrop({ color, opacity, activity, direction }: BackdropProps) {
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const refresh = useGesture(useBeat(writes, 600, activity.editing));
  const tally = FIRST + (writes % (SEGMENTS - FIRST + 1));
  return (
    <div
      className="kb-ovc"
      style={{
        opacity,
        ["--kb-head" as string]: color,
        ["--kb-tally" as string]: tally / SEGMENTS,
      }}
      data-direction={direction}
      data-editing={activity.editing || undefined}
    >
      <div className="kb-ovc-night" />
      <div className="kb-ovc-lights" />
      <div className="kb-ovc-terminal">
        <span className="kb-ovc-crown" />
        <div className="kb-ovc-screen">
          <p className="kb-ovc-title">
            <span>OVC · VOTE TALLY</span>
            <span className="kb-ovc-lamp">LIVE</span>
          </p>
          <p>&gt; sky colour: dusk</p>
          <p className="kb-ovc-dim">&gt; fog over the bay: 22:00</p>
          <p className="kb-ovc-tally">
            <span className="kb-ovc-bar" />
            <span>YES {tally * SEGMENTS}%</span>
          </p>
          <p>
            &gt; <span className="kb-ovc-cursor" />
          </p>
          {refresh.key === null ? null : (
            <span
              key={refresh.key}
              className="kb-ovc-refresh"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) refresh.end();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
