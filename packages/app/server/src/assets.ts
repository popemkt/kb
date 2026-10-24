import { join, normalize, relative, resolve, isAbsolute } from "node:path";
import { Effect, Option } from "effect";
import { FileSystem, type File } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { resolveAssetFile, assetsDir } from "@kb/workspace-fs";
import { bunFileSystemLayer } from "@kb/runtime";
import { UI_DIST } from "./paths.ts";

const ASSET_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  pdf: "application/pdf",
};

/** Resolve Content-Type for a kb asset path; unknown → octet-stream. */
export function assetContentType(absPath: string): string {
  const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
  return ASSET_MIME[ext] ?? "application/octet-stream";
}

function assetHeaders(abs: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": assetContentType(abs),
    "X-Content-Type-Options": "nosniff",
  };
  // SVG can carry scripts when navigated directly; neuter them.
  if (abs.toLowerCase().endsWith(".svg")) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  }
  return headers;
}

/** Match pre-Effect `new Response(body, { status })` — no Content-Type. */
function plainStatus(body: string, status: number): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.raw(body, { status });
}

function isPathInside(rootReal: string, targetReal: string): boolean {
  const rel = relative(rootReal, targetReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Canonical-path containment: realPath(candidate) must stay under
 * realPath(rootDir) and name a regular file. Symlink escapes → forbidden;
 * missing → missing.
 */
const resolveContainedFile = Effect.fn("kb.ui.resolveContainedFile")(function* (
  rootDir: string,
  candidate: string,
) {
  const fs = yield* FileSystem;
  const rootReal = yield* fs.realPath(rootDir).pipe(Effect.option);
  if (Option.isNone(rootReal)) {
    return { kind: "missing" as const };
  }
  const fileReal = yield* fs.realPath(candidate).pipe(Effect.option);
  if (Option.isNone(fileReal)) {
    return { kind: "missing" as const };
  }
  if (!isPathInside(rootReal.value, fileReal.value)) {
    return { kind: "forbidden" as const };
  }
  const info = yield* fs.stat(fileReal.value).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") {
    return { kind: "forbidden" as const };
  }
  return { kind: "ok" as const, path: fileReal.value, info: info.value };
});

/**
 * Read-only GET for `.kb/assets/*`. Traversal / missing → 403 / 404.
 * Never lists the directory.
 *
 * Effect program. Symlink escapes are blocked by canonical-path containment
 * (`FileSystem.realPath` under the assets root); the file body is served via
 * `Bun.file` at the Bun.serve response boundary.
 */
export const serveKbAssetEffect = Effect.fn("kb.ui.serveKbAsset")(function* (
  kbRoot: string,
  pathname: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, never, FileSystem> {
  const abs = resolveAssetFile(kbRoot, pathname);
  if (abs === null) {
    return plainStatus("forbidden", 403);
  }
  const contained = yield* resolveContainedFile(assetsDir(kbRoot), abs);
  if (contained.kind === "missing") {
    return plainStatus("not found", 404);
  }
  if (contained.kind === "forbidden") {
    return plainStatus("forbidden", 403);
  }
  return HttpServerResponse.raw(Bun.file(contained.path), {
    status: 200,
    headers: assetHeaders(contained.path),
  });
});

/** Promise facade for the WS-free HTTP path / tests. */
export function serveKbAsset(kbRoot: string, pathname: string): Promise<Response> {
  return Effect.runPromise(
    serveKbAssetEffect(kbRoot, pathname).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.map(HttpServerResponse.toWeb),
    ),
  );
}

/**
 * Who may frame the page (DESIGN.md → Surfaces → Embedding the page): its
 * own origin, and the ones `kb ui --embed-origin` names. With none named,
 * only its own, so no other page can lay kb under its gestures.
 */
export function frameAncestors(embedOrigins: readonly string[]): string {
  return `frame-ancestors ${["'self'", ...embedOrigins].join(" ")}`;
}

/**
 * Where the bundler writes its output inside `ui/dist` (the UI's Vite
 * `build.assetsDir`). Every file under it is named by its digest, so its
 * bytes never change under its name.
 */
const DIGEST_NAMED_DIR = "static/";

/**
 * How long a client may keep a `ui/dist` file (DESIGN-UI.md → Delivery): a
 * digest-named file for good, anything else (index.html, the public files,
 * the sandbox frame's script) only after asking whether it changed, which
 * its `ETag` answers with a `304` when it has not.
 */
export function staticCacheHeaders(rel: string, info: File.Info): Record<string, string> {
  if (rel.startsWith(DIGEST_NAMED_DIR)) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  const mtime = Option.match(info.mtime, { onNone: () => 0, onSome: (at) => at.getTime() });
  return {
    "Cache-Control": "no-cache",
    ETag: `W/"${Number(info.size).toString(36)}-${mtime.toString(36)}"`,
  };
}

/**
 * Serve a file from `ui/dist`, or SPA fallback to index.html, saying who
 * may frame it ({@link frameAncestors}) and how long it may be kept
 * ({@link staticCacheHeaders}). Returns null when the UI has not been built.
 */
export const serveStaticEffect = Effect.fn("kb.ui.serveStatic")(function* (
  pathname: string,
  embedOrigins: readonly string[] = [],
) {
  const framing = { "Content-Security-Policy": frameAncestors(embedOrigins) };
  const fs = yield* FileSystem;
  const indexHtml = join(UI_DIST, "index.html");
  // Platform I/O errors become defects; HTTP catchCause maps them to 500.
  if (!(yield* fs.exists(indexHtml).pipe(Effect.orDie))) {
    return null as HttpServerResponse.HttpServerResponse | null;
  }

  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const candidate = normalize(join(UI_DIST, rel));
  const distResolved = resolve(UI_DIST);
  if (candidate !== distResolved && !candidate.startsWith(distResolved + "/")) {
    return plainStatus("forbidden", 403);
  }

  const served = (path: string, inDist: string, info: File.Info) =>
    HttpServerResponse.raw(Bun.file(path), {
      status: 200,
      headers: { ...framing, ...staticCacheHeaders(inDist, info) },
    });

  if (yield* fs.exists(candidate).pipe(Effect.orDie)) {
    const contained = yield* resolveContainedFile(UI_DIST, candidate);
    if (contained.kind === "ok") {
      return served(contained.path, rel, contained.info);
    }
    if (contained.kind === "forbidden") {
      return plainStatus("forbidden", 403);
    }
    // missing after exists: race / broken link — fall through to SPA
  }

  // SPA fallback
  const index = yield* fs.stat(indexHtml).pipe(Effect.orDie);
  return served(indexHtml, "index.html", index);
});

/** Promise facade for the WS-free HTTP path / tests. */
export function serveStatic(pathname: string): Promise<Response | null> {
  return Effect.runPromise(
    serveStaticEffect(pathname).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.map((resp) => (resp === null ? null : HttpServerResponse.toWeb(resp))),
    ),
  );
}

export { UI_DIST };
