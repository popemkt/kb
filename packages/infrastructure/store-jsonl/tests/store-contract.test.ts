/**
 * JsonlStore against the shared store contract. The properties live in
 * `@kb/test-kit` because they are the port's, not this adapter's; what is
 * specific to JSONL — the `.lock` file, `.bak` rotation, line-numbered decode
 * errors — is tested where that behaviour is described.
 */
import { Effect } from "effect";
import { logContract, storeContract, tailContract } from "@kb/test-kit";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore, txTailPath } from "../src/index.ts";

storeContract("JsonlStore", (root) => new JsonlStore(root));

const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-tail-contract-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

tailContract(
  "JsonlTxTail",
  Effect.map(scratchRoot, (root) => new JsonlStore(root).txTail),
);

logContract("JsonlStore", {
  makeStore: (root) => new JsonlStore(root),
  // Off the end of the file, the way a process killed after the node write but
  // before its `appendFileSync` leaves it. Adapter-specific by nature; see
  // `LogAdapter`.
  dropLastRecord: (root) => {
    const path = txTailPath(root);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    writeFileSync(
      path,
      lines
        .slice(0, -1)
        .map((line) => `${line}\n`)
        .join(""),
    );
  },
  // Read-only: `appendFileSync` fails and the reads that answer `head` still
  // work, which is the state the property is about.
  breakTail: (root) => {
    chmodSync(txTailPath(root), 0o444);
  },
});
