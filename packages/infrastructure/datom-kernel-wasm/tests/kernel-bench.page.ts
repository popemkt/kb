/** EXPERIMENT benchmark in a page: `kernel-bench-browser.ts` serves and drives it. */
import { benchKernels } from "./kernel-bench-core.ts";

const [jsonl, wasm] = await Promise.all([
  fetch("/nodes.jsonl").then((r) => r.text()),
  fetch("/kernel.wasm").then((r) => r.arrayBuffer()),
]);
benchKernels(jsonl, wasm, (line) => console.log(line));
console.log("DONE");
