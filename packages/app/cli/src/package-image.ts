/** Installed artifact assembly; neither graph fields nor HTTP requests choose these files. */
import { join, sep } from "node:path";
import { Effect, Option, Predicate, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { loadCodeImage } from "@kb/code-image";
import { containedDirectory, containedFile } from "@kb/workspace-fs";
import type { main } from "./program.ts";

class PackageImageError extends Schema.TaggedError<PackageImageError>()("Kb/PackageImageError", {
  message: Schema.String,
}) {}

const Program = Schema.Struct({
  main: Schema.declare((value: unknown): value is typeof main => Predicate.isFunction(value), {
    expected: "an importable program main",
  }),
});

/** Capture every file in the packaged page closure, then import the captured native artifact once. */
export const loadPackagedProgram = Effect.fn("kb.loadPackagedProgram")(function* (root: string) {
  const fs = yield* FileSystem;
  const pageDir = yield* containedDirectory(root, join(root, "packages/app/ui/dist"));
  if (pageDir === null)
    return yield* new PackageImageError({
      message: "Packaged page directory is missing or not contained",
    });
  const files = new Map<string, Blob>();
  for (const name of yield* fs.readDirectory(pageDir, { recursive: true })) {
    const path = join(pageDir, name);
    const info = yield* fs.stat(path);
    if (info.type === "Directory") {
      const link = yield* fs.readLink(path).pipe(Effect.option);
      if (Option.isSome(link))
        return yield* new PackageImageError({
          message: `Packaged page directory is not contained in the captured tree: ${name}`,
        });
      continue;
    }
    const found = yield* containedFile(pageDir, path);
    if (found.kind !== "ok") {
      return yield* new PackageImageError({
        message: `Packaged page file is not contained: ${name}`,
      });
    }
    files.set(name.split(sep).join("/"), Bun.file(found.path));
  }
  if (!files.has("index.html")) {
    return yield* new PackageImageError({ message: "Packaged page closure has no index.html" });
  }
  const native = yield* containedFile(root, join(root, "program.js"));
  if (native.kind !== "ok") {
    return yield* new PackageImageError({
      message: "Packaged program.js is missing or not contained",
    });
  }
  const held = yield* loadCodeImage(Bun.file(native.path), files);
  const program = yield* Schema.decodeUnknownEffect(Program)(held.module);
  return {
    main: (argv: string[]) => program.main(argv, held.image),
  };
}, Effect.provide(BunFileSystem.layer));
