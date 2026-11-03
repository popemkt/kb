/**
 * The builds a server has served, kept so a tab of an earlier one keeps
 * working (DESIGN-UI.md → Delivery, "A tab outlives its build"). A release
 * replaces `ui/dist`, and a tab opened before it still asks for the chunks it
 * was built with. Every file under `static/` is named by its digest, so the
 * archive is one directory of them shared by every build, and a build's
 * record lists which are its.
 *
 *     <archive>/static/<file>       the digest-named files of every kept build
 *     <archive>/builds/<build>.json which of them one build loads
 *
 * A server records the build it serves when it starts, and keeps the
 * {@link KEEP_BUILDS} it recorded last; a file no kept build lists is
 * removed. The archive is a cache: losing it costs a tab of an older build a
 * reload, nothing else.
 */
import { basename, dirname, join } from "node:path";
import { Clock, Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { writeErr } from "@kb/runtime";
import { DIGEST_NAMED_DIR, servedBuild } from "./assets.ts";

/** How many builds a tab may be behind and still have its chunks served. */
const KEEP_BUILDS = 8;

const BuildRecord = Schema.Struct({
  build: Schema.String,
  files: Schema.Array(Schema.String),
  at: Schema.Finite,
});
type BuildRecord = typeof BuildRecord.Type;
const RecordJson = Schema.fromJsonString(BuildRecord);
const decodeRecord = Schema.decodeUnknownOption(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);

/** A build's record file: its entry script's name, which carries its digest. */
function recordName(build: string): string {
  return `${basename(build).replaceAll(/[^\w.-]/g, "_")}.json`;
}

/** Write `text` to `path` whole or not at all: another server may read it meanwhile. */
const writeWhole = Effect.fn("kb.ui.builds.writeWhole")(function* (path: string, text: string) {
  const fs = yield* FileSystem;
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  yield* fs.writeFileString(temporary, text);
  yield* fs.rename(temporary, path);
});

/** Copy `from` to `to` whole or not at all, unless `to` is there: a digest-named file never changes. */
const keepFile = Effect.fn("kb.ui.builds.keepFile")(function* (from: string, to: string) {
  const fs = yield* FileSystem;
  if (yield* fs.exists(to)) return;
  yield* fs.makeDirectory(dirname(to), { recursive: true });
  const temporary = `${to}.${crypto.randomUUID()}.tmp`;
  yield* fs.copyFile(from, temporary);
  yield* fs.rename(temporary, to);
});

/** The records in the archive, newest first; an unreadable one is not a build. */
const recordsIn = Effect.fn("kb.ui.builds.records")(function* (archive: string) {
  const fs = yield* FileSystem;
  const dir = join(archive, "builds");
  if (!(yield* fs.exists(dir))) return [];
  const records: Array<{ readonly name: string; readonly record: BuildRecord }> = [];
  for (const name of yield* fs.readDirectory(dir)) {
    if (!name.endsWith(".json")) continue;
    const text = yield* fs.readFileString(join(dir, name)).pipe(Effect.orElseSucceed(() => ""));
    const record = Option.getOrUndefined(decodeRecord(text));
    if (record !== undefined) records.push({ name, record });
  }
  return records.toSorted((a, b) => b.record.at - a.record.at);
});

/**
 * Keep the build `distDir` serves in `archive`, then forget all but the
 * newest `keep`. Never fails: a server that cannot keep its build still
 * serves it, and says why.
 */
export const recordBuild = Effect.fn("kb.ui.recordBuild")(
  function* (archive: string, distDir: string, keep: number = KEEP_BUILDS) {
    const fs = yield* FileSystem;
    const build = servedBuild(distDir);
    const digestNamed = join(distDir, DIGEST_NAMED_DIR);
    if (build === null || !(yield* fs.exists(digestNamed))) return;
    const files: string[] = [];
    for (const rel of yield* fs.readDirectory(digestNamed, { recursive: true })) {
      const from = join(digestNamed, rel);
      if ((yield* fs.stat(from)).type !== "File") continue;
      yield* keepFile(from, join(archive, DIGEST_NAMED_DIR, rel));
      files.push(rel);
    }
    yield* fs.makeDirectory(join(archive, "builds"), { recursive: true });
    const record: BuildRecord = { build, files, at: yield* Clock.currentTimeMillis };
    yield* writeWhole(join(archive, "builds", recordName(build)), yield* encodeRecord(record));

    const records = yield* recordsIn(archive);
    const kept = new Set(records.slice(0, keep).flatMap((entry) => entry.record.files));
    for (const { name } of records.slice(keep)) {
      yield* fs.remove(join(archive, "builds", name), { force: true });
    }
    for (const rel of yield* fs.readDirectory(join(archive, DIGEST_NAMED_DIR), {
      recursive: true,
    })) {
      const path = join(archive, DIGEST_NAMED_DIR, rel);
      if (kept.has(rel) || (yield* fs.stat(path)).type !== "File") continue;
      yield* fs.remove(path, { force: true });
    }
  },
  Effect.catch((error) =>
    Effect.sync(() =>
      writeErr(`kb ui: tabs of this build will reload after the next release: ${error.message}`),
    ),
  ),
);
