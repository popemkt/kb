/**
 * A look as a 3D art-direction brief: what a builder (a person, or an agent
 * building a Three.js or Blender scene) follows to make the look in 3D. It
 * is one of the look's exports (`./exports.ts`), read from the same look and
 * library as the brief for a person, and differs in what it says of each
 * style: what it looks like, what it is made with, the works it is seen in,
 * and how to make it, per tool. A style the look chose calls for the styles
 * it is made with (a cel-shaded look needs its toon ramp and its outline),
 * so those are written too, each under its own facet and marked with the
 * style that calls for it, however deep the making goes.
 *
 * Every section is the library's own: facets in the composer's order, with
 * their names as the person gave them, so a library with a "Lighting" and a
 * "Projection" facet reads as lighting and camera, and one without them
 * does not pretend to.
 */
import { nameOf, promptLines, referenceLines, type LookDraft } from "./look.ts";
import { orderedStyles, type GraphNode, type Library, type StyleEntry } from "./library.ts";

/**
 * The look's styles and every style they are made with, however deep, each
 * with the chosen styles that call for it (none for a chosen one).
 */
export function stylesCalledFor(
  draft: LookDraft,
  library: Library,
): ReadonlyMap<string, readonly string[]> {
  const calledBy = new Map<string, string[]>();
  const chosen = new Set(draft.styles.filter((id) => library.styles.has(id)));
  for (const id of chosen) calledBy.set(id, []);
  for (const root of chosen) {
    const seen = new Set([root]);
    const stack = [...(library.styles.get(root)?.madeWith ?? [])];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      if (!chosen.has(id)) {
        const by = calledBy.get(id) ?? [];
        by.push(root);
        calledBy.set(id, by);
      }
      stack.push(...(library.styles.get(id)?.madeWith ?? []));
    }
  }
  return calledBy;
}

function styleLines(
  style: StyleEntry,
  calledBy: readonly string[],
  library: Library,
): readonly string[] {
  const nameOfStyle = (id: string) => library.styles.get(id)?.text ?? id;
  const why = calledBy.length === 0 ? "" : ` (for ${calledBy.map(nameOfStyle).join(", ")})`;
  const noted = style.description !== "" || style.howTo.length > 0 || style.madeWith.length > 0;
  if (!noted) return [`- ${style.text}${why}`];
  const lines = [`### ${style.text}${why}`, ""];
  if (style.description !== "") lines.push(style.description, "");
  if (style.madeWith.length > 0)
    lines.push(`- Made with: ${style.madeWith.map(nameOfStyle).join(", ")}`);
  if (style.seenIn.length > 0) lines.push(`- Seen in: ${style.seenIn.join("; ")}`);
  for (const how of style.howTo) lines.push(`- ${how}`);
  lines.push("");
  return lines;
}

/** A look as a 3D art-direction brief, in Markdown. */
export function artDirectionOf(
  draft: LookDraft,
  library: Library,
  get: (id: string) => GraphNode | undefined,
): string {
  const lines = [`# ${nameOf(draft)}: 3D art direction`, ""];
  if (draft.description.trim() !== "") lines.push(draft.description.trim(), "");
  const forNode = draft.forNode === null ? undefined : get(draft.forNode);
  if (forNode !== undefined) lines.push(`For: ${forNode.text}`, "");
  lines.push(
    "Build the scene to this direction. Each choice says what it looks like, what it is " +
      "made with, where it is seen and how to make it; a technique a chosen style calls for " +
      "is listed under its own heading, marked with the style that calls for it.",
    "",
  );
  const calledFor = stylesCalledFor(draft, library);
  const styles = orderedStyles(library, new Set(calledFor.keys()));
  for (const facet of library.facets) {
    const here = styles.filter((style) => style.facet === facet.id);
    if (here.length === 0) continue;
    lines.push(`## ${facet.text}`, "");
    for (const style of here)
      lines.push(...styleLines(style, calledFor.get(style.id) ?? [], library));
    if (lines.at(-1) !== "") lines.push("");
  }
  const loose = styles.filter((style) => style.facet === null);
  if (loose.length > 0) {
    lines.push("## Other styles", "");
    for (const style of loose)
      lines.push(...styleLines(style, calledFor.get(style.id) ?? [], library));
    if (lines.at(-1) !== "") lines.push("");
  }
  if (draft.palette.length > 0)
    lines.push("## Palette", "", ...draft.palette.map((hex) => `- \`${hex}\``), "");
  if (draft.negative.trim() !== "") lines.push("## Avoid", "", draft.negative.trim(), "");
  lines.push(...promptLines(draft, library), ...referenceLines(draft, get));
  return lines.join("\n");
}
