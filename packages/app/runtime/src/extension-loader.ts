import { EXTENSION_NAME_PATTERN } from "@kb/plugin";
import { Effect, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import * as zod from "zod";
import { decodeExtensionModule } from "@kb/ext-sdk";
import {
  CodeTrust,
  EXTENSION_SDK,
  installHostModules,
  MANIFEST_SUFFIX,
  extensionAdmissionIssue,
  type ExtensionFailure,
  type ExtensionOrigin,
  type LoadedExtension,
  type ExtensionRow,
} from "@kb/contracts";
import { isNotFound } from "@kb/workspace-fs";
import { serverEntriesFor } from "./bundled.ts";
import { BUNDLED_CAPABILITIES } from "@kb/bundled";
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
 * none of its code until they have looked at it. What kb imports is the
 * closure's bytes, imported from themselves rather than from disk, so a
 * file changed after its closure was read is new code nobody has trusted.
 * Reading closures, reading trust and importing are three steps, which
 * `rootFamilies` composes: it bundles once and reads trust on every load.
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

import {
  ownExtensionFolder,
  type ExtensionFolder,
  type ExtensionCandidate,
} from "./extension-folder.ts";
export { ownExtensionFolder } from "./extension-folder.ts";
export type { ExtensionFolder } from "./extension-folder.ts";

const PAGE_ENTRIES = [".page.tsx", ".page.ts"];

/** An extension whose closure was read: its file, its name, its server entry's path, its closure. */
export interface ClosedExtension {
  readonly file: string;
  readonly name: string;
  readonly path: string;
  /** How its folder was selected: the store's own, a link, or an install. */
  readonly origin: ExtensionOrigin;
  readonly closure: DigestedClosure;
}

/** A declaration file, of any module flavour: `.d.ts`, `.d.mts`, `.d.cts`. */
const DECLARATION = /\.d\.[cm]?ts$/;

/** A server entry: `<name>.ts`, neither a declaration file nor a page entry. */
function isServerEntry(file: string): boolean {
  return (
    file.endsWith(".ts") &&
    !DECLARATION.test(file) &&
    !PAGE_ENTRIES.some((suffix) => file.endsWith(suffix))
  );
}

/** The name a page entry is the page half of, or null for a file that is not one. */
function pageOf(file: string): string | null {
  const suffix = PAGE_ENTRIES.find((entry) => file.endsWith(entry));
  return suffix === undefined ? null : file.slice(0, -suffix.length);
}

/** A file a module loader would read as code: script or TypeScript of any flavour. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Whether `file` is code in the extensions directory that is no entry kb
 * discovers (`hello.tsx`, `hello.js`, `hello.page.js`): it would never run,
 * so it is a failure rather than a file nobody looked at. Declarations and
 * anything that is not code (a README, a directory of helpers) are not.
 */
function strayCode(file: string): boolean {
  return (
    CODE_FILE.test(file) && !DECLARATION.test(file) && !isServerEntry(file) && pageOf(file) === null
  );
}

/**
 * The entries of the extensions directory `dir`: null when there is none,
 * and why it cannot be read otherwise, so a directory kb cannot list is a
 * failure, never a root with no extensions.
 */
const entriesOf = Effect.fn("kb.extensionEntries")(function* (
  dir: string,
): Effect.fn.Return<readonly string[] | null, string, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs
    .readDirectory(dir)
    .pipe(
      Effect.catch((error) =>
        isNotFound(error)
          ? Effect.succeed(null)
          : Effect.fail(`.kb/extensions cannot be read: ${error.message}`),
      ),
    );
});

/** Import `code`, a server half, from its own bytes. Fails with the import's message. */
const importClosure = Effect.fn("kb.importClosure")(function* (
  code: string,
): Effect.fn.Return<unknown, string> {
  installHostModules("server", { "kb-ext-sdk": EXTENSION_SDK, zod, "zod/v4": zod });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return yield* Effect.tryPromise({
    try: () => import(url) as Promise<unknown>,
    catch: (err) => (err instanceof Error ? err.message : String(err)),
  });
});

