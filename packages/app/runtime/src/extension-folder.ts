import type { ExtensionOrigin } from "@kb/contracts";
import { join } from "node:path";

/** A discovery location, ordered nearest first; contained folders resolve only their own files. */
export interface ExtensionFolder {
  readonly dir: string;
  readonly origin: string;
  readonly contained: boolean;
  readonly provenance?: ExtensionOrigin;
}

/** The root's own code retains normal package and link resolution. */
export function ownExtensionFolder(root: string): ExtensionFolder {
  return { dir: join(root, ".kb", "extensions"), origin: "own", contained: false };
}

/** Installed bytes resolve only within their verified source tree. */
export function installedExtensionFolder(dir: string, origin: string): ExtensionFolder {
  return { dir, origin, contained: true };
}

/** A selected name reserves precedence even when its source cannot be read. */
interface UnavailableExtension {
  readonly kind: "unavailable";
  readonly name: string;
  readonly origin: ExtensionOrigin;
  readonly error: string;
}
export type ExtensionCandidate = ExtensionFolder | UnavailableExtension;
