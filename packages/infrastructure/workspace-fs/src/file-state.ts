/** Config files use the store's watch-and-poll sampler without creating any state. */
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { dirname } from "node:path";
import { Effect, Stream } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { fingerprintChanges } from "@kb/contracts";

export function watchedFileState(paths: readonly string[], fs: FileSystem) {
  const fingerprint = Effect.gen(function* () {
    const marks: string[] = [];
    for (const path of paths)
      marks.push(
        yield* fs.readFile(path).pipe(
          Effect.match({
            onFailure: () => "unreadable",
            onSuccess: (bytes) => createHash("sha256").update(bytes).digest("hex"),
          }),
        ),
      );
    return JSON.stringify(paths.map((path, index) => [path, marks[index]]));
  });
  const changes = fingerprintChanges({
    directories: [...new Set(paths.map(dirname))],
    watch,
    fingerprint,
  }).pipe(Stream.map(() => undefined));
  return { fingerprint, changes };
}
