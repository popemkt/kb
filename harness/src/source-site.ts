/** `GAP [[id]]`, the marker grammar shared with `kb check gaps` (`ext.check.gaps`). */
const GAP_MARKER = /GAP \[\[([^\]]+)\]\]/;

/**
 * The 1-based line an offset falls on, and the gap marker that line carries:
 * on the line itself, or on the line above when that line is a comment of its
 * own. A trailing marker belongs to its own line.
 */
export function sourceSiteAt(source: string, lines: readonly string[], offset: number) {
  const index = source.slice(0, offset).split("\n").length - 1;
  const text = lines[index] ?? "";
  const above = lines[index - 1]?.trimStart() ?? "";
  const marker = GAP_MARKER.exec(text) ?? (above.startsWith("//") ? GAP_MARKER.exec(above) : null);
  return { line: index + 1, gap: marker?.[1] };
}
