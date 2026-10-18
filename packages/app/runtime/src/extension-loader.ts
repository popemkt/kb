import { Effect, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import * as zod from "zod";
import { decodeExtensionModule } from "@kb/ext-sdk";
import {
  CodeTrust,
  EXTENSION_SDK,
  installHostModules,
  type ExtensionFailure,
  type LoadedExtension,
} from "@kb/contracts";
import { serverEntriesFor } from "./bundled.ts";
import { extensionClosure, type DigestedClosure } from "./extension-closure.ts";

/**
 * Extension loader: discovers the extensions in `.kb/extensions/`, each a
 * server entry `<name>.ts` and, when it has one, a page entry
 * `<name>.page.tsx` (or `.page.ts`), bundles each into its closure
 * (`extensionClosure`), and imports the server half of each closure a
 * person has trusted. Each one is a family as a bundled one is: its
 * declaration and its server entry, paired by name as a bundled family's
 * are (`serverEntriesFor`), and its page half, which the `kb ui` server
 * serves to the page. Loader failures warn and skip the offending file;
 * they never crash core.
 *
 * What a module must export is @kb/ext-sdk's contract, decoded by
 * `decodeExtensionModule` — this file's job is discovery and the per-file
 * error report, not a second copy of the shape.
 *
 * An approved extension runs with the owner's power, so its closure runs
 * only once a person has trusted its digest on this machine (`CodeTrust`,
 * the record sandboxed code is trusted in, and `sandbox.trust` the
 * gesture). An untrusted one is skipped with its digest, so whoever opens a
 * root someone else wrote — a location opened for an agent, a clone — runs
 * none of its code until they have looked at it. What runs is the closure's
 * bytes, imported from themselves rather than from disk, so a file changed
 * after its closure was read is new code nobody has trusted.
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

const NAME_RE = /^[\w][\w.-]*$/;
const PAGE_ENTRIES = [".page.tsx", ".page.ts"];

/** An extension whose closure was read: its file, its name, its server entry's path, its closure. */
interface Closed {
  readonly file: string;
  readonly name: string;
  readonly path: string;
  readonly closure: DigestedClosure;
}

/** A server entry: `<name>.ts`, neither a declaration file nor a page entry. */
function isServerEntry(file: string): boolean {
  return (
    file.endsWith(".ts") &&
    !file.endsWith(".d.ts") &&
    !PAGE_ENTRIES.some((suffix) => file.endsWith(suffix))
  );
}

/** The name a page entry is the page half of, or null for a file that is not one. */
function pageOf(file: string): string | null {
  const suffix = PAGE_ENTRIES.find((entry) => file.endsWith(entry));
  return suffix === undefined ? null : file.slice(0, -suffix.length);
}

/** Import `code`, a server half, from its own bytes. Fails with the import's message. */
const importClosure = Effect.fn("kb.importClosure")(function* (
  code: string,
): Effect.fn.Return<unknown, string> {
  installHostModules("server", { "kb-ext-sdk": EXTENSION_SDK, zod });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return yield* Effect.tryPromise({
    try: () => import(url) as Promise<unknown>,
    catch: (err) => (err instanceof Error ? err.message : String(err)),
  });
});

/** The closure of each named extension; each that cannot be closed over is a failure. */
const closed = Effect.fn("kb.extensionClosures")(function* (
  dir: string,
  entries: readonly string[],
  failures: ExtensionFailure[],
): Effect.fn.Return<Closed[]> {
  const result: Closed[] = [];
  const servers = entries.filter(isServerEntry).toSorted();
  for (const file of servers) {
    const name = file.slice(0, -".ts".length);
    if (!NAME_RE.test(name)) {
      failures.push({ file, error: "extension file name must match /^[\\w][\\w.-]*$/" });
      continue;
    }
    const page = entries.find((entry) => pageOf(entry) === name);
    const path = join(dir, file);
    const closure = yield* extensionClosure(
      dir,
      path,
      page === undefined ? null : join(dir, page),
    ).pipe(Effect.result);
    if (Result.isFailure(closure)) failures.push({ file, error: closure.failure });
    else result.push({ file, name, path, closure: closure.success });
  }
  for (const file of entries) {
    const name = pageOf(file);
    if (name !== null && !servers.includes(`${name}.ts`)) {
      failures.push({ file, error: `a page entry of ${name}, which has no ${name}.ts` });
    }
  }
  return result;
});

/**
 * The closures among `closures` a person has trusted here; each other one
 * is a failure that names its digest and the gesture that trusts it.
 */
const trustedClosures = Effect.fn("kb.trustedExtensions")(function* (
  closures: readonly Closed[],
  failures: ExtensionFailure[],
): Effect.fn.Return<Closed[], never, CodeTrust> {
  const trusted = new Set(
    yield* (yield* CodeTrust)
      .trusted(closures.map(({ closure }) => closure.digest))
      .pipe(Effect.orElseSucceed(() => [])),
  );
  return closures.filter(({ file, closure }) => {
    if (trusted.has(closure.digest)) return true;
    failures.push({
      file,
      error:
        `not trusted on this machine (${closure.digest}); trust it with sandbox.trust once you ` +
        "have read it and every file it loads: it runs with the owner's power, on the server and in the page",
    });
    return false;
  });
});

/**
 * The closure of the extension `file` (`<name>.ts`) of `root`, read as
 * discovery reads it, with the digest a person trusts it by; or why it
 * cannot run.
 */
export const closureOf = Effect.fn("kb.closureOf")(function* (
  root: string,
  file: string,
): Effect.fn.Return<DigestedClosure, string, FileSystem> {
  const fs = yield* FileSystem;
  const dir = extensionsDir(root);
  const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const name = file.slice(0, -".ts".length);
  const failures: ExtensionFailure[] = [];
  const own = entries.filter((entry) => entry === file || pageOf(entry) === name);
  const [found] = yield* closed(dir, own, failures);
  if (found !== undefined) return found.closure;
  return yield* Effect.fail(
    failures.map(({ error }) => error).join("; ") || `no extension ${file}`,
  );
});

/**
 * Discover, close over and import the trusted extensions of `root`.
 * Per-file failures, untrusted extensions among them, are collected (and
 * skipped); every other module is a family.
 */
export const discoverExtensions = Effect.fn("kb.discoverExtensions")(function* (
  root: string,
): Effect.fn.Return<
  { extensions: LoadedExtension[]; failures: ExtensionFailure[] },
  never,
  FileSystem | CodeTrust
> {
  const fs = yield* FileSystem;
  const dir = extensionsDir(root);
  const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => null));
  if (entries === null) return { extensions: [], failures: [] };

  const extensions: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  const closures = yield* trustedClosures(yield* closed(dir, entries, failures), failures);
  for (const { file, name, path, closure } of closures) {
    const loaded = yield* importClosure(closure.server).pipe(Effect.result);
    if (Result.isFailure(loaded)) {
      failures.push({ file, error: loaded.failure });
      continue;
    }
    const decoded = decodeExtensionModule(loaded.success, name);
    if (Result.isFailure(decoded)) {
      failures.push({ file, error: decoded.failure });
      continue;
    }
    const { declaration, entry } = decoded.success;
    const paired = Result.try({
      try: () => serverEntriesFor([declaration], [entry]),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    });
    if (Result.isFailure(paired)) {
      failures.push({ file, error: paired.failure });
      continue;
    }
    extensions.push({
      declaration,
      entry,
      source: path,
      ...(closure.page === null ? {} : { page: { digest: closure.digest, code: closure.page } }),
    });
  }
  return { extensions, failures };
});
