import { storeBenchmark } from "@kb/test-kit";
import { SqliteStore } from "../src/sqlite-store.ts";

storeBenchmark("SqliteStore", (root) => new SqliteStore(root));
