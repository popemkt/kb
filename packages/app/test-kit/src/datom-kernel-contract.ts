/**
 * EXPERIMENT (docs/research/2026-10-31-rust-wasm-in-kb.md): the datom
 * kernel contract, run over every kernel — the TypeScript one and the
 * Rust→WASM one — and proven against DataScript's own answers to the same
 * queries over the same graphs. A kernel is correct when it agrees with the
 * engine kb runs today; that is the whole contract.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import {
  DatascriptIndex,
  datomsOf,
  decodeRows,
  derivedWith,
  encodeDatoms,
  encodeQuery,
  kernelQueryEdn,
  type DatomKernel,
  type KernelQuery,
} from "@kb/query";
import { CONTRACT_AT as AT } from "./store-session.ts";

const STYLES = "f.styles";
const RATING = "f.rating";

function graphNode(
  id: string,
  text: string,
  props: KbNode["props"] = {},
  children: string[] = [],
): KbNode {
  return { id, text, props, children, createdAt: AT, updatedAt: AT };
}

function ref(v: string) {
  return { t: "ref" as const, v };
}

/** A graph like a visual library: tags, styles under facets, visuals with style refs, ratings and mentions. */
const graphArb = fc
  .record({
    visuals: fc.array(
      fc.record({
        styles: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 4 }),
        rating: fc.option(fc.nat({ max: 4 })),
        mentions: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 2 }),
        tagged: fc.boolean(),
      }),
      { maxLength: 40 },
    ),
  })
  .map(({ visuals }) => {
    const nodes: KbNode[] = [
      graphNode("tag.visual", "visual", { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] }),
      graphNode(STYLES, "styles"),
      graphNode(RATING, "rating"),
      graphNode(
        "facet",
        "facet",
        {},
        Array.from({ length: 8 }, (_, i) => `style.${i}`),
      ),
      ...Array.from({ length: 8 }, (_, i) => graphNode(`style.${i}`, `style ${i}`)),
    ];
    visuals.forEach((v, i) => {
      const props: KbNode["props"] = {};
      if (v.tagged) props[SYSTEM_IDS.typeField] = [ref("tag.visual")];
      if (v.styles.length > 0) props[STYLES] = v.styles.map((s) => ref(`style.${s}`));
      if (v.rating !== null) props[RATING] = [{ t: "num", v: v.rating }];
      const text = [`visual ${i}`, ...v.mentions.map((m) => `[[style.${m}]]`)].join(" ");
      nodes.push(graphNode(`v.${String(i).padStart(3, "0")}`, text, props));
    });
    return nodes;
  });

const v = (name: string) => ({ var: name });
const c = (value: string | number | boolean) => ({ const: value });

/** The queries every kernel answers as DataScript does. */
export const KERNEL_CORPUS: ReadonlyArray<readonly [string, KernelQuery]> = [
  [
    "every node of a tag",
    {
      find: ["?id"],
      where: [
        { e: v("?t"), attr: ":node/id", v: c("tag.visual") },
        { e: v("?n"), attr: `:f/${SYSTEM_IDS.typeField}`, v: v("?t") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "a two-style filter",
    {
      find: ["?id"],
      where: [
        { e: v("?a"), attr: ":node/id", v: c("style.1") },
        { e: v("?b"), attr: ":node/id", v: c("style.2") },
        { e: v("?n"), attr: `:f/${STYLES}`, v: v("?a") },
        { e: v("?n"), attr: `:f/${STYLES}`, v: v("?b") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "style counts over a tag",
    {
      find: ["?sid"],
      count: "?n",
      where: [
        { e: v("?t"), attr: ":node/id", v: c("tag.visual") },
        { e: v("?n"), attr: `:f/${SYSTEM_IDS.typeField}`, v: v("?t") },
        { e: v("?n"), attr: `:f/${STYLES}`, v: v("?s") },
        { e: v("?s"), attr: ":node/id", v: v("?sid") },
      ],
    },
  ],
  [
    "backlinks by mention",
    {
      find: ["?id"],
      where: [
        { e: v("?s"), attr: ":node/id", v: c("style.3") },
        { e: v("?n"), attr: ":node/mentions", v: v("?s") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "a parent's children and their text",
    {
      find: ["?cid", "?text"],
      where: [
        { e: v("?p"), attr: ":node/id", v: c("facet") },
        { e: v("?p"), attr: ":node/child", v: v("?ch") },
        { e: v("?ch"), attr: ":node/id", v: v("?cid") },
        { e: v("?ch"), attr: ":node/text", v: v("?text") },
      ],
    },
  ],
  [
    "a number constant",
    {
      find: ["?id"],
      where: [
        { e: v("?n"), attr: `:f/${RATING}`, v: c(3) },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
  [
    "a count of everything",
    { find: [], count: "?n", where: [{ e: v("?n"), attr: ":node/id", v: { blank: true } }] },
  ],
  [
    "a constant no datom holds",
    {
      find: ["?id"],
      where: [
        { e: v("?n"), attr: ":node/id", v: c("no such node") },
        { e: v("?n"), attr: ":node/id", v: v("?id") },
      ],
    },
  ],
];

const sorted = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).toSorted();

/** `kernel`'s answers to the corpus over `nodes`, beside DataScript's. */
export function kernelAndDatascript(kernel: DatomKernel, nodes: readonly KbNode[]) {
  const derived = derivedWith({});
  const encoded = encodeDatoms(datomsOf(nodes, derived));
  const index = kernel.build(encoded);
  const reference = new DatascriptIndex(nodes, { derived });
  try {
    return KERNEL_CORPUS.map(([name, query]) => ({
      name,
      kernel: sorted(decodeRows(index.run(encodeQuery(query, encoded)), encoded)),
      datascript: sorted(reference.runDatalog(kernelQueryEdn(query))),
    }));
  } finally {
    index.free();
  }
}

export function datomKernelContract(kernel: DatomKernel): void {
  describe(`${kernel.name} — datom kernel contract`, () => {
    test("answers the corpus as DataScript does, over any library-shaped graph", () => {
      fc.assert(
        fc.property(graphArb, (nodes) => {
          for (const answer of kernelAndDatascript(kernel, nodes)) {
            expect({ name: answer.name, rows: answer.kernel }).toEqual({
              name: answer.name,
              rows: answer.datascript,
            });
          }
        }),
        { numRuns: 60 },
      );
    });
  });
}
