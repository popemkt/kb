import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionFolder } from "./extension-folder.ts";
/**
 * A repository extension's closure (DESIGN.md → Core boundary & extensions
 * → repository extensions): each half, the server entry `<name>.ts` and the
 * page entry `<name>.page.tsx`, bundled from its files into one module, so
 * every file it loads at any depth is inlined, however it is resolved (a
 * relative path, a tsconfig path, a package import, a package, a link). What
 * it imports from kb (`HOST_MODULES`) is not inlined: it reads the host's own
 * module at run time. The digest a person trusts is the closure's
 * (`extensionDigest`), and the closure kb imports is exactly its bytes.
 *
 * A static load the bundle does not hold is refused, read over the bundled
 * output: an import left for the host to resolve that is not a builtin, or
 * is one that loads code (`module`, `vm`, `worker_threads`), and, as plain
 * text (`LOADS_CODE`), every name of a way to load code at run time. That
 * text check is a guard against an author's mistake, not a containment:
 * approved code is the owner's code, and what it loads by reflection
 * (`globalThis[name]`) is not caught, by design (DESIGN.md → Core boundary
 * & extensions → repository extensions).
 */
import { builtinModules } from "node:module";
import { Effect } from "effect";
import {
  ExtensionManifestSchema,
  HOST_MODULES,
  HOST_MODULES_KEY,
  PAGE_CODE_TIERS,
  type ExtensionHalf,
  type ExtensionManifest,
  type ExtensionReach,
} from "@kb/contracts";
import { extensionDigest, type ExtensionClosure } from "@kb/sandbox";

/** What Bun builds each half for. */
const TARGETS: Readonly<Record<ExtensionHalf, "bun" | "browser">> = {
  server: "bun",
  page: "browser",
};

/**
 * What the output check refuses, each read as plain text over the bundled
 * half and named for the refusal. It is an over-approximation of the ways
 * the approved bytes can name code to load, not a parse of them: a match
 * in a string, a comment or a regular expression is refused too, which an
 * author fixes by rewording it.
 */