/** The closure of each named extension; each that cannot be closed over is a failure. */
const closed = Effect.fn("kb.extensionClosures")(function* (
  folder: ExtensionFolder,
  entries: readonly string[],
  failures: ExtensionFailure[],
): Effect.fn.Return<ClosedExtension[]> {
  const { dir } = folder;
  const result: ClosedExtension[] = [];
  const servers = entries.filter(isServerEntry).toSorted();
  for (const file of servers) {
    const name = file.slice(0, -".ts".length);
    if (!EXTENSION_NAME_PATTERN.test(name)) {
      failures.push({ file, error: `extension file name must match ${EXTENSION_NAME_PATTERN}` });
      continue;
    }
    const page = entries.find((entry) => pageOf(entry) === name);
    const manifest = entries.includes(`${name}${MANIFEST_SUFFIX}`)
      ? join(dir, `${name}${MANIFEST_SUFFIX}`)
      : null;
    const path = join(dir, file);
    const closure = yield* extensionClosure(
      folder,
      path,
      page === undefined ? null : join(dir, page),
      manifest,
    ).pipe(Effect.result);
    if (Result.isFailure(closure)) failures.push({ file, error: closure.failure });
    else
      result.push({
        file,
        name,
        path,
        origin: folder.provenance ?? { kind: "own" },
        closure: closure.success,
      });
  }
  for (const file of entries) {
    const name = pageOf(file);
    if (name !== null && !servers.includes(`${name}.ts`)) {
      failures.push({ file, error: `a page entry of ${name}, which has no ${name}.ts` });
    }
    const described = file.endsWith(MANIFEST_SUFFIX)
      ? file.slice(0, -MANIFEST_SUFFIX.length)
      : null;
    if (described !== null && !servers.includes(`${described}.ts`)) {
      failures.push({ file, error: `the manifest of ${described}, which has no ${described}.ts` });
    }
    if (strayCode(file)) {
      failures.push({
        file,
        error:
          "not an extension entry, so it never runs: an extension is <name>.ts, with its page half <name>.page.tsx or <name>.page.ts",
      });
    }
  }
  return result;
});

/**
 * The closures among `closures` a person has trusted here, read from the
 * root's trust now; each other one is a failure that names its digest and
 * the gesture that trusts it.
 */
export const trustedOf = Effect.fn("kb.trustedExtensions")(function* (
  closures: readonly ClosedExtension[],
): Effect.fn.Return<
  { readonly trusted: readonly ClosedExtension[]; readonly failures: readonly ExtensionFailure[] },
  never,
  CodeTrust
> {
  const digests = new Set(
    yield* (yield* CodeTrust)
      .trusted(closures.map(({ closure }) => closure.digest))
      .pipe(Effect.orElseSucceed(() => [])),
  );
  const trusted = closures.filter(({ closure }) => digests.has(closure.digest));
  const failures = closures
    .filter(({ closure }) => !digests.has(closure.digest))
    .map(({ file, closure }) => ({
      file,
      error:
        `not trusted on this machine (${closure.digest}); trust it with sandbox.trust once you ` +
        "have read it and every file it loads: it runs with the owner's power, on the server and in the page",
    }));
  return { trusted, failures };
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
  const dir = extensionsDir(root);
  const entries = (yield* entriesOf(dir)) ?? [];
  const name = file.slice(0, -".ts".length);
  const failures: ExtensionFailure[] = [];
  const own = entries.filter(
    (entry) => entry === file || pageOf(entry) === name || entry === `${name}${MANIFEST_SUFFIX}`,
  );
  const [found] = yield* closed(ownExtensionFolder(root), own, failures);
  if (found !== undefined) return found.closure;
  return yield* Effect.fail(
    failures.map(({ error }) => error).join("; ") || `no extension ${file}`,
  );
});

/**
 * The closures in the ordered folders, each bundled now; each that cannot
 * be closed over is a failure. Nothing of them has run.
 */
