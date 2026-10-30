import { isAbsolute, relative } from "node:path";
import { Effect, Option } from "effect";
import { FileSystem, type File } from "effect/FileSystem";

/** Where a path inside a directory stands once its links are followed. */
export type ContainedFile =
  | { readonly kind: "ok"; readonly path: string; readonly info: File.Info }
  | { readonly kind: "missing" }
  | { readonly kind: "forbidden" };

function isPathInside(rootReal: string, targetReal: string): boolean {
  const rel = relative(rootReal, targetReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Canonical-path containment: `candidate`'s real path must stay under
 * `rootDir`'s and name a regular file. A link out of the directory, or
 * anything that is not a file, is forbidden; a path that resolves to
 * nothing is missing. Every reader of a directory kb serves from (the
 * assets, the built page) asks this one question.
 */
export const containedFile = Effect.fn("kb.fs.containedFile")(function* (
  rootDir: string,
  candidate: string,
): Effect.fn.Return<ContainedFile, never, FileSystem> {
  const fs = yield* FileSystem;
  const rootReal = yield* fs.realPath(rootDir).pipe(Effect.option);
  if (Option.isNone(rootReal)) return { kind: "missing" };
  const fileReal = yield* fs.realPath(candidate).pipe(Effect.option);
  if (Option.isNone(fileReal)) return { kind: "missing" };
  if (!isPathInside(rootReal.value, fileReal.value)) return { kind: "forbidden" };
  const info = yield* fs.stat(fileReal.value).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") return { kind: "forbidden" };
  return { kind: "ok", path: fileReal.value, info: info.value };
});
