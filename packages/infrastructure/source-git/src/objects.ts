import { Effect } from "effect";
import {
  checkSourceEntries,
  fullRev,
  SOURCE_LIMITS,
  SourceError,
  type ObjectFile,
} from "@kb/extension-source";
import { GIT_BUDGET, type GitTransport } from "./transport.ts";
const decoder = new TextDecoder("utf-8", { fatal: true });
interface ObjectEntry {
  readonly path: string;
  readonly mode: string;
  readonly oid: string;
}
export function treeEntries(bytes: Uint8Array): ObjectEntry[] {
  const entries = decoder
    .decode(bytes)
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, kind, oid] = entry.slice(0, tab).split(" ");
      if (tab < 0 || kind !== "blob" || mode === undefined)
        throw new SourceError({ message: "source is not a regular file" });
      return { path: entry.slice(tab + 1), mode, oid: fullRev.parse(oid) };
    });
  return entries;
}
function batchObjects(bytes: Uint8Array, oids: readonly string[]): Map<string, Uint8Array> {
  const objects = new Map<string, Uint8Array>();
  let offset = 0,
    total = 0;
  for (const oid of oids) {
    const line = bytes.indexOf(10, offset);
    if (line < 0) throw new SourceError({ message: "incomplete git object header" });
    const [actual, kind, textSize] = decoder.decode(bytes.subarray(offset, line)).split(" ");
    const size = Number(textSize);
    if (actual !== oid || kind !== "blob" || !Number.isSafeInteger(size) || size < 0)
      throw new SourceError({ message: "invalid git blob header" });
    total += size;
    if (total > SOURCE_LIMITS.bytes)
      throw new SourceError({ message: "source exceeds byte limit" });
    offset = line + 1;
    if (offset + size >= bytes.length || bytes[offset + size] !== 10)
      throw new SourceError({ message: "incomplete git blob" });
    objects.set(oid, bytes.subarray(offset, offset + size));
    offset += size + 1;
  }
  if (offset !== bytes.length) throw new SourceError({ message: "unexpected git object output" });
  return objects;
}
export const readObjects = Effect.fn("source.objects")(function* (
  git: GitTransport,
  url: string,
  dir: string,
  entries: readonly ObjectEntry[],
) {
  yield* Effect.try({ try: () => checkSourceEntries(entries), catch: SourceError.from });
  if (entries.length === 0) return [] as ObjectFile[];
  const oids = [...new Set(entries.map(({ oid }) => oid))];
  yield* git(
    [
      "fetch",
      "--quiet",
      "--filter=blob:none",
      "--no-tags",
      "--no-recurse-submodules",
      url,
      ...oids,
    ],
    dir,
    { fileBytes: GIT_BUDGET.blobFileBytes },
  );
  const bytes = yield* git(["cat-file", "--batch"], dir, {
    input: new TextEncoder().encode(oids.join("\n") + "\n"),
    outputBytes: GIT_BUDGET.batchBytes,
  });
  return yield* Effect.try({
    try: () => {
      const objects = batchObjects(bytes, oids);
      return entries.map(({ path, mode, oid }) => {
        const body = objects.get(oid);
        if (body === undefined) throw new SourceError({ message: "missing git object" });
        return { path, mode, bytes: body };
      });
    },
    catch: SourceError.from,
  });
});
