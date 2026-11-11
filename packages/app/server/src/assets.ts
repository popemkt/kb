import { join, normalize } from "node:path";
import { Effect, Option } from "effect";
import type { FileSystem, File } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { assetMediaType } from "@kb/model";
import { containedFile, resolveAssetFile, assetsDir } from "@kb/workspace-fs";
import { bunFileSystemLayer } from "@kb/runtime";
import { DIGEST_NAMED_DIR, keptFile } from "./build-archive.ts";
import { UI_DIST } from "./paths.ts";

/** Resolve Content-Type for a kb asset path; unknown → octet-stream. */
export function assetContentType(absPath: string): string {
  return assetMediaType(absPath) ?? "application/octet-stream";
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
  const contained = yield* containedFile(assetsDir(kbRoot), abs);
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

interface PageFile {
  readonly body: Blob;
  readonly headers: Readonly<Record<string, string>>;
}

type PageFileRead =
  | { readonly kind: "file"; readonly file: PageFile }
  | { readonly kind: "missing" }
  | { readonly kind: "forbidden" };

/** Delivery reads one source; filesystem and held images share the same route/fallback policy. */
interface PageFiles {
  readonly read: (name: string) => Effect.Effect<PageFileRead, never, FileSystem>;
}

function directoryPageFiles(dist: string, builds: string | null): PageFiles {
  const file = (path: string, name: string, info: File.Info): PageFileRead => ({
    kind: "file",
    file: { body: Bun.file(path), headers: staticCacheHeaders(name, info) },
  });
  return {
    read: Effect.fn("kb.ui.directoryPageFile")(function* (name: string) {
      const found = yield* containedFile(dist, join(dist, name));
      if (found.kind === "ok") return file(found.path, name, found.info);
      if (found.kind === "forbidden") return { kind: "forbidden" } as const;
      if (name.startsWith(DIGEST_NAMED_DIR) && builds !== null) {
        const kept = yield* keptFile(builds, name);
        if (kept !== null) return file(kept.path, name, kept.info);
      }
      return { kind: "missing" } as const;
    }),
  };
}

/** Serve one file source through the common SPA, cache and framing policy. */
export const serveStaticEffect = Effect.fn("kb.ui.serveStatic")(function* (
  pathname: string,
  {
    embedOrigins = [],
    builds = null,
    dist = UI_DIST,
    files = directoryPageFiles(dist, builds),
  }: {
    readonly embedOrigins?: readonly string[];
    readonly builds?: string | null;
    readonly dist?: string;
    readonly files?: PageFiles;
  } = {},
) {
  const index = yield* files.read("index.html");
  if (index.kind === "missing") return null as HttpServerResponse.HttpServerResponse | null;
  if (index.kind === "forbidden") return plainStatus("forbidden", 403);
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  // Validate the logical address once, before either source is asked for it.
  const candidate = normalize(join("/", rel));
  if (normalize(rel) === ".." || normalize(rel).startsWith("../") || rel.startsWith("/"))
    return plainStatus("forbidden", 403);
  const name = candidate.slice(1);
  const read = name === "index.html" ? index : yield* files.read(name);
  if (read.kind === "forbidden") return plainStatus("forbidden", 403);
  if (read.kind === "missing" && rel.startsWith(DIGEST_NAMED_DIR))
    return plainStatus("not found", 404);
  const selected = read.kind === "file" ? read.file : index.file;
  return HttpServerResponse.raw(selected.body, {
    status: 200,
    headers: { ...selected.headers, "Content-Security-Policy": frameAncestors(embedOrigins) },
  });
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
