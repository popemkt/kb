/**
 * A repository extension's closure (DESIGN.md → Core boundary & extensions
 * → repository extensions): each half, the server entry `<name>.ts` and the
 * page entry `<name>.page.tsx`, bundled from its files into one module, so
 * every file it loads at any depth is inlined, however it is resolved (a
 * relative path, a tsconfig path, a package import, a package, a link). What
 * it imports from kb (`HOST_MODULES`) is not inlined: it reads the host's own
 * module at run time. The digest a person trusts is the closure's
 * (`extensionDigest`), and the bytes a host runs are exactly its bytes.
 *
 * Code the bundle cannot see is refused, read over the bundled output:
 * a global that loads or evaluates code (`eval`, `Function`, a `Worker`,
 * `import.meta.require` and `import.meta.resolve`, which is what a `require`
 * of a name the bundler cannot follow becomes), an `import()` of a computed
 * name, and an import left for the host to resolve that is not a builtin,
 * or is one that loads code (`module`, `vm`, `worker_threads`). What the
 * approved bytes do by reflection (`globalThis[name]`) no reading of them
 * decides; the digest still holds them to what was approved.
 */
import { builtinModules } from "node:module";
import { Effect } from "effect";
import { HOST_MODULES, HOST_MODULES_KEY, type ExtensionHalf } from "@kb/contracts";
import { extensionDigest, type ExtensionClosure } from "@kb/sandbox";
import { computedImports } from "./computed-imports.ts";

/** What Bun builds each half for. */
const TARGETS: Readonly<Record<ExtensionHalf, "bun" | "browser">> = {
  server: "bun",
  page: "browser",
};

/** The globals that load or evaluate code, each replaced by a marker the output check refuses. */
const LOADERS: Readonly<Record<string, string>> = {
  eval: "eval",
  Function: "the Function constructor",
  Worker: "a Worker",
  "import.meta.require": "a require the bundle cannot follow",
  "import.meta.resolve": "import.meta.resolve",
};
const MARKER = "__kb_loads_code_";
const markerOf = (global: string) => `${MARKER}${global.replaceAll(".", "_")}`;
const MARKERS = new Map(
  Object.entries(LOADERS).map(([global, what]) => [markerOf(global), what] as const),
);

/** The builtins that load code: an import of one is code the bundle cannot see. */
const CODE_LOADING_BUILTINS = new Set(["module", "vm", "worker_threads"]);

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Each host module, read from the host at run time rather than inlined. */
function hostModules(half: ExtensionHalf): Bun.BunPlugin {
  const filter = new RegExp(`^(${HOST_MODULES[half].map(escaped).join("|")})$`);
  return {
    name: "kb-host-modules",
    setup(build) {
      build.onResolve({ filter }, ({ path }) => ({ path, namespace: "kb-host" }));
      build.onLoad({ filter: /.*/, namespace: "kb-host" }, ({ path }) => ({
        contents: `module.exports = globalThis[Symbol.for(${JSON.stringify(HOST_MODULES_KEY)})](${JSON.stringify(path)});`,
        loader: "js",
      }));
    },
  };
}

/** Why `code`, a bundled half, runs code its bundle does not hold, or null. */
function unseenCode(code: string, half: ExtensionHalf): string | null {
  for (const [marker, what] of MARKERS) {
    if (code.includes(marker)) return `uses ${what}, which loads code the bundle cannot see`;
  }
  const [computed] = computedImports(code);
  if (computed !== undefined) {
    const at = code.slice(computed, computed + 60);
    return `imports a computed name (${at}…), which the bundle cannot see`;
  }
  const left = new Bun.Transpiler({ loader: "js" }).scanImports(code).map(({ path }) => path);
  for (const specifier of left) {
    const name = specifier.replace(/^node:/, "");
    const builtin =
      half === "server" &&
      (builtinModules.includes(name) || name === "bun" || name.startsWith("bun:"));
    if (!builtin) return `imports ${specifier}, which the bundle does not hold`;
    if (CODE_LOADING_BUILTINS.has(name)) {
      return `imports ${specifier}, which loads code the bundle cannot see`;
    }
  }
  return null;
}

/** One half of the extension at `entry`, bundled with what it loads, or why it cannot run. */
const bundleHalf = Effect.fn("kb.bundleExtensionHalf")(function* (
  entry: string,
  half: ExtensionHalf,
  root: string,
): Effect.fn.Return<string, string> {
  const built = yield* Effect.promise(() =>
    Bun.build({
      entrypoints: [entry],
      root,
      target: TARGETS[half],
      format: "esm",
      // No whitespace and no comments: Bun names each module by its path from
      // the process's working directory, which is no part of what runs.
      minify: { whitespace: true, syntax: false, identifiers: false },
      throw: false,
      jsx: { runtime: "automatic", importSource: "react", development: false },
      define: {
        ...Object.fromEntries(Object.keys(LOADERS).map((global) => [global, markerOf(global)])),
        ...(half === "page" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {}),
      },
      plugins: [hostModules(half)],
    }),
  );
  const [output] = built.outputs;
  if (!built.success || output === undefined || built.outputs.length !== 1) {
    const why = built.logs.map((log) => log.message).join("; ");
    return yield* Effect.fail(`its ${half} half does not bundle: ${why}`);
  }
  const code = yield* Effect.promise(() => output.text());
  const unseen = unseenCode(code, half);
  if (unseen !== null) return yield* Effect.fail(`its ${half} half ${unseen}`);
  return code;
});

/** A closure, with the digest a person trusts it by. */
export interface DigestedClosure extends ExtensionClosure {
  readonly digest: string;
}

/**
 * The closure of the extension whose server entry is `server` and whose page
 * entry, when it has one, is `page`, each bundled relative to `root` (its
 * extensions directory), with its digest; or why it cannot run.
 */
export const extensionClosure = Effect.fn("kb.extensionClosure")(function* (
  root: string,
  server: string,
  page: string | null,
): Effect.fn.Return<DigestedClosure, string> {
  const closure: ExtensionClosure = {
    server: yield* bundleHalf(server, "server", root),
    page: page === null ? null : yield* bundleHalf(page, "page", root),
  };
  return { ...closure, digest: yield* extensionDigest(closure) };
});
