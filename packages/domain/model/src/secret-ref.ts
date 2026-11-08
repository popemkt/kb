/**
 * A secret reference: where a key lives, never the key (DESIGN.md → Data
 * model → field types → secret). A field of type `secret` holds one, so a
 * pasted key is refused at write time, before it can reach a committed
 * store. The reference is resolved only by the process that needs the key,
 * through its `SecretSource`.
 *
 * - `dotenv:/absolute/path#KEY` names a variable in a private host file;
 * - `env:NAME` names an environment variable of that process;
 * - `keychain:<service>` or `keychain:<service>/<account>` names a generic
 *   password in the platform's keychain (the macOS keychain, the freedesktop
 *   secret service on Linux);
 * - `sealed:<name>` names a secret in this host's sealed store, encrypted at
 *   rest under the per-user data directory (DESIGN.md → Writable host
 *   secrets). The name is host-relative, as a keychain item's is.
 */
export type SecretRef =
  | { readonly kind: "dotenv"; readonly path: string; readonly name: string }
  | { readonly kind: "env"; readonly name: string }
  | { readonly kind: "keychain"; readonly service: string; readonly account?: string }
  | { readonly kind: "sealed"; readonly name: string };

const ENV = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
const KEYCHAIN = /^keychain:([^\s/]+)(?:\/([^\s/]+))?$/;
/** A sealed secret's name: one path segment, so it is also its file's name. */
const SEALED_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The reference `text` writes, or null when it is not one. */
export function parseSecretRef(text: string): SecretRef | null {
  const dotenv = /^dotenv:(\/[^#\r\n\0]+)#([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (dotenv?.[1] !== undefined && dotenv[2] !== undefined) {
    return { kind: "dotenv", path: dotenv[1], name: dotenv[2] };
  }
  const env = ENV.exec(text);
  if (env?.[1] !== undefined) return { kind: "env", name: env[1] };
  if (text.startsWith("sealed:")) {
    const name = text.slice("sealed:".length);
    return SEALED_NAME.test(name) ? { kind: "sealed", name } : null;
  }
  const keychain = KEYCHAIN.exec(text);
  if (keychain?.[1] === undefined) return null;
  const [, service, account] = keychain;
  return account === undefined
    ? { kind: "keychain", service }
    : { kind: "keychain", service, account };
}

/** How a reference reads in a message: what it names, never a value. */
export function secretRefLabel(ref: SecretRef): string {
  if (ref.kind === "dotenv") return `the dotenv variable ${ref.name} in ${ref.path}`;
  if (ref.kind === "env") return `the environment variable ${ref.name}`;
  if (ref.kind === "sealed") return `the sealed secret ${ref.name}`;
  return ref.account === undefined
    ? `the keychain item ${ref.service}`
    : `the keychain item ${ref.service} (account ${ref.account})`;
}

/** The text that writes `ref`: what {@link parseSecretRef} reads back to it. */
export function formatSecretRef(ref: SecretRef): string {
  if (ref.kind === "dotenv") return `dotenv:${ref.path}#${ref.name}`;
  if (ref.kind === "env") return `env:${ref.name}`;
  if (ref.kind === "sealed") return `sealed:${ref.name}`;
  return ref.account === undefined
    ? `keychain:${ref.service}`
    : `keychain:${ref.service}/${ref.account}`;
}
