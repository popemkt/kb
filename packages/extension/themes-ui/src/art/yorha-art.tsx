import type { ThemeArtProps } from "@kb/ui-sdk";
import { useBeat, useGesture, useStructuralWrites } from "./beat";

/** What the unit reports after a structural write, picked by the write's count: kb's own words. */
const REPORTS: readonly string[] = [
  "RECORD SAVED",
  "NODE WRITTEN",
  "ARCHIVE UPDATED",
  "LOG ENTRY ADDED",
  "DATA SYNCHRONISED",
];

/** The scan bars a page change steps across, top to bottom. */
const BARS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The Bunker's ground: a faint grid on warm paper, darkened toward the
 * edges like a convex monitor, a score's staff with its colons along the
 * bottom, bracketed corners framing the viewport and one slow scan line
 * going down it. Nothing here reacts; it is the room the page sits in.
 */
export function YorhaGround(_: Pick<ThemeArtProps, "activity">) {
  return (
    <div className="kb-yorha-ground">
      <div className="kb-yorha-grid" />
      <div className="kb-yorha-vignette" />
      <div className="kb-yorha-staff">
        <span className="kb-yorha-colon" />
        <span className="kb-yorha-colon" />
        <span className="kb-yorha-colon" />
      </div>
      <span className="kb-yorha-bracket" data-at="tl" />
      <span className="kb-yorha-bracket" data-at="tr" />
      <span className="kb-yorha-bracket" data-at="bl" />
      <span className="kb-yorha-bracket" data-at="br" />
      <span className="kb-yorha-scan" />
    </div>
  );
}

/**
 * The passing gestures: a page change steps a stack of ink bars across the
 * screen, one after another, and the new page is under them; a structural
 * write is the Pod scanning: two square wave fronts sweep out from its
 * corner across the window, and it prints a small report there, the unit
 * confirming the write. Nothing at rest.
 */
export function YorhaVeil({ activity, path }: Pick<ThemeArtProps, "activity" | "path">) {
  const wipe = useGesture(useBeat(path));
  const writes = useStructuralWrites(activity.writes, activity.editing);
  const report = useGesture(useBeat(writes, 700, activity.editing));
  return (
    <>
      {wipe.key === null ? null : (
        <div
          key={wipe.key}
          className="kb-yorha-wipe"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) wipe.end();
          }}
        >
          {BARS.map((bar) => (
            <span key={bar} className="kb-yorha-bar" style={{ ["--kb-bar" as string]: bar }} />
          ))}
        </div>
      )}
      {report.key === null ? null : (
        <div key={`scan-${report.key}`} className="kb-yorha-scan-pulse">
          <span className="kb-yorha-front" />
          <span className="kb-yorha-front" />
        </div>
      )}
      {report.key === null ? null : (
        <div
          key={report.key}
          className="kb-yorha-report"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) report.end();
          }}
        >
          <span className="kb-yorha-report-line">■ {REPORTS[report.key % REPORTS.length]}</span>
          <span className="kb-yorha-report-sub">: : WRITE {String(writes).padStart(3, "0")}</span>
        </div>
      )}
    </>
  );
}
