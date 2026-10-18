/**
 * Generate the embedded extension SDK ambient declaration text from
 * `packages/contract/ext-sdk/src/surface.ts` via `tsc --emitDeclarationOnly`.
 *
 * Build tooling, not part of the package surface: `src/` is the contract
 * @kb/ext-sdk ships, and a generator that shells out to `tsc` is not that.
 *
 * Run: `bun run gen:ext-sdk`
 * Writes: `packages/contract/ext-sdk/src/sdk-dts.text.ts`
 *
 * `--version <v>` stamps `<v>` instead of package.json's version. Only a
 * build that ships a derived version passes it (`bin/release-bundle <v>`, for
 * a nightly), and only into its own tree: the committed module is always
 * package.json's, which the freshness test holds it to.
 */
import { Effect, Schema } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import type { Scope } from "effect/Scope";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(SCRIPT_DIR, "..");
const KB_ROOT = join(PKG_ROOT, "..", "..", "..");
/** Each ambient module the SDK declares, from the surface file that states it. */
const MODULES = [
  { module: "kb-ext-sdk", file: "surface.ts" },
  { module: "kb-ext-sdk/page", file: "page-surface.ts" },
] as const;
const OUT_MODULE = join(PKG_ROOT, "src", "sdk-dts.text.ts");
const PKG = join(KB_ROOT, "package.json");

export interface GenExtSdkResult {
  dts: string;
  pageDts: string;
  version: string;
}

/** `tsc` could not emit the surface declaration. */
export class ExtSdkEmitError extends Schema.TaggedError<ExtSdkEmitError>()("Kb/ExtSdkEmitError", {
  message: Schema.String,
}) {}

/** Build the ambient `kb-ext-sdk` and `kb-ext-sdk/page` declaration string (no filesystem write). */
export const generateExtSdkDts = Effect.fn("kb.generateExtSdkDts")(function* (
  opts: { version?: string } = {},
): Effect.fn.Return<GenExtSdkResult, PlatformError | ExtSdkEmitError, FileSystem | Scope> {
  const fs = yield* FileSystem;
  const pkg = yield* fs.readFileString(PKG).pipe(Effect.map(parsePackage));
  const version = opts.version ?? pkg.version;

  // Inside the package, so the surfaces' imports (`effect`, `react`) resolve as the package resolves them.
  const work = yield* fs.makeTempDirectoryScoped({ directory: PKG_ROOT, prefix: ".kb-ext-sdk-" });
  {
    for (const { file } of MODULES) {
      yield* fs.copyFile(join(PKG_ROOT, "src", file), join(work, file));
    }
    yield* fs.writeFileString(
      join(work, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            declaration: true,
            emitDeclarationOnly: true,
            outDir: "out",
            strict: true,
            skipLibCheck: true,
            module: "ESNext",
            moduleResolution: "bundler",
            target: "ESNext",
            allowImportingTsExtensions: true,
          },
          files: MODULES.map(({ file }) => file),
        },
        null,
        2,
      ),
    );

    const tsc = join(KB_ROOT, "node_modules/.bin/tsc");
    const result = spawnSync(tsc, ["-p", join(work, "tsconfig.json")], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return yield* new ExtSdkEmitError({
        message: `tsc emit failed:\n${result.stdout}\n${result.stderr}`,
      });
    }

    const declared: string[] = [];
    for (const { module, file } of MODULES) {
      const emitted = yield* fs.readFileString(join(work, "out", file.replace(/\.ts$/u, ".d.ts")));
      // Inside `declare module` every declaration is already ambient, and a
      // surface names another by the module it is declared as.
      const body = stripHeaderComments(emitted)
        .replace(/^export declare /gmu, "export ")
        .replace(/from "\.\/surface\.ts"/gu, 'from "kb-ext-sdk"')
        .trimEnd();
      declared.push([`declare module "${module}" {`, indent(body, 2), "}", ""].join("\n"));
    }
    const [server = "", page = ""] = declared;
    const dts = [
      "/**",
      ` * kb extension SDK — ambient types for .kb/extensions/*.ts`,
      ` * kb ${version}`,
      " * Regenerate: bun run gen:ext-sdk",
      " * Emit to a repo: kb ext sdk --write",
      " *",
      " * Usage, in .kb/extensions/<name>.ts:",
      ' *   /// <reference path="../sdk.d.ts" />',
      ' *   import { definePlugin, defineExtension } from "kb-ext-sdk";',
      ' *   export const declaration = defineExtension({ name: "<name>", label: "…" });',
      " *   export default definePlugin({ name: declaration.name, apply: (ctx) => … });",
      " *",
      ` * The plugin model is Effect's: its types are effect@${pkg.effect}'s, a dev`,
      " * dependency of the extension's repository. Its values are the host's.",
      " */",
      "",
      server,
    ].join("\n");
    const pageDts = [
      "/**",
      ` * kb extension SDK — ambient types for a page half, .kb/extensions/*.page.tsx`,
      ` * kb ${version}`,
      " * Regenerate: bun run gen:ext-sdk",
      " * Emit to a repo: kb ext sdk --write",
      " *",
      " * Usage, in .kb/extensions/<name>.page.tsx:",
      ' *   /// <reference path="../sdk-page.d.ts" />',
      ' *   import { definePlugin } from "kb-ext-sdk";',
      ' *   import { ViewPoint, provideView } from "kb-ext-sdk/page";',
      ' *   export default definePlugin({ name: "<name>", apply: (ctx) => … });',
      " *",
      " * Its types are React's too, a dev dependency of the extension's",
      " * repository. Its values are the page's.",
      " */",
      '/// <reference path="./sdk.d.ts" />',
      "",
      page,
    ].join("\n");

    return { dts, pageDts, version };
  }
});

