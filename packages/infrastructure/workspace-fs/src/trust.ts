import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  acquireFileWriteLockEffect,
  releaseFileWriteLock,
  durableReplaceFile,
} from "@kb/file-write";
import { currentData } from "./home.ts";
import { CodeTrust, LegacyTrust } from "@kb/contracts";
import { currentIso, domainError, ensureDomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/** Shared trust and explicit legacy review: DESIGN.md → Sandbox → Trust. */
const TrustRecord = Schema.Struct({
  digest: Schema.String,
  machine: Schema.String,
  at: Schema.String,
});
const TrustFile = Schema.Struct({ version: Schema.Literal(1), trusted: Schema.Array(TrustRecord) });
type TrustFile = typeof TrustFile.Type;

const decodeTrustFile = Schema.decodeUnknownOption(Schema.fromJsonString(TrustFile));

const EMPTY: TrustFile = { version: 1, trusted: [] };

/** Per-user trust has no repository input; machine defaults to this host. */
export function codeTrustLayer(
  machine: string = hostname(),
): Layer.Layer<CodeTrust, never, FileSystem> {
  return Layer.effect(
    CodeTrust,
    Effect.gen(function* () {
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

      return CodeTrust.of({
        trusted: Effect.fn("kb.trust.trusted")(function* (digests: readonly string[]) {
          const current = Option.getOrElse(yield* readFile(file), () => EMPTY);
          const mine = new Set(
            current.trusted
              .filter((record) => record.machine === machine)
              .map((record) => record.digest),
          );
          return digests.filter((digest) => mine.has(digest));
        }),
        trust: Effect.fn("kb.trust.trust")(function* (digest: string) {
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* read;
              if (current.trusted.some((r) => r.digest === digest && r.machine === machine)) return;
              const at = yield* currentIso;
              yield* write({ version: 1, trusted: [...current.trusted, { digest, machine, at }] });
            }),
          );
        }),
        untrust: Effect.fn("kb.trust.untrust")(function* (digest: string) {
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* read;
              const kept = current.trusted.filter(
                (r) => !(r.digest === digest && r.machine === machine),
              );
              if (kept.length === current.trusted.length) return;
              yield* write({ version: 1, trusted: kept });
            }),
          );
        }),
      });
    }),
  );
}

/** Root-controlled bytes are visible only to the explicit legacy review/import surface. */
export function legacyTrustLayer(
  machine: string = hostname(),
): Layer.Layer<LegacyTrust, never, FileSystem> {
  return Layer.effect(
    LegacyTrust,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const digests = Effect.fn("kb.legacyTrust.digests")(function* (root: string) {
        const file = resolve(root, ".kb", "trust.json");
        const text = yield* fs
          .readFileString(file)
          .pipe(
            Effect.catch((error) =>
              isNotFound(error)
                ? Effect.succeed(null)
                : Effect.fail(internal("read legacy trust", error)),
            ),
          );
        if (text === null) return [];
        const decoded = decodeTrustFile(text);
        if (Option.isNone(decoded))
          return yield* domainError("invalid_input", `${file} is not a version-1 trust file`);
        return [
          ...new Set(
            decoded.value.trusted
              .filter((record) => record.machine === machine)
              .map((record) => record.digest),
          ),
        ];
      });
      return LegacyTrust.of({
        digests,
      });
    }),
  );
}