export const readClosures = Effect.fn("kb.readClosures")(function* (
  folders: readonly ExtensionCandidate[],
): Effect.fn.Return<
  {
    readonly closures: readonly ClosedExtension[];
    readonly failures: readonly ExtensionFailure[];
    readonly rows: readonly ExtensionRow[];
  },
  never,
  FileSystem
> {
  const closures: ClosedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  const rows: ExtensionRow[] = [];
  const selected = new Map<string, string>();
  for (const folder of folders) {
    if ("kind" in folder) {
      const winner = selected.get(folder.name);
      rows.push({
        name: folder.name,
        label: folder.name,
        enabled: false,
        source: folder.name,
        origin: folder.origin,
        ...(folder.origin.kind === "install"
          ? { files: folder.origin.selection.locked.files }
          : {}),
        ...(winner === undefined ? {} : { shadowed: winner }),
      });
      if (winner === undefined) selected.set(folder.name, folder.name);
      failures.push({
        file: folder.name,
        error: winner === undefined ? folder.error : `shadowed by ${winner}`,
      });
      continue;
    }
    const { dir, origin } = folder;
    const entries = yield* entriesOf(dir).pipe(Effect.result);
    if (Result.isFailure(entries)) {
      failures.push({ file: dir, error: entries.failure });
      continue;
    }
    if (entries.success === null) continue;
    const visible = entries.success.filter((file) => {
      const name = isServerEntry(file) ? file.slice(0, -3) : pageOf(file);
      const winner = name === null ? undefined : selected.get(name);
      if (isServerEntry(file))
        rows.push({
          name: file.slice(0, -3),
          label: file.slice(0, -3),
          enabled: false,
          source: join(dir, file),
          origin: folder.provenance ?? { kind: "own" },
          ...(folder.provenance?.kind === "install"
            ? { files: folder.provenance.selection.locked.files }
            : {}),
          ...(winner === undefined ? {} : { shadowed: winner }),
        });
      if (winner === undefined) return true;
      if (isServerEntry(file))
        failures.push({
          file: join(dir, file),
          error: `shadowed by ${winner}; hidden from ${origin}`,
        });
      return false;
    });
    // Reserve names before bundling or trust: a broken or untrusted nearer entry still wins.
    for (const file of visible.filter(isServerEntry))
      selected.set(file.slice(0, -3), join(dir, file));
    const local: ExtensionFailure[] = [];
    closures.push(...(yield* closed(folder, visible, local)));
    failures.push(
      ...local.map(({ file, error }) => ({ file: join(dir, file), error: `${origin}: ${error}` })),
    );
  }
  return {
    closures,
    failures,
    rows: rows.map((row) => {
      const found = closures.find((entry) => entry.path === row.source);
      return found === undefined
        ? row
        : {
            ...row,
            digest: found.closure.digest,
            reach: found.closure.reach,
            ...(found.closure.about === null ? {} : { manifest: found.closure.about }),
          };
    }),
  };
});

/**
 * Import the server half of each of `closures`, ones a person trusted, and
 * decode each as a family; each that does not load is a failure.
 */
export const importClosures = Effect.fn("kb.importClosures")(function* (
  closures: readonly ClosedExtension[],
): Effect.fn.Return<{ extensions: LoadedExtension[]; failures: ExtensionFailure[] }> {
  const extensions: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  for (const { file, name, path, origin, closure } of closures) {
    const issue = extensionAdmissionIssue(
      name,
      closure.about ?? undefined,
      BUNDLED_CAPABILITIES,
      closure.page === null ? ["registry"] : ["registry", "page"],
    );
    if (issue !== null) {
      failures.push({ file, error: issue });
      continue;
    }
    const loaded = yield* importClosure(closure.server).pipe(Effect.result);
    if (Result.isFailure(loaded)) {
      failures.push({ file, error: loaded.failure });
      continue;
    }
    const decoded = decodeExtensionModule(loaded.success, name, {
      digest: closure.digest,
      manifest: closure.about ?? undefined,
    });
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
      origin,
      digest: closure.digest,
      ...(closure.page === null ? {} : { page: closure.page }),
    });
  }
  return { extensions, failures };
});
