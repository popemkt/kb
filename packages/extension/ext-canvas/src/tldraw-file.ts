/**
 * A tldraw file's store records (DESIGN.md → Canvas documents → Import):
 * a `.tldr` is JSON whose `records` they are; a `.tldraw` is a ZIP holding
 * `db.sqlite`, tldraw-sync's storage, whose `documents` table keeps each
 * record's JSON in `state`. Reading only: nothing here writes the file,
 * and the lowering is `@kb/canvas`'s (`tldrawBoard`).
 */
import { Database } from "bun:sqlite";
import { inflateRawSync } from "node:zlib";

/** Why a file is not a tldraw board kb reads. */
class TldrawFileError extends Error {
  override readonly name = "TldrawFileError";
}

const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

/** The end-of-central-directory record's offset: the last of its signature, within its comment's reach. */
function zipEnd(view: DataView): number {
  const floor = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= floor; at -= 1) {
    if (view.getUint32(at, true) === ZIP_END) return at;
  }
  throw new TldrawFileError("not a ZIP archive: no end of central directory");
}

/** The bytes of the entry `name` in the ZIP `bytes`, stored or deflated; undefined when it holds none. */
function zipEntry(bytes: Uint8Array, name: string): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = zipEnd(view);
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i += 1) {
    if (view.getUint32(at, true) !== ZIP_CENTRAL)
      throw new TldrawFileError("a broken ZIP directory");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entry = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + skip;
    if (entry !== name) continue;
    if (size === 0xffffffff) throw new TldrawFileError("a ZIP64 archive, which kb does not read");
    if (view.getUint32(local, true) !== ZIP_LOCAL) throw new TldrawFileError("a broken ZIP entry");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new TldrawFileError(
      `${name} is packed by method ${String(method)}, which kb does not read`,
    );
  }
  return undefined;
}

/** The records a tldraw-sync `db.sqlite` keeps, each its `state`'s JSON. */
function sqliteRecords(bytes: Uint8Array): unknown[] {
  const db = Database.deserialize(bytes, true);
  try {
    const rows = db.query<{ state: Uint8Array | string }, []>("select state from documents").all();
    const decoder = new TextDecoder();
    return rows.map((row): unknown =>
      JSON.parse(typeof row.state === "string" ? row.state : decoder.decode(row.state)),
    );
  } finally {
    db.close();
  }
}

/** Whether `bytes` start as a ZIP's first local header does. */
const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === ZIP_LOCAL;

/**
 * The store records of the tldraw file `bytes`: a `.tldraw` ZIP's
 * `db.sqlite`, or a `.tldr`'s JSON `records`. Throws `TldrawFileError` for
 * anything else.
 */
export function tldrawRecords(bytes: Uint8Array): unknown[] {
  if (isZip(bytes)) {
    const db = zipEntry(bytes, "db.sqlite");
    if (db === undefined)
      throw new TldrawFileError("a .tldraw archive holds db.sqlite; this one does not");
    return sqliteRecords(db);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TldrawFileError("neither a .tldraw archive nor a .tldr file's JSON");
  }
  const records =
    typeof parsed === "object" && parsed !== null && "records" in parsed
      ? parsed.records
      : undefined;
  if (!Array.isArray(records))
    throw new TldrawFileError("a .tldr file holds records; this one does not");
  return records;
}
