import { constants, openSync, mkdirSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import {
  acquireFileWriteLockEffect,
  releaseFileWriteLock,
  durableReplaceFile,
} from "@kb/file-write";
import { parseEnv } from "node:util";
import { Effect, Predicate } from "effect";
import { SecretError, type SecretSink } from "@kb/contracts";
import { secretRefLabel, type SecretRef } from "@kb/model";

type DotenvRef = Extract<SecretRef, { kind: "dotenv" }>;

const failure = (ref: DotenvRef) =>
  new SecretError({ message: `${secretRefLabel(ref)}: secret file operation failed` });

/** Fresh read, no shell expansion. Symlinks and files readable by others fail. */
export const readDotenvSecret = Effect.fn("kb.secrets.dotenv.read")(function* (ref: DotenvRef) {
  const values = yield* Effect.try({
    try: () => readValues(ref.path),
    catch: () => failure(ref),
  });
  const value = Object.hasOwn(values, ref.name) ? values[ref.name] : undefined;
  if (value === undefined || value === "") return yield* failure(ref);
  return value;
});

function readValues(path: string): Record<string, string> {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("private file required");
    return Object.fromEntries(
      Object.entries(parseEnv(readFileSync(file, "utf8"))).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  } finally {
    closeSync(file);
  }
}

/**
 * Construct after the owning binding's trust check. The resulting capability
 * can write only the exact file and key the trusted reference names.
 */
export function dotenvSecretSink(ref: DotenvRef): SecretSink {
  /** Rewrite the file under its lock with `change` applied to its variables. */
  const rewrite = (change: (values: Record<string, string>) => Record<string, string>) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => mkdirSync(dirname(ref.path), { recursive: true, mode: 0o700 }),
        catch: () => failure(ref),
      });
      yield* Effect.acquireRelease(
        acquireFileWriteLockEffect(ref.path).pipe(Effect.mapError(() => failure(ref))),
        (lockPath) => Effect.sync(() => releaseFileWriteLock(lockPath)),
      );
      yield* Effect.try({
        try: () => {
          let values: Record<string, string>;
          try {
            values = readValues(ref.path);
          } catch (error) {
            if (!Predicate.isObject(error) || !("code" in error) || error.code !== "ENOENT")
              throw error;
            values = {};
          }
          values = change(values);
          const text =
            Object.entries(values)
              .map(([key, entry]) => encodeEntry(key, entry))
              .join("\n") + "\n";
          const decoded = parseEnv(text);
          if (Object.entries(values).some(([key, entry]) => decoded[key] !== entry)) {
            throw new Error("value has no lossless dotenv representation");
          }
          durableReplaceFile({ path: ref.path, body: text, mode: 0o600 });
        },
        catch: () => failure(ref),
      });
      return undefined;
    }).pipe(Effect.scoped);
  return {
    write: Effect.fn("kb.secrets.dotenv.write")(function* (value: string) {
      if (/[\r\n\0]/.test(value)) return yield* failure(ref);
      return yield* rewrite((values) => ({ ...values, [ref.name]: value }));
    }),
    erase: rewrite((values) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => key !== ref.name)),
    ),
  };
}

function encodeEntry(key: string, value: string): string {
  const quote = ["'", '"', "`"].find((candidate) => !value.includes(candidate));
  if (quote === undefined) throw new Error("value has no dotenv representation");
  return `${key}=${quote}${value}${quote}`;
}
