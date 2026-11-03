import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Fresh-checkout lifecycle for the built UI (`packages/app/ui/dist`).
 *
 * Production `kb ui` must not depend on a human remembering to build the SPA.
 * On startup it checks whether `ui/dist` is present and meaningfully fresh
 * (source fingerprint vs a cached build marker); only then does it shell out
 * to `bun install && bun run build`. Deterministic and testable: the decision
 * and the build execution are separated, and the marker is written by
 * `ensureUiBuilt` (not the runner) so an install that touches lockfiles cannot
 * create a perpetual-stale loop.
 */

/** Marker file inside `ui/dist` recording the source fingerprint it was built from. */
const BUILD_MARKER = ".kb-build-hash";

/** A build the runner could not complete. */
export class UiBuildError extends Schema.TaggedError<UiBuildError>()("Kb/UiBuildError", {
  message: Schema.String,
}) {}

/** What a `package.json` says that decides what is bundled: its name, its dependencies, its workspaces. */
const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  workspaces: Schema.optional(
    Schema.Union([
      Schema.Array(Schema.String),
      Schema.Struct({ packages: Schema.Array(Schema.String) }),
    ]),
  ),
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest));

const manifestIn = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem;
  const text = yield* fs
    .readFileString(join(dir, "package.json"))
    .pipe(Effect.orElseSucceed(() => ""));
  return Option.getOrUndefined(decodeManifest(text));
});

/** The workspace `dir` is a package of: the nearest directory above it whose manifest names workspaces. */
const workspaceAbove = Effect.fnUntraced(function* (dir: string) {
  for (let at = dirname(dir); at !== dirname(at); at = dirname(at)) {
    const workspaces = (yield* manifestIn(at))?.workspaces;
    if (workspaces !== undefined) {
      return { root: at, globs: "packages" in workspaces ? workspaces.packages : workspaces };
    }
  }
  return null;
});

/** The directories a workspace glob such as `packages/*\/*` names, under `root`. */
const expandGlob = Effect.fnUntraced(function* (root: string, glob: string) {
  const fs = yield* FileSystem;
  let dirs = [root];
  for (const segment of glob.split("/")) {
    if (segment !== "*") {
      dirs = dirs.map((dir) => join(dir, segment));
      continue;
    }
    const next: string[] = [];
    for (const dir of dirs) {
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
      next.push(...names.map((name) => join(dir, name)));
    }
    dirs = next;
  }
  return dirs;
});

/**
 * The packages whose sources the built SPA is made of: the UI's own, and in
 * a workspace every package it depends on as `workspace:`, transitively, as
 * the workspace's manifests say. Outside a workspace, the UI alone.
 */
const bundledPackages = Effect.fnUntraced(function* (uiRoot: string) {
  const workspace = yield* workspaceAbove(uiRoot);
  if (workspace === null) return { base: resolve(uiRoot), packages: [uiRoot], manifests: [] };
  const byName = new Map<string, string>();
  for (const glob of workspace.globs) {
    for (const dir of yield* expandGlob(workspace.root, glob)) {
      const name = (yield* manifestIn(dir))?.name;
      if (name !== undefined) byName.set(name, dir);
    }
  }
  const packages = new Set([resolve(uiRoot)]);
  for (const dir of packages) {
    for (const [name, range] of Object.entries((yield* manifestIn(dir))?.dependencies ?? {})) {
      const depDir = byName.get(name);
      if (range.startsWith("workspace:") && depDir !== undefined) packages.add(resolve(depDir));
    }
  }
  return {
    base: workspace.root,
    packages: [...packages],
    // The catalog and the lockfile pin every external dependency's version.
    manifests: [join(workspace.root, "package.json"), join(workspace.root, "bun.lock")],
  };
});

const pathExists = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem;
  return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
});

/** The UI's build configuration: what the bundler reads besides sources. */
function uiConfigInputs(uiRoot: string): string[] {
  return [
    join(uiRoot, "index.html"),
    join(uiRoot, "vite.config.ts"),
    join(uiRoot, "vite.sandbox.config.ts"),
    join(uiRoot, "tsconfig.json"),
  ];
}

/**
 * Deterministic hash over every source input that can change the built
 * bundle: the UI's build configuration, and the manifest and `src/` of every
 * package it bundles ({@link bundledPackages}), with the workspace's catalog
 * and lockfile. Paths are relative to the workspace root and contents are
 * sorted before hashing, so the fingerprint is stable across runs and
 * machines. Anything that does not read as text — a directory, a file this
 * checkout does not have — is not an input.
 */
