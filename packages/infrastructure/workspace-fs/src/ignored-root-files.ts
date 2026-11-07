import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { IgnoredRootFiles } from "@kb/contracts";
import { ensureDomainError } from "@kb/model";
const IGNORED_FILES = [
  {
    file: ".kb/trust.json",
    error: "legacy .kb/trust.json is ignored; trust again or use kb trust import",
  },
] as const;
export const ignoredRootFilesLayer = Layer.effect(
  IgnoredRootFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    return IgnoredRootFiles.of({
      notices: Effect.fn("kb.ignoredRootFiles.notices")(function* (root: string) {
        const notices: { file: string; error: string }[] = [];
        for (const notice of IGNORED_FILES)
          if (yield* fs.exists(join(root, notice.file)).pipe(Effect.mapError(ensureDomainError)))
            notices.push(notice);
        return notices;
      }),
    });
  }),
);
