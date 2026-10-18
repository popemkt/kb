import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";

/**
 * A root-relative path as an absolute one, or undefined when it is empty,
 * absolute, or leaves the root: everything the family reads is a file of the
 * repository it audits.
 */
export function pathInRoot(root: string, candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate === "" || isAbsolute(candidate)) return undefined;
  const rootPath = resolve(root);
  const path = resolve(rootPath, candidate);
  const rel = relative(rootPath, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return path;
}

/** True when the path names a regular file. */
export const isFile = Effect.fn("ext.check.isFile")(function* (path: string | undefined) {
  if (path === undefined) return false;
  const fs = yield* FileSystem;
  if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false)))) return false;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false),
  );
});