export const uiSourceFingerprint = Effect.fn("kb.uiSourceFingerprint")(function* (
  uiRoot: string,
): Effect.fn.Return<string, PlatformError, FileSystem> {
  const fs = yield* FileSystem;
  const { base, packages, manifests } = yield* bundledPackages(uiRoot);
  const inputs = [...uiConfigInputs(uiRoot), ...manifests];
  for (const dir of packages) {
    inputs.push(join(dir, "package.json"));
    const srcDir = join(dir, "src");
    if (yield* pathExists(srcDir)) {
      const entries = yield* fs.readDirectory(srcDir, { recursive: true });
      inputs.push(...entries.map((entry) => join(srcDir, entry)));
    }
  }

  const parts = yield* Effect.forEach(inputs, (path) =>
    fs.readFileString(path).pipe(
      Effect.map((text) => `${relative(base, path)}\u0000${text}`),
      Effect.orElseSucceed(() => null),
    ),
  );
  const present = parts.filter((part) => part !== null);
  return String(Bun.hash(present.toSorted().join("\u0001")));
});

function buildMarkerPath(distDir: string): string {
  return join(distDir, BUILD_MARKER);
}

export const readBuildMarker = Effect.fn("kb.readBuildMarker")(function* (
  distDir: string,
): Effect.fn.Return<string | null, never, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs.readFileString(buildMarkerPath(distDir)).pipe(Effect.orElseSucceed(() => null));
});

export const writeBuildMarker = Effect.fn("kb.writeBuildMarker")(function* (
  distDir: string,
  fingerprint: string,
): Effect.fn.Return<void, PlatformError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(distDir, { recursive: true });
  yield* fs.writeFileString(buildMarkerPath(distDir), fingerprint);
});

/** Why the cached build (if any) cannot be served as-is. */
export type UiBuildState = "missing" | "stale" | "fresh";

/**
 * Fresh-checkout build decision. `missing` = no `index.html` (never built);
 * `stale` = built but the source fingerprint moved on; `fresh` = safe to serve.
 *
 * A `uiRoot` without `package.json` is a packaged layout (e.g. the Nix store):
 * `ui/dist` is baked at build time and no sources exist to rebuild from — a
 * runtime `bun install` there can never succeed (read-only, dep-free). Serve
 * the baked assets as-is.
 */
export const needsUiBuild = Effect.fn("kb.needsUiBuild")(function* (
  uiRoot: string,
  distDir: string,
): Effect.fn.Return<UiBuildState, PlatformError, FileSystem> {
  if (!(yield* pathExists(join(uiRoot, "package.json")))) return "fresh";
  if (!(yield* pathExists(join(distDir, "index.html")))) return "missing";
  const fp = yield* uiSourceFingerprint(uiRoot);
  const marker = yield* readBuildMarker(distDir);
  if (marker === null || marker !== fp) return "stale";
  return "fresh";
});

/**
 * Build execution seam. The default runs the UI package's own build
 * (`bun install && bun run build` — `vp build`); tests inject a fake that
 * produces `dist/index.html` without touching the live checkout.
 */
export type UiBuildRunner = (
  uiRoot: string,
  distDir: string,
) => Effect.Effect<void, UiBuildError, FileSystem>;

const runChild = Effect.fnUntraced(function* (cwd: string, args: string[]) {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = yield* Effect.promise(() => proc.exited);
  if (code !== 0) {
    return yield* new UiBuildError({ message: `${args[0]} exited ${code} (cwd ${cwd})` });
  }
  return code;
});

/** Real production build: install deps, run the UI's `build` script. */
const runProductionBuild: UiBuildRunner = Effect.fn("kb.runProductionBuild")(function* (
  uiRoot: string,
): Effect.fn.Return<void, UiBuildError> {
  yield* runChild(uiRoot, ["bun", "install"]);
  yield* runChild(uiRoot, ["bun", "run", "build"]);
});

export interface UiEnsureResult {
  built: boolean;
  state: UiBuildState;
}

/**
 * Ensure `ui/dist` is buildable: no-op when fresh, otherwise run the build
 * and record the post-build fingerprint as the cache marker.
 */
export const ensureUiBuilt = Effect.fn("kb.ensureUiBuilt")(function* (
  uiRoot: string,
  distDir: string,
  runner: UiBuildRunner = runProductionBuild,
): Effect.fn.Return<UiEnsureResult, PlatformError | UiBuildError, FileSystem> {
  const state = yield* needsUiBuild(uiRoot, distDir);
  if (state === "fresh") return { built: false, state };
  yield* runner(uiRoot, distDir);
  // Marker reflects post-build sources: an install that touched lockfiles is
  // part of the state that produced this dist, so it must not invalidate it.
  yield* writeBuildMarker(distDir, yield* uiSourceFingerprint(uiRoot));
  return { built: true, state };
});
