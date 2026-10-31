/**
 * EXPERIMENT benchmark in Bun. Run:
 * `bun tests/kernel-bench.ts <root>/.kb/nodes.jsonl`. Not a test: it reads a
 * store outside the repository and prints a table.
 */
import { DATOM_KERNEL_WASM_URL } from "../src/index.ts";
import { benchKernels } from "./kernel-bench-core.ts";

benchKernels(
  await Bun.file(process.argv[2] ?? "").text(),
  await Bun.file(DATOM_KERNEL_WASM_URL).arrayBuffer(),
  (line) => console.log(line),
);
