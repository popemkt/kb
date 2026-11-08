import { Effect, Schema } from "effect";
import { secretRefLabel, type SecretRef } from "@kb/model";

/**
 * Where a process reads a key a secret field refers to (DESIGN.md → Data
 * model → a secret is a reference): kb stores no key, and reads one only
 * through a reference a person wrote, in the process that needs it. A
 * composition root binds it (`kb ui` binds the environment and the platform
 * keychain); the browser never holds one, so it never sees a value.
 */
export interface SecretSource {
  /** The key `ref` names. A failure names the reference, never a value. */
  readonly resolve: (ref: SecretRef) => Effect.Effect<string, SecretError>;
}

/** A reference that cannot be read or written here; failures never include values. */
export class SecretError extends Schema.TaggedError<SecretError>()("Kb/SecretError", {
  message: Schema.String,
}) {}

/** A source that holds no key: every reference fails, naming what it refers to. */
export const NO_SECRETS: SecretSource = {
  resolve: (ref) =>
    Effect.fail(new SecretError({ message: `${secretRefLabel(ref)}: this process reads no keys` })),
};

/**
 * A write capability bound to exactly one trusted reference. Hosts obtain it
 * only after checking the owning binding's machine-local trust. There is no
 * destination argument: a connect action cannot redirect the write.
 */
export interface SecretSink {
  readonly write: (value: string) => Effect.Effect<void, SecretError>;
  /** Forget the value, leaving the reference unset; erasing an unset one succeeds. */
  readonly erase: Effect.Effect<void, SecretError>;
}

/**
 * A source that also keeps: the store a host binds where kb writes a key a
 * person handed it (a pasted client secret, an OAuth refresh token). `place`
 * is where this host keeps a new secret named `name` (the macOS keychain,
 * else the sealed store under the data directory); `sink` writes the one
 * reference it is given, and a kind this host cannot write refuses. Only
 * hosts call `sink`, and only for a reference they chose or have trusted.
 */
export interface SecretStore extends SecretSource {
  readonly place: (name: string) => SecretRef;
  readonly sink: (ref: SecretRef) => SecretSink;
  /** How `place` keeps a secret here, for a person to read (no value). */
  readonly describe: Effect.Effect<string>;
}
