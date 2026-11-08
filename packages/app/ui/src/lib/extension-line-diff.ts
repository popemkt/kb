/** Bounded line review, computed before approval can become available. */
import { diffLines } from "diff";
import type { extensionDiffDef } from "@kb/operations";
import type { z } from "zod";

type SourceDiff = z.infer<typeof extensionDiffDef.outputSchema>;
export function extensionLineDiff(diff: SourceDiff) {
  const deadline = performance.now() + 1000;
  const files = diff.files.map((file) => {
    const remaining = deadline - performance.now();
    const changes =
      remaining <= 0
        ? undefined
        : diffLines(file.from ?? "", file.to ?? "", { timeout: remaining, maxEditLength: 10000 });
    let before = 1;
    let after = 1;
    const parts = changes?.map((part) => {
      const at = `${before}:${after}`;
      if (!part.added) before += part.count;
      if (!part.removed) after += part.count;
      return { ...part, at };
    });
    if (parts === undefined)
      throw new Error(
        `Line review exceeded its computation budget for ${file.path}; inspect the source locally before trusting it.`,
      );
    return {
      path: file.path,
      fromMode: file.fromMode,
      toMode: file.toMode,
      parts,
      added: parts.reduce((n, p) => n + (p.added ? p.count : 0), 0),
      removed: parts.reduce((n, p) => n + (p.removed ? p.count : 0), 0),
    };
  });
  return {
    ...diff,
    files,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
  };
}
export type ExtensionLineDiff = ReturnType<typeof extensionLineDiff>;
