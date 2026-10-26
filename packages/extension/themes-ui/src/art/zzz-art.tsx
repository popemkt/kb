import type { ThemeArtProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/**
 * The sound a structural write makes, drawn instead of played: a comic
 * sound effect on a sticker. Picked by the write's count, so it varies
 * without a random draw.
 */
const SFX: readonly string[] = ["KA-CHUNK!", "SNAP!", "CLICK!", "POP!", "THUNK!", "ZIP!"];

/** The words the street's marquee carries, letter-spaced: original, not the game's. */
const MARQUEE = "PROXY LINK OK ◆ SIGNAL 06 ◆ NODE FEED LIVE ◆ CITY AFTER DARK ◆ ";

/**
 * New Eridu's ground: halftone fields bleeding in from two corners, the
 * gutters of a comic page cutting across them, and a slanted hazard band
 * along the bottom with its marquee crawling by.
 */
export function StreetGround() {
  return (
    <div className="kb-zzz-ground">
      <div className="kb-zzz-dots kb-zzz-dots-top" />
      <div className="kb-zzz-dots kb-zzz-dots-bottom" />
      <div className="kb-zzz-gutters" />
      <div className="kb-zzz-band">
        <div className="kb-zzz-band-stripes" />
        <div className="kb-zzz-marquee">
          <span>{MARQUEE.repeat(3)}</span>
          <span>{MARQUEE.repeat(3)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The passing gestures: a page change sends a dotted, slanted panel across
 * the screen with a black strip leading it, then the new page is there; a
 * structural write slaps a sound-effect sticker in the corner, the sound of
 * the write drawn as motion. Nothing at rest.
 */
export function StreetVeil({ activity, path }: Pick<ThemeArtProps, "activity" | "path">) {
  const wipe = useGesture(useBeat(path));
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const sfx = useGesture(useBeat(writes, 700, activity.editing));
  return (
    <>
      {wipe.key === null ? null : (
        <div key={wipe.key} className="kb-zzz-wipe">
          <div
            className="kb-zzz-wipe-panel"
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) wipe.end();
            }}
          />
          <div className="kb-zzz-wipe-strip">
            <span>C H A N G I N G &nbsp; C H A N N E L</span>
          </div>
        </div>
      )}
      {sfx.key === null ? null : (
        <span
          key={sfx.key}
          className="kb-zzz-sfx"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) sfx.end();
          }}
        >
          {SFX[sfx.key % SFX.length]}
        </span>
      )}
    </>
  );
}
