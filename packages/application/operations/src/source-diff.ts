import { z } from "zod";
import type { SourceFile } from "@kb/extension-source";
export const FileChange = z.object({
  path: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  fromMode: z.string().nullable(),
  toMode: z.string().nullable(),
});
/** One file comparison for offline review and upstream checks. */
export function changedFiles(
  before: readonly SourceFile[],
  after: readonly SourceFile[],
): z.infer<typeof FileChange>[] {
  const left = new Map(before.map((file) => [file.path, file]));
  const right = new Map(after.map((file) => [file.path, file]));
  const decoder = new TextDecoder();
  return [...new Set([...left.keys(), ...right.keys()])].toSorted().flatMap((path) => {
    const a = left.get(path);
    const b = right.get(path);
    if (
      a !== undefined &&
      b !== undefined &&
      a.mode === b.mode &&
      a.bytes.length === b.bytes.length &&
      a.bytes.every((byte, index) => byte === b.bytes[index])
    )
      return [];
    return [
      {
        path,
        from: a === undefined ? null : decoder.decode(a.bytes),
        to: b === undefined ? null : decoder.decode(b.bytes),
        fromMode: a?.mode ?? null,
        toMode: b?.mode ?? null,
      },
    ];
  });
}