const LOADS_CODE: readonly (readonly [RegExp, string])[] = [
  [
    /\bimport\s*(?:\/\*[\s\S]*?\*\/\s*)*\((?!\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*\))/,
    "an import() of anything but one string literal",
  ],
  [/\beval\b/, "eval"],
  [/\bFunction\b/, "the Function constructor"],
  [/\bgetBuiltinModule\b/, "getBuiltinModule"],
  [/\bcreateRequire\b/, "createRequire"],
  [/\bWorker\b/, "a Worker"],
  [/\bimport\.meta\.(?:require|resolve)\b/, "import.meta.require or import.meta.resolve"],
  [/\bbun:(?:ffi|jsc)\b/, "bun:ffi or bun:jsc"],
  [/\bset(?:Timeout|Interval)\s*\(\s*["'`]/, "a timer given a string to evaluate"],
];

/** The builtins that load code: an import of one loads code the bundle does not hold. */
const CODE_LOADING_BUILTINS = new Set(["module", "vm", "worker_threads"]);

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Each host module, read from the host at run time rather than inlined. */
function hostModules(half: ExtensionHalf, imported: Set<string>): Bun.BunPlugin {
  const filter = new RegExp(`^(${HOST_MODULES[half].map(escaped).join("|")})$`);
  return {
    name: "kb-host-modules",
    setup(build) {
      build.onResolve({ filter }, ({ path }) => {
        imported.add(path);
        return { path, namespace: "kb-host" };
      });
      build.onLoad({ filter: /.*/, namespace: "kb-host" }, ({ path }) => ({
        contents: `module.exports = globalThis[Symbol.for(${JSON.stringify(HOST_MODULES_KEY)})](${JSON.stringify(path)});`,
        loader: "js",
      }));
    },
  };
}

/** Why `code`, a bundled half, runs code its bundle does not hold, or null. */
function unseenCode(code: string, half: ExtensionHalf, left: readonly string[]): string | null {
  for (const [pattern, what] of LOADS_CODE) {
    const found = pattern.exec(code);
    if (found !== null) {
      const at = code.slice(found.index, found.index + 60);
      return `mentions ${what} (${at}…), which can load code the bundle does not hold`;
    }
  }
  for (const specifier of left) {
    const name = specifier.replace(/^node:/, "");
    const builtin =
      half === "server" &&
      (builtinModules.includes(name) || name === "bun" || name.startsWith("bun:"));
    if (!builtin) return `imports ${specifier}, which the bundle does not hold`;
    if (CODE_LOADING_BUILTINS.has(name)) {
      return `imports ${specifier}, which loads code the bundle does not hold`;
    }
  }
  return null;
}

/** One half of the extension at `entry`, bundled with what it loads, or why it cannot run. */
const bundleHalf = Effect.fn("kb.bundleExtensionHalf")(function* (
  entry: string,
  half: ExtensionHalf,
  folder: ExtensionFolder,
): Effect.fn.Return<
  { code: string; files: { path: string; bytes: number }[]; host: string[]; builtins: string[] },
  string
> {
  // Bun reports metafile inputs relative to the cwd at build start.
  const buildCwd = process.cwd();
  const imported = new Set<string>();
  const configuration: Bun.BuildConfig & { readonly macros: false } = {
    // Supported by the runtime; the pinned older Bun typings omit this capability.
    macros: false,
    entrypoints: [entry],
    root: folder.dir,
    metafile: true,
    target: TARGETS[half],
    format: "esm",
    // No whitespace and no comments: Bun names each module by its path from
    // the process's working directory, which is no part of what runs.
    minify: { whitespace: true, syntax: false, identifiers: false },
    throw: false,
    jsx: { runtime: "automatic", importSource: "react", development: false },
    define: half === "page" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
    plugins: [hostModules(half, imported)],
  };
  const built = yield* Effect.promise(() => Bun.build(configuration));
  const [output] = built.outputs;
  if (!built.success || output === undefined || built.outputs.length !== 1) {
    const why = built.logs.map((log) => log.message).join("; ");
    return yield* Effect.fail(`its ${half} half does not bundle: ${why}`);
  }
  if (folder.contained) {
    const refusal = yield* Effect.try({
      try: () => {
        if (built.metafile === undefined) return "bundle has no input inventory";
        const base = realpathSync(resolve(buildCwd, folder.dir));
        for (const input of Object.keys(built.metafile.inputs)) {
          if (input.startsWith("kb-host:")) continue;
          const path = relative(base, realpathSync(resolve(buildCwd, input)));
          if (path === ".." || path.startsWith("../") || isAbsolute(path))
            return `input escapes its folder: ${input}`;
        }
        return null;
      },
      catch: (error) => String(error),
    });
    if (refusal !== null) return yield* Effect.fail(refusal);
  }
  const code = yield* Effect.promise(() => output.text());
  const imports = new Bun.Transpiler({ loader: "js" }).scanImports(code).map(({ path }) => path);
  const unseen = unseenCode(code, half, imports);
  if (unseen !== null) return yield* Effect.fail(`its ${half} half ${unseen}`);
  const files = yield* Effect.try({
    try: () =>
      Object.keys(built.metafile?.inputs ?? {})
        .filter((path) => !path.startsWith("kb-host:"))
        .map((path) => ({
          path: relative(folder.dir, resolve(buildCwd, path)),
          bytes: statSync(resolve(buildCwd, path)).size,
        })),
    catch: String,
  });
  return {
    code,
    files,
    host: [...imported].toSorted(),
    builtins: imports
      .map((path) => (builtinModules.includes(path) ? `node:${path}` : path))
      .toSorted(),
  };
});

/** A closure, with the digest a person trusts it by and what its manifest says. */
export interface DigestedClosure extends ExtensionClosure {
  readonly digest: string;
  readonly reach: ExtensionReach;
  readonly about: ExtensionManifest | null;
}

/**
 * The manifest at `path`, read as data and checked against the manifest's
 * schema and against what the closure ships (a page half where it says
 * none, or none where it says page code); or why it cannot be.
 */
const readManifest = Effect.fn("kb.readExtensionManifest")(function* (
  path: string,
  page: boolean,
): Effect.fn.Return<{ readonly text: string; readonly about: ExtensionManifest }, string> {
  const text = yield* Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (error) => `its manifest cannot be read: ${String(error)}`,
  });
  const json = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: (error) => `its manifest is not JSON: ${String(error)}`,
  });
  const parsed = ExtensionManifestSchema.safeParse(json);
  if (!parsed.success) {
    const why = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(manifest)"}: ${issue.message}`)
      .join("; ");
    return yield* Effect.fail(`its manifest does not match the manifest's shape: ${why}`);
  }
  const tier = parsed.data.capabilities?.page;
  if (tier !== undefined && PAGE_CODE_TIERS.includes(tier) !== page) {
    return yield* Effect.fail(
      page
        ? `its manifest says its page tier is ${tier}, but it ships a page half`
        : `its manifest says its page tier is ${tier}, but it ships no page half`,
    );
  }
  return { text, about: parsed.data };
});

/**
 * The closure of the extension whose server entry is `server` and whose page
 * entry, when it has one, is `page`, each bundled relative to `root` (its
 * extensions directory), with the manifest file `manifest` when it keeps
 * one, and its digest; or why it cannot run.
 */
export const extensionClosure = Effect.fn("kb.extensionClosure")(function* (
  folder: ExtensionFolder,
  server: string,
  page: string | null,
  manifest: string | null,
): Effect.fn.Return<DigestedClosure, string> {
  const serverHalf = yield* bundleHalf(server, "server", folder);
  const pageHalf = page === null ? null : yield* bundleHalf(page, "page", folder);
  const stated = manifest === null ? null : yield* readManifest(manifest, page !== null);
  const closure: ExtensionClosure = {
    server: serverHalf.code,
    page: pageHalf?.code ?? null,
    manifest: stated?.text ?? null,
  };
  const files = new Map(
    [
      ...serverHalf.files,
      ...(pageHalf?.files ?? []),
      ...(manifest === null || stated === null
        ? []
        : [
            {
              path: relative(folder.dir, manifest),
              bytes: new TextEncoder().encode(stated.text).length,
            },
          ]),
    ].map((file) => [file.path, file]),
  );
  return {
    ...closure,
    about: stated?.about ?? null,
    digest: yield* extensionDigest(closure),
    reach: {
      files: [...files.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
      page: page !== null,
      host: { server: serverHalf.host, page: pageHalf?.host ?? [] },
      builtins: serverHalf.builtins,
    },
  };
});
