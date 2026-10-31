/**
 * Completing a term from the style library, as Know and Capture offer it:
 * the styles whose names hold what is typed at the start of a word ("toon"
 * finds "toon ramp", not "cartoon"), those that start with it first, then
 * the shortest; then the styles made with one of those, so "toon" also
 * offers cel-shaded, which is made with a toon ramp. The ones already
 * chosen are left out.
 */
import type { Library, StyleEntry } from "@kb/gallery";

/** How many completions a term offers. */
const SUGGESTIONS = 8;

const WORD = /[\p{L}\p{N}]/u;

/** Whether `name` holds `term` at the start of one of its words, ignoring case. */
export function namesTerm(name: string, term: string): boolean {
  const n = name.toLowerCase();
  const t = term.trim().toLowerCase();
  if (t === "") return false;
  for (let i = n.indexOf(t); i !== -1; i = n.indexOf(t, i + 1))
    if (i === 0 || !WORD.test(n[i - 1] ?? "")) return true;
  return false;
}

/** The styles a term names, then the styles made with them, the chosen left out. */
export function complete(
  library: Library,
  term: string,
  chosen: ReadonlySet<string>,
): readonly StyleEntry[] {
  const t = term.trim().toLowerCase();
  if (t === "") return [];
  const all = [...library.styles.values()];
  const named = all
    .filter((s) => namesTerm(s.text, t))
    .toSorted(
      (a, b) =>
        Number(b.text.toLowerCase().startsWith(t)) - Number(a.text.toLowerCase().startsWith(t)) ||
        a.text.length - b.text.length,
    );
  const ids = new Set(named.map((s) => s.id));
  const madeWith = all.filter((s) => !ids.has(s.id) && s.madeWith.some((id) => ids.has(id)));
  return [...named, ...madeWith].filter((s) => !chosen.has(s.id)).slice(0, SUGGESTIONS);
}
