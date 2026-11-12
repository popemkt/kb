/**
 * What a build of the page is, and the builds a server has served, kept so a
 * tab of an earlier one keeps working (DESIGN-UI.md → Delivery, "A tab
 * outlives its build"). A release replaces `ui/dist`, and a tab opened
 * before it still asks for the chunks it was built with.
 *
 * Each kept build is one directory, written whole under a staging name and
 * published by one rename; after that only its record changes, when a
 * server starts on it again:
 *
 *     <archive>/<build>/static/<file>  the build's digest-named files
 *     <archive>/<build>/build.json     which build, and when a server last started on it
 *
 * A server keeps the build it serves when it starts, then removes the builds
 * beyond the newest {@link KEEP_BUILDS} of those it listed, each whole. So
 * servers sharing one archive never remove a build another just published:
 * it was not in their listing, and a build is never removed in part. One a
 * server restarts on while another prunes it can still go (the GAP at
 * `prune`), costing its tabs a reload after the next release. A digest-named
 * file has the same bytes in every build that has it, so it is served from
 * whichever kept build has it. The archive is a cache: losing it costs a tab
 * of an older build a reload, nothing else.
 */
import { basename, dirname, join, normalize } from "node:path";
import { Clock, Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { writeErr } from "@kb/runtime";
import type { CodeImagePort } from "@kb/contracts";
import { containedFile } from "@kb/workspace-fs";

/**
 * Where the bundler writes its output inside `ui/dist` (the UI's Vite
 * `build.assetsDir`). Every file under it is named by its digest, so its
 * bytes never change under its name.
 */
export const DIGEST_NAMED_DIR = "static/";

/** How many builds a tab may be behind and still have its chunks served. */
const KEEP_BUILDS = 8;

/** A kept build's record, beside its files. */
const RECORD = "build.json";
/** The name a build is written under before it is published; no build is named so. */
const STAGING = ".staging-";
/** A staging directory this old was left by a server that stopped while writing it. */
const ABANDONED_MS = 60 * 60 * 1000;

const BuildRecord = Schema.Struct({
  build: Schema.String,
  at: Schema.Finite,
  files: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const RecordJson = Schema.fromJsonString(BuildRecord);
const decodeRecord = Schema.decodeUnknownOption(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);

/**
 * The build a page's `index.html` loads: the `src` of its module script,
 * whose digest names every chunk it may fetch. Null for a page with none.
 */
export function entryScriptOf(html: string): string | null {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    if (!/\btype=["']?module\b/.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/.exec(tag)?.[1];
    if (src !== undefined) return src;
  }
  return null;
}

/** The build `distDir` serves; null when it holds no built page. */
const buildIn = Effect.fn("kb.ui.builds.buildIn")(function* (distDir: string) {
  const fs = yield* FileSystem;
  const html = yield* fs
    .readFileString(join(distDir, "index.html"))
    .pipe(Effect.orElseSucceed(() => ""));
  return entryScriptOf(html);
});

/** A page build publishes its own digest-named bytes, whatever holds them. */
export interface PageBuildSource {
  readonly entry: Effect.Effect<string | null, PlatformError, FileSystem>;
  readonly write: (directory: string) => Effect.Effect<void, PlatformError, FileSystem>;
}

/** The checkout adapter retains the existing directory-copy publication. */
export function directoryBuildSource(distDir: string): PageBuildSource {
  const digestNamed = join(distDir, DIGEST_NAMED_DIR);
  return {
    entry: Effect.gen(function* () {
      const fs = yield* FileSystem;
      const build = yield* buildIn(distDir);
      return build !== null && (yield* fs.exists(digestNamed)) ? build : null;
    }),
    write: Effect.fn("kb.ui.builds.copyDirectory")(function* (directory: string) {
      const fs = yield* FileSystem;
      yield* fs.copy(digestNamed, directory);
    }),
  };
}

/** Publish only captured bytes; filesystem changes cannot enter this source. */
export function heldBuildSource(image: CodeImagePort): PageBuildSource {
  return {
    entry: Effect.gen(function* () {
      const index = image.pageFile("index.html");
      return index === null ? null : entryScriptOf(yield* Effect.promise(() => index.text()));
    }),
    write: Effect.fn("kb.ui.builds.writeHeld")(function* (directory: string) {
      const fs = yield* FileSystem;
      yield* fs.makeDirectory(directory, { recursive: true });
      for (const name of image.pageNames) {
        if (!name.startsWith(DIGEST_NAMED_DIR) || normalize(name) !== name) continue;
        const body = image.pageFile(name);
        if (body === null) continue;
        const path = join(directory, name.slice(DIGEST_NAMED_DIR.length));
        yield* fs.makeDirectory(dirname(path), { recursive: true });
        const bytes = yield* Effect.promise(() => body.arrayBuffer());
        yield* fs.writeFile(path, new Uint8Array(bytes));
      }
    }),
  };
}

const fileDigest = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** One containment-checked snapshot reader for publication manifests and held historical files. */
const snapshotFiles = Effect.fn("kb.ui.builds.snapshotFiles")(function* (
  root: string,
  directory: string,
  inventory?: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem;
  const files = new Map<string, { readonly body: Blob; readonly digest: string }>();
  const entries =
    inventory === undefined
      ? yield* fs.readDirectory(directory, { recursive: true }).pipe(Effect.orElseSucceed(() => []))
      : Object.keys(inventory);
  for (const name of entries) {
    if (normalize(name) !== name || name.startsWith("..") || name.startsWith("/")) continue;
    const found = yield* containedFile(root, join(directory, name));
    if (found.kind !== "ok") continue;
    const bytes = yield* fs.readFile(found.path).pipe(Effect.option);
    if (Option.isNone(bytes)) continue;
    const digest = fileDigest(bytes.value);
    if (inventory !== undefined && digest !== inventory[name]) continue;
    files.set(name, {
      body: new Blob([bytes.value], { type: Bun.file(found.path).type }),
      digest,
    });
  }
  return files;
});

/** Historical bytes are captured separately; they never become part of the current image identity. */
export const captureKeptFiles = Effect.fn("kb.ui.builds.captureKeptFiles")(function* (
  archive: string,
) {
  const fs = yield* FileSystem;
  const files = new Map<string, Blob>();
  const names = yield* fs.readDirectory(archive).pipe(Effect.orElseSucceed(() => []));
  for (const name of names.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (name.startsWith(STAGING)) continue;
    const text = yield* fs
      .readFileString(join(archive, name, RECORD))
      .pipe(Effect.orElseSucceed(() => ""));
    const record = decodeRecord(text);
    if (Option.isNone(record)) continue;
    // Legacy cache records predate the inventory; retain their existing old-tab delivery policy.
    const snapshot = yield* snapshotFiles(
      archive,
      join(archive, name, DIGEST_NAMED_DIR),
      record.value.files,
    );
    for (const [entry, file] of snapshot) {
      const rel = DIGEST_NAMED_DIR + entry;
      if (!files.has(rel)) files.set(rel, file.body);
    }
  }
  return files;
});

/** A build's directory name: its entry script's, which carries its digest. */
function directoryOf(build: string): string {
  return basename(build)
    .replaceAll(/[^\w.-]/g, "_")
    .replace(/^\./, "_");
}

/** Write `text` to `path` whole or not at all: another server may read it meanwhile. */
const writeWhole = Effect.fn("kb.ui.builds.writeWhole")(function* (path: string, text: string) {
  const fs = yield* FileSystem;
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  yield* fs.writeFileString(temporary, text);
  yield* fs.rename(temporary, path);
});

/**
 * Write the build's files and record under a staging name, then publish them
 * as `dir` by one rename. Another server of the same build may publish it
 * first; its copy is the same.
 */
const publish = Effect.fn("kb.ui.builds.publish")(function* (
  archive: string,
  dir: string,
  source: PageBuildSource,
  record: typeof BuildRecord.Type,
) {
  const fs = yield* FileSystem;
  const staging = join(archive, `${STAGING}${crypto.randomUUID()}`);
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(staging, { recursive: true });
    yield* source.write(join(staging, DIGEST_NAMED_DIR));
    const snapshot = yield* snapshotFiles(staging, join(staging, DIGEST_NAMED_DIR));
    const files = Object.fromEntries([...snapshot].map(([name, file]) => [name, file.digest]));
    yield* fs.writeFileString(join(staging, RECORD), yield* encodeRecord({ ...record, files }));
    yield* fs
      .rename(staging, dir)
      .pipe(
        Effect.catch((error) =>
          Effect.flatMap(fs.exists(dir), (published) =>
            published ? Effect.void : Effect.fail(error),
          ),
        ),
      );
  }).pipe(Effect.ensuring(Effect.ignore(fs.remove(staging, { recursive: true, force: true }))));
});

/**
 * Remove every build beyond the newest `keep` this listing finds, each whole,
 * and the staging a stopped server left. A directory with no readable record
 * counts as the oldest build.
 */
// GAP [[01M6H0QPT8K2YPY6XV6SM5WRYH]] a build another server refreshes after this listing can still be removed
const prune = Effect.fn("kb.ui.builds.prune")(function* (archive: string, keep: number) {
  const fs = yield* FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const builds: Array<{ readonly path: string; readonly at: number }> = [];
  for (const name of yield* fs.readDirectory(archive)) {
    const path = join(archive, name);
    if (name.startsWith(STAGING)) {
      const info = yield* fs.stat(path).pipe(Effect.option);
      const changed = Option.flatMap(info, ({ mtime }) => mtime);
      if (Option.isSome(changed) && now - changed.value.getTime() > ABANDONED_MS)
        yield* fs.remove(path, { recursive: true, force: true });
      continue;
    }
    const text = yield* fs.readFileString(join(path, RECORD)).pipe(Effect.orElseSucceed(() => ""));
    builds.push({ path, at: Option.getOrUndefined(decodeRecord(text))?.at ?? 0 });
  }
  for (const { path } of builds.toSorted((a, b) => b.at - a.at).slice(keep)) {
    yield* fs.remove(path, { recursive: true, force: true });
  }
});

/**
 * Keep the build `source` serves in `archive`, or note that a server started
 * on it again, then remove all but the newest `keep`. Never fails: a server
 * that cannot keep its build still serves it, and says why.
 */
export const recordBuild = Effect.fn("kb.ui.recordBuild")(
  function* (archive: string, source: PageBuildSource, keep: number = KEEP_BUILDS) {
    const fs = yield* FileSystem;
    const build = yield* source.entry;
    if (build === null) return;
    const dir = join(archive, directoryOf(build));
    const record = { build, at: yield* Clock.currentTimeMillis };
    yield* fs.makeDirectory(archive, { recursive: true });
    if (yield* fs.exists(dir)) {
      const previous = decodeRecord(
        yield* fs.readFileString(join(dir, RECORD)).pipe(Effect.orElseSucceed(() => "")),
      );
      yield* writeWhole(
        join(dir, RECORD),
        yield* encodeRecord({ ...Option.getOrUndefined(previous), ...record }),
      );
    } else yield* publish(archive, dir, source, record);
    yield* prune(archive, keep);
  },
  Effect.catch((error) =>
    Effect.sync(() =>
      writeErr(`kb ui: tabs of this build will reload after the next release: ${error.message}`),
    ),
  ),
);

/**
 * The kept copy of `rel`, a path under {@link DIGEST_NAMED_DIR}, from
 * whichever kept build has it; null when none does. Never a file outside the
 * archive, whatever `rel` or a link in the archive says: `rel` must stay
 * under the digest-named files as written, and the file must be inside the
 * archive as resolved, so a build or its `static/` that links elsewhere
 * serves nothing.
 */
export const keptFile = Effect.fn("kb.ui.builds.keptFile")(function* (
  archive: string,
  rel: string,
) {
  const fs = yield* FileSystem;
  const digestNamed = normalize(rel);
  if (!digestNamed.startsWith(DIGEST_NAMED_DIR)) return null;
  const names = yield* fs.readDirectory(archive).pipe(Effect.orElseSucceed(() => []));
  for (const name of names) {
    if (name.startsWith(STAGING)) continue;
    const kept = yield* containedFile(archive, join(archive, name, digestNamed));
    if (kept.kind === "ok") return kept;
  }
  return null;
});
