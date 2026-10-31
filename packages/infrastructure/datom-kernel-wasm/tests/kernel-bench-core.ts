/**
 * EXPERIMENT benchmark core: DataScript, the TypeScript kernel and the
 * Rust→WASM kernel over one gallery store's `nodes.jsonl` text. Runtime-free,
 * so `kernel-bench.ts` runs it in Bun and `kernel-bench.page.ts` in a page.
 */
import { decodeStoredNode, type KbNode } from "@kb/model";
import {
  DatascriptIndex,
  datomsOf,
  decodeRows,
  derivedWith,
  encodeDatoms,
  encodeQuery,
  kernelQueryEdn,
  tsKernel,
  type DatomKernel,
  type KernelQuery,
} from "@kb/query";
import { wasmKernel } from "../src/index.ts";

const v = (name: string) => ({ var: name });
const c = (value: string | number) => ({ const: value });
const STYLES = ":f/sys.f.gallery.styles";
const TYPE = ":f/sys.f.type";

const QUERIES: ReadonlyArray<readonly [string, KernelQuery]> = [
  [
    "every visual (tag)",
    {
      find: ["?id"],
      where: [
        { e: v("?t"), attr: ":node/id", v: c("sys.tag.visual") },
        { e: v("?n"), attr: TYPE, v: v("?t") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "two-style filter",
    {
      find: ["?id"],
      where: [
        { e: v("?a"), attr: ":node/id", v: c("01GALSTYLE0000000000000001") },
        { e: v("?n"), attr: STYLES, v: v("?a") },
        { e: v("?b"), attr: ":node/id", v: c("01GALSTYLE0000000000000002") },
        { e: v("?n"), attr: STYLES, v: v("?b") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "style counts over the tag",
    {
      find: ["?sid"],
      count: "?n",
      where: [
        { e: v("?t"), attr: ":node/id", v: c("sys.tag.visual") },
        { e: v("?n"), attr: TYPE, v: v("?t") },
        { e: v("?n"), attr: STYLES, v: v("?s") },
        { e: v("?s"), attr: ":node/id", v: v("?sid") },
      ],
    },
  ],
  [
    "a facet's children + text",
    {
      find: ["?cid", "?text"],
      where: [
        { e: v("?p"), attr: ":node/id", v: c("01GALFACET0000000000000000") },
        { e: v("?p"), attr: ":node/child", v: v("?ch") },
        { e: v("?ch"), attr: ":node/id", v: v("?cid") },
        { e: v("?ch"), attr: ":node/text", v: v("?text") },
      ],
    },
  ],
  [
    "count of everything",
    { find: [], count: "?n", where: [{ e: v("?n"), attr: ":node/id", v: { blank: true } }] },
  ],
];

function time<T>(f: () => T, runs: number): { ms: number; value: T } {
  let value = f();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    value = f();
    samples.push(performance.now() - s);
  }
  samples.sort((x, y) => x - y);
  return { ms: samples[Math.floor(samples.length / 2)] as number, value };
}

function fmt(ms: number): string {
  return ms.toFixed(ms < 10 ? 2 : 0).padStart(8);
}

/** The table, line by line, to `log`. */
export function benchKernels(jsonl: string, wasm: ArrayBuffer, log: (line: string) => void): void {
  const nodes: KbNode[] = jsonl
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => decodeStoredNode(JSON.parse(l)));
  const derived = derivedWith({});
  const runs = nodes.length > 20_000 ? 5 : 15;
  const kernels: DatomKernel[] = [tsKernel, wasmKernel(wasm)];

  log(`nodes ${nodes.length}`);
  const ds = time(() => new DatascriptIndex(nodes, { derived }), Math.min(runs, 5));
  const datoms = time(() => datomsOf(nodes, derived), runs);
  const encoded = time(() => encodeDatoms(datoms.value), runs);
  log(`datoms ${datoms.value.length}`);
  log(`build  datascript ${fmt(ds.ms)}  datomsOf ${fmt(datoms.ms)}  encode ${fmt(encoded.ms)}`);
  const indexes = kernels.map((k) => {
    const built = time(() => k.build(encoded.value), runs);
    log(`build  ${k.name.padEnd(10)} ${fmt(built.ms)} (index only)`);
    return built.value;
  });
  log(
    `query${" ".repeat(26)}${["datascript", ...kernels.map((k) => k.name)].map((n) => n.padStart(11)).join("")}  rows`,
  );
  for (const [name, query] of QUERIES) {
    const edn = kernelQueryEdn(query);
    // The index keeps answers by their EDN; a distinct string per run is a cold run.
    let n = 0;
    const reference = time(() => ds.value.runDatalog(edn + " ".repeat(++n)), runs);
    const cells = indexes.map((index) =>
      time(() => decodeRows(index.run(encodeQuery(query, encoded.value)), encoded.value), runs),
    );
    for (const cell of cells) {
      if (cell.value.length !== reference.value.length)
        throw new Error(`${name}: row count differs`);
    }
    log(
      `${name.padEnd(31)}${[reference, ...cells].map((x) => fmt(x.ms).padStart(11)).join("")}  ${reference.value.length}`,
    );
  }
}
