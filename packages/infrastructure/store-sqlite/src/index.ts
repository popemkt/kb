export { sqliteStoreFiles, sqliteStorePath } from "./paths.ts";
export type { SqliteStore } from "./sqlite-store.ts";

/**
 * The adapter, with the SQLite engine it runs on, loaded when a root selects
 * it. Presence detection reads only the file list (`sqliteStoreFiles`), so a
 * process whose roots are all JSONL parses none of it.
 */
export const loadSqliteStore = () => import("./sqlite-store.ts");
