import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Assets } from "@kb/contracts";
import { domainError } from "@kb/model";
import { internal } from "./errors.ts";
import { containedFile } from "./contained.ts";
import { ASSETS_URL_PREFIX, assetsDir, resolveAssetFile } from "./paths.ts";

/** `.kb/assets/<id>.<ext>` on a FileSystem, written and read. */
export function assetsLayer(root: string): Layer.Layer<Assets, never, FileSystem> {
  return Layer.effect(
    Assets,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = assetsDir(root);

      return Assets.of({
        write: Effect.fn("kb.assets.write")(function* (id: string, ext: string, bytes: Uint8Array) {
          const relPath = `${ASSETS_URL_PREFIX}${id}.${ext}`;
          const abs = resolveAssetFile(root, relPath);
          if (abs === null) {
            return yield* domainError("forbidden", "refusing to write outside assets dir", {
              id,
              ext,
            });
          }
          yield* fs
            .makeDirectory(dir, { recursive: true })
            .pipe(Effect.mapError((err) => internal(`create ${dir}`, err)));
          yield* fs
            .writeFile(abs, bytes)
            .pipe(Effect.mapError((err) => internal(`write asset ${relPath}`, err)));
          return relPath;
        }),
        read: Effect.fn("kb.assets.read")(function* (path: string, maxBytes: number) {
          const abs = resolveAssetFile(root, path);
          if (abs === null) {
            return yield* domainError("forbidden", `${path} names no file of the assets`, { path });
          }
          const found = yield* containedFile(dir, abs).pipe(Effect.provideService(FileSystem, fs));
          if (found.kind === "missing") {
            return yield* domainError("not_found", `no asset ${path}`, { path });
          }
          if (found.kind === "forbidden") {
            return yield* domainError("forbidden", `${path} leaves the assets`, { path });
          }
          if (Number(found.info.size) > maxBytes) {
            return yield* domainError("invalid_input", `${path} is larger than ${maxBytes} bytes`, {
              path,
              maxBytes,
            });
          }
          const bytes = yield* fs
            .readFile(found.path)
            .pipe(Effect.mapError((err) => internal(`read asset ${path}`, err)));
          // A file that grew since it was measured is still not handed over whole.
          if (bytes.byteLength > maxBytes) {
            return yield* domainError("invalid_input", `${path} is larger than ${maxBytes} bytes`, {
              path,
              maxBytes,
            });
          }
          return bytes;
        }),
      });
    }),
  );
}
