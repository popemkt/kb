/**
 * Completing a term from the style library, as Know offers it: the styles
 * whose names hold what is typed, those that start with it first, then the
 * shortest, the ones already chosen left out.
 */
import type { Library, StyleEntry } from "@kb/gallery";

/** How many completions a term offers. */
const SUGGESTIONS = 8;

/** The styles whose names hold `term`, those that start with it first, the chosen left out. */
export function complete(
  library: Library,
  term: string,
  chosen: ReadonlySet<string>,
): readonly StyleEntry[] {
  const t = term.trim().toLowerCase();
  if (t === "") return [];
  const hits = [...library.styles.values()].filter(
    (s) => !chosen.has(s.id) && s.text.toLowerCase().includes(t),
  );
  return hits
    .toSorted(
      (a, b) =>
        Number(b.text.toLowerCase().startsWith(t)) - Number(a.text.toLowerCase().startsWith(t)) ||
        a.text.length - b.text.length,
    )
    .slice(0, SUGGESTIONS);
}
