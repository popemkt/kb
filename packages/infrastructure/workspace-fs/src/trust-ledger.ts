/** The shared ledger owns file decoding, atomic replacement and cross-process exclusion. */
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  acquireFileWriteLockEffect,
  releaseFileWriteLock,
  durableReplaceFile,
} from "@kb/file-write";
import { watchedFileState } from "./file-state.ts";
import { currentData } from "./home.ts";
import { domainError, ensureDomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";
/** Shared trust and explicit legacy review: DESIGN.md → Sandbox → Trust. */
const TrustRecord = Schema.Struct({
  digest: Schema.String,
  machine: Schema.String,
  at: Schema.String,
  name: Schema.optionalKey(Schema.String),
  files: Schema.optionalKey(Schema.String),
});
const TrustFile = Schema.Struct({ version: Schema.Literal(1), trusted: Schema.Array(TrustRecord) });
export type TrustFile = typeof TrustFile.Type;

export const decodeTrustFile = Schema.decodeUnknownOption(Schema.fromJsonString(TrustFile));

export const EMPTY: TrustFile = { version: 1, trusted: [] };

export const trustLedger = Effect.gen(function* () {
  const fs = yield* FileSystem;
  const file = join(yield* currentData, "trust.json");

  const readFile = Effect.fn("kb.trust.readFile")(function* (path: string) {
    return yield* fs.readFileString(path).pipe(
      Effect.map((text) => decodeTrustFile(text)),
      Effect.catch((err) =>
        isNotFound(err) ? Effect.succeedSome(EMPTY) : Effect.fail(internal("read trust", err)),
      ),
    );
  });
  const write = Effect.fn("kb.trust.write")(function* (next: TrustFile) {
    yield* fs
      .makeDirectory(dirname(file), { recursive: true })
      .pipe(Effect.mapError((err) => internal("create trust directory", err)));
    yield* Effect.try({
      try: () =>
        durableReplaceFile({
          path: file,
          body: `${JSON.stringify(next, null, 2)}\n`,
          mode: 0o600,
        }),
      catch: ensureDomainError,
    });
  });
  const read = readFile(file).pipe(
    Effect.flatMap((decoded) =>
      Effect.fromOption(decoded, () =>
        domainError("internal", `${file} is not a version-1 trust file; move it aside`),
      ),
    ),
  );
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      acquireFileWriteLockEffect(file),
      () => effect,
      (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
    );

  return { file, readFile, read, write, locked, changes: watchedFileState([file], fs).changes };
});
