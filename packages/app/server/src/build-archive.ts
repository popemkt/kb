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
 * servers sharing one archive never remove a build another just kept: it was
 * not in their listing, and a build is never removed in part. A digest-named
 * file has the same bytes in every build that has it, so it is served from
 * whichever kept build has it. The archive is a cache: losing it costs a tab
 * of an older build a reload, nothing else.
 */
import { basename, join } from "node:path";
import { Clock, Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { writeErr } from "@kb/runtime";
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

const BuildRecord = Schema.Struct({ build: Schema.String, at: Schema.Finite });
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
  digestNamed: string,
  record: string,
) {
  const fs = yield* FileSystem;
  const staging = join(archive, `${STAGING}${crypto.randomUUID()}`);
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(staging, { recursive: true });
    yield* fs.copy(digestNamed, join(staging, DIGEST_NAMED_DIR));
    yield* fs.writeFileString(join(staging, RECORD), record);
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
 * Keep the build `distDir` serves in `archive`, or note that a server started
 * on it again, then remove all but the newest `keep`. Never fails: a server
 * that cannot keep its build still serves it, and says why.
 */
export const recordBuild = Effect.fn("kb.ui.recordBuild")(
  function* (archive: string, distDir: string, keep: number = KEEP_BUILDS) {
    const fs = yield* FileSystem;
    const build = yield* buildIn(distDir);
    const digestNamed = join(distDir, DIGEST_NAMED_DIR);
    if (build === null || !(yield* fs.exists(digestNamed))) return;
    const dir = join(archive, directoryOf(build));
    const record = yield* encodeRecord({ build, at: yield* Clock.currentTimeMillis });
    yield* fs.makeDirectory(archive, { recursive: true });
    if (yield* fs.exists(dir)) yield* writeWhole(join(dir, RECORD), record);
    else yield* publish(archive, dir, digestNamed, record);
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
 * digest-named files of the build that has it, whatever `rel` or a link in
 * the archive says.
 */
export const keptFile = Effect.fn("kb.ui.builds.keptFile")(function* (
  archive: string,
  rel: string,
) {
  const fs = yield* FileSystem;
  const names = yield* fs.readDirectory(archive).pipe(Effect.orElseSucceed(() => []));
  for (const name of names) {
    if (name.startsWith(STAGING)) continue;
    const build = join(archive, name);
    const kept = yield* containedFile(join(build, DIGEST_NAMED_DIR), join(build, rel));
    if (kept.kind === "ok") return kept;
  }
  return null;
});
