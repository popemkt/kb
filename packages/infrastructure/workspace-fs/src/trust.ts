import { trustLedger, decodeTrustFile, EMPTY } from "./trust-ledger.ts";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { CodeTrust, LegacyTrust, type TrustProvenance } from "@kb/contracts";
import { currentIso, domainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/** Per-user trust has no repository input; machine defaults to this host. */
export function codeTrustLayer(
  machine: string = hostname(),
): Layer.Layer<CodeTrust, never, FileSystem> {
  return Layer.effect(
    CodeTrust,
    Effect.gen(function* () {
      const { file, readFile, read, write, locked } = yield* trustLedger;
      const records = Effect.gen(function* () {
        const current = Option.getOrElse(yield* readFile(file), () => EMPTY);
        return current.trusted.filter((record) => record.machine === machine);
      });
      return CodeTrust.of({
        records,
        trusted: Effect.fn("kb.trust.trusted")(function* (digests: readonly string[]) {
          const mine = new Set((yield* records).map((record) => record.digest));
          return digests.filter((digest) => mine.has(digest));
        }),
        trust: Effect.fn("kb.trust.trust")(function* (
          digest: string,
          provenance?: TrustProvenance,
        ) {
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* read;
              const existing = current.trusted.find(
                (r) => r.digest === digest && r.machine === machine,
              );
              if (
                existing !== undefined &&
                (provenance === undefined ||
                  (existing.name === provenance.name && existing.files === provenance.files))
              )
                return;
              const at = yield* currentIso;
              yield* write({
                version: 1,
                trusted: [
                  ...current.trusted.filter((r) => r.digest !== digest || r.machine !== machine),
                  { digest, machine, at, ...provenance },
                ],
              });
            }),
          );
        }),
        retain: Effect.fn("kb.trust.retain")(function* (files: readonly string[]) {
          const keptFiles = new Set(files);
          return yield* locked(
            Effect.gen(function* () {
              const current = yield* read;
              const kept = current.trusted.filter(
                (record) =>
                  record.machine !== machine ||
                  record.files === undefined ||
                  keptFiles.has(record.files),
              );
              if (kept.length !== current.trusted.length)
                yield* write({ version: 1, trusted: kept });
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
