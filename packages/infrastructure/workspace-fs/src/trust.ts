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
import { CodeTrust } from "@kb/contracts";
import { currentIso, ensureDomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/** Shared trust and legacy migration: DESIGN.md → Sandbox → Trust. */
const TrustRecord = Schema.Struct({
  digest: Schema.String,
  machine: Schema.String,
  at: Schema.String,
});
const TrustFile = Schema.Struct({ version: Schema.Literal(1), trusted: Schema.Array(TrustRecord) });
type TrustFile = typeof TrustFile.Type;

const decodeTrustFile = Schema.decodeUnknownOption(Schema.fromJsonString(TrustFile));

const EMPTY: TrustFile = { version: 1, trusted: [] };

/** Shared trust, migrating the legacy record under root; machine defaults to this host. */
export function codeTrustLayer(
  root: string,
  machine: string = hostname(),
): Layer.Layer<CodeTrust, never, FileSystem> {
  return Layer.effect(
    CodeTrust,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const file = join(yield* currentData, "trust.json");
      const legacy = resolve(root, ".kb", "trust.json");

      const readFile = Effect.fn("kb.trust.readFile")(function* (path: string) {
        return yield* fs.readFileString(path).pipe(
          Effect.map((text) => Option.getOrElse(decodeTrustFile(text), () => EMPTY)),
          Effect.catch((err) =>
            isNotFound(err) ? Effect.succeed(EMPTY) : Effect.fail(internal("read trust", err)),
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
      const read = Effect.gen(function* () {
        const current = yield* readFile(file);
        const exists = yield* fs
          .exists(legacy)
          .pipe(Effect.mapError((err) => internal("read legacy trust", err)));
        if (!exists) return current;
        const records = new Map(
          current.trusted.map((record) => [`${record.machine}\0${record.digest}`, record]),
        );
        for (const record of (yield* readFile(legacy)).trusted) {
          if (record.machine === machine && !records.has(`${machine}\0${record.digest}`))
            records.set(`${machine}\0${record.digest}`, record);
        }
        const merged: TrustFile = { version: 1, trusted: [...records.values()] };
        yield* write(merged);
        yield* fs
          .remove(legacy)
          .pipe(Effect.mapError((err) => internal("remove migrated trust", err)));
        return merged;
      });
      const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          acquireFileWriteLockEffect(file),
          () => effect,
          (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
        );

      return CodeTrust.of({
        trusted: Effect.fn("kb.trust.trusted")(function* (digests: readonly string[]) {
          return yield* locked(
            Effect.gen(function* () {
              const mine = new Set(
                (yield* read).trusted
                  .filter((record) => record.machine === machine)
                  .map((record) => record.digest),
              );
              return digests.filter((digest) => mine.has(digest));
            }),
          );
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
