/**
 * The families a root composes (DESIGN.md → Extension families): every
 * bundled one, then each repository extension its `.kb/extensions` holds,
 * each with the plugin the registry loads for it and where it came from.
 * This is the one list the registry decides from, so a repository
 * extension is switched, reported and loaded by the rule a bundled family
 * is, and the one list the root's store is seeded from (`declarations`), so
 * its node, its switch and its settings are that store's nodes.
 */
import { basename } from "node:path";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  extensionPagePath,
  familyOn,
  type ExtensionDeclaration,
  type ExtensionFailure,
  type LoadedExtension,
  type NodeLookup,
} from "@kb/contracts";
import { foldSeed } from "@kb/model";
import { BUNDLED_EXTENSIONS } from "./bundled.ts";
import { codeTrustLayer } from "@kb/workspace-fs";
import { importClosures, readClosures, trustedOf } from "./extension-loader.ts";

export interface RootFamilies {
  readonly families: readonly LoadedExtension[];
  /**
   * What the root's store is seeded from (DESIGN.md → Extension families →
   * the seed is the root's fold): the bundled declarations, then each of
   * its repository extensions'.
   */
  readonly declarations: readonly ExtensionDeclaration[];
  /** The repository modules discovery refused, each skipped. */
  readonly failures: readonly ExtensionFailure[];
}

const BUNDLED: readonly LoadedExtension[] = BUNDLED_EXTENSIONS.map((family) => ({
  ...family,
  source: "bundled",
}));

/**
 * The repository extensions whose declarations fold beside the bundled ones
 * and those admitted before them, in file order. One that does not (its name
 * is a bundled family's, so its node is declared twice; a seed id another
 * declaration holds; a seed that returns something other than nodes) is
 * refused like a module that fails to load, so it is neither seeded nor
 * loaded: a repository extension never stops core from opening.
 */
function admitted(extensions: readonly LoadedExtension[]): {
  readonly extensions: readonly LoadedExtension[];
  readonly failures: readonly ExtensionFailure[];
} {
  const accepted: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  for (const extension of extensions) {
    const declarations = [...accepted, extension].map(({ declaration }) => declaration);
    try {
      foldSeed([...BUNDLED_DECLARATIONS, ...declarations]);
      accepted.push(extension);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      failures.push({
        file: basename(extension.source),
        error: `its declaration does not fold beside the others: ${why}`,
      });
    }
  }
  return { extensions: accepted, failures };
}

/** Each root's closures: bundled once, for the process lifetime (an extension changed on disk needs a restart). */
const closureCache = new Map<
  string,
  Effect.Effect<Effect.Success<ReturnType<typeof readClosures>>, never, FileSystem>
>();
/** Each root's families, per set of closures trusted there: importing one runs its module code. */
const familiesCache = new Map<string, Effect.Effect<RootFamilies>>();

/**
 * The families `root` composes; with no root, the bundled ones alone. Its
 * closures are read once per root, and which of them a person trusted is
 * read from the root's record on every call, so `sandbox.trust` and
 * `sandbox.untrust` take effect in the process that runs them: a newly
 * trusted closure is imported, an untrusted one is not a family of the
 * root, so the registry and the page server drop it as they drop a family
 * switched off.
 */
export const rootFamilies = Effect.fn("kb.rootFamilies")(function* (
  root: string | null,
): Effect.fn.Return<RootFamilies, never, FileSystem> {
  // GAP [[01M5C3YK8P5FWDKFD7D7ERFXDH]]
  if (root === null) return { families: BUNDLED, declarations: BUNDLED_DECLARATIONS, failures: [] };
  let reading = closureCache.get(root);
  if (reading === undefined) {
    reading = yield* Effect.cached(readClosures(root));
    closureCache.set(root, reading);
  }
  const read = yield* reading;
  // Which of the root's own extensions a person trusted is the root's record.
  const { trusted, failures: untrusted } = yield* trustedOf(read.closures).pipe(
    Effect.provide(codeTrustLayer(root)),
  );
  const key = [root, ...trusted.map(({ closure }) => closure.digest)].join("\0");
  let composed = familiesCache.get(key);
  if (composed === undefined) {
    composed = yield* Effect.cached(
      importClosures(trusted).pipe(
        Effect.map((imported) => {
          const { extensions, failures } = admitted(imported.extensions);
          return {
            families: [...BUNDLED, ...extensions],
            declarations: [
              ...BUNDLED_DECLARATIONS,
              ...extensions.map(({ declaration }) => declaration),
            ],
            failures: [...imported.failures, ...failures],
          };
        }),
      ),
    );
    familiesCache.set(key, composed);
  }
  const families = yield* composed;
  return { ...families, failures: [...read.failures, ...untrusted, ...families.failures] };
});

/**
 * The page half the `kb ui` server serves at `path` (`extensionPagePath`),
 * or null: the bytes of a closure a person trusted, addressed by its
 * digest, of a family `root`'s store (`nodeOf`) has on. Both are read
 * again on every request, so an untrusted or switched-off family's page
 * half is not served.
 */
export const servedPage = Effect.fn("kb.servedPage")(function* (
  root: string,
  path: string,
  nodeOf: NodeLookup,
): Effect.fn.Return<string | null, never, FileSystem> {
  const { families } = yield* rootFamilies(root);
  const served = families.find(
    ({ declaration, digest, page }) =>
      page !== undefined &&
      digest !== undefined &&
      extensionPagePath(digest) === path &&
      familyOn(declaration, nodeOf, () => {}),
  );
  return served?.page ?? null;
});

/** Test hook: forget every root's closures and families, so a fresh root is discovered again. */
export function resetRootFamilies(): void {
  closureCache.clear();
  familiesCache.clear();
}
