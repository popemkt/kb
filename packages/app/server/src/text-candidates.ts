import { Database } from "bun:sqlite";
import type { NodeId } from "@kb/model";
import type { SearchDocument, TextCandidates } from "@kb/query";

/** Preserve every valid trigram, even if a document contains an invalid code unit. */
function sqliteText(text: string): string {
  return text.toWellFormed().replaceAll("\0", "\uFFFD");
}

/** Store id code units losslessly, including NUL and unpaired surrogates. */
function idKey(id: NodeId): Buffer {
  return Buffer.from(id, "utf16le");
}

/** A scan is cheaper for a dense match than decoding and sorting all its candidates. */
const MAX_CANDIDATES = 512;

type Documents = Iterable<readonly [NodeId, SearchDocument | undefined]>;

/** A search projection of a live node table, independent of which store holds it. */
export class FtsTextCandidates implements TextCandidates {
  #db: Database | undefined;
  #unavailable = false;

  supports(needle: string): boolean {
    if (this.#unavailable || !needle.isWellFormed() || needle.includes("\0")) return false;
    const points = needle[Symbol.iterator]();
    points.next();
    points.next();
    return points.next().done !== true;
  }

  reset(documents: Documents): boolean {
    return (
      this.#using(() => {
        const db = this.#open();
        db.transaction(() => {
          db.run("DELETE FROM documents");
          db.run("DELETE FROM keys");
          this.#write(db, documents);
        })();
        return true;
      }) ?? false
    );
  }

  update(documents: ReadonlyMap<NodeId, SearchDocument | undefined>): boolean {
    const db = this.#db;
    if (db === undefined) return false;
    if (documents.size === 0) return true;
    return (
      this.#using(() => {
        db.transaction(() => this.#write(db, documents))();
        return true;
      }) ?? false
    );
  }

  #write(db: Database, documents: Documents): void {
    const add = db.query("INSERT INTO documents (rowid, source, title) VALUES (?, ?, ?)");
    const find = db.query<{ rowid: number }, [Buffer]>("SELECT rowid FROM keys WHERE id = ?");
    const identify = db.query("INSERT INTO keys (id) VALUES (?)");
    const forget = db.query("DELETE FROM keys WHERE id = ?");
    const remove = db.query("DELETE FROM documents WHERE rowid = ?");
    for (const [id, document] of documents) {
      const key = idKey(id);
      const row = find.get(key);
      if (row !== null) remove.run(row.rowid);
      if (document === undefined) {
        forget.run(key);
        continue;
      }
      const rowid = row?.rowid ?? identify.run(key).lastInsertRowid;
      add.run(rowid, sqliteText(document.source), sqliteText(document.title));
    }
  }

  find(needle: string): readonly NodeId[] | undefined {
    const db = this.#db;
    if (db === undefined) return undefined;
    const prefix = needle.slice(0, 64);
    const wholePoints = prefix.isWellFormed() ? prefix : prefix.slice(0, -1);
    // A quoted phrase passes through the MATCH grammar as literal text. The
    // original needle is verified in JS after this bounded prefix lookup.
    const phrase = '"' + wholePoints.replaceAll('"', '""') + '"';
    return this.#using(() => {
      const rows = db
        .query<{ id: Uint8Array }, [string, number]>(
          "SELECT keys.id FROM documents JOIN keys ON keys.rowid = documents.rowid WHERE documents MATCH ? LIMIT ?",
        )
        .all(phrase, MAX_CANDIDATES + 1);
      if (rows.length > MAX_CANDIDATES) return undefined;
      return rows.map(({ id }) => Buffer.from(id).toString("utf16le"));
    });
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
    this.#unavailable = true;
  }

  /** A projection failure leaves the graph and its scan usable. */
  #using<A>(read: () => A): A | undefined {
    if (this.#unavailable) return undefined;
    try {
      return read();
    } catch {
      this.close();
      return undefined;
    }
  }

  #open(): Database {
    if (this.#db !== undefined) return this.#db;
    const db = new Database(":memory:");
    this.#db = db;
    db.run("CREATE TABLE keys (id BLOB UNIQUE)");
    db.run(
      "CREATE VIRTUAL TABLE documents USING fts5(source, title, tokenize='trigram case_sensitive 1')",
    );
    return db;
  }
}