const PackageJson = Schema.Struct({
  version: Schema.String,
  workspaces: Schema.Struct({ catalog: Schema.Struct({ effect: Schema.String }) }),
});

/** The kb version stamped into the generated header, and the effect its types are. */
function parsePackage(text: string): { readonly version: string; readonly effect: string } {
  const pkg = Schema.decodeUnknownSync(PackageJson)(JSON.parse(text));
  return { version: pkg.version, effect: pkg.workspaces.catalog.effect };
}

/** Write `sdk-dts.text.ts` with the regenerated string constant. */
export const writeExtSdkModule = Effect.fn("kb.writeExtSdkModule")(function* (
  opts: { version?: string } = {},
): Effect.fn.Return<GenExtSdkResult, PlatformError | ExtSdkEmitError, FileSystem | Scope> {
  const fs = yield* FileSystem;
  const { dts, pageDts, version } = yield* generateExtSdkDts(opts);
  const moduleSource = [
    "/**",
    " * GENERATED — do not edit by hand.",
    " * Regenerate: bun run gen:ext-sdk",
    " */",
    `export const KB_SDK_VERSION = ${JSON.stringify(version)} as const;`,
    "export const KB_SDK_DTS: string = " + JSON.stringify(dts) + ";",
    "export const KB_SDK_PAGE_DTS: string = " + JSON.stringify(pageDts) + ";",
    "",
  ].join("\n");
  yield* fs.makeDirectory(dirname(OUT_MODULE), { recursive: true });
  yield* fs.writeFileString(OUT_MODULE, moduleSource);
  return { dts, pageDts, version };
});

function stripHeaderComments(src: string): string {
  return src.replace(/^\/\*[\s\S]*?\*\/\s*/u, "").replace(/^\/\/.*\n/gmu, "");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join("\n");
}

if (import.meta.main) {
  // A generator script is its own composition root: it picks the platform
  // here rather than borrowing @kb/store-jsonl's persistence boundary, which
  // `layer:contract` may not reach.
  const { values } = parseArgs({ options: { version: { type: "string" } } });
  const { version } = await Effect.runPromise(
    Effect.scoped(writeExtSdkModule({ version: values.version })).pipe(
      Effect.provide(BunFileSystem.layer),
    ),
  );
  // oxlint-disable-next-line eslint/no-console -- build script progress line
  console.log(`wrote packages/contract/ext-sdk/src/sdk-dts.text.ts (kb ${version})`);
}
