/**
 * `printEdn`: the inverse of `parseEdn` on the canonical domain, and a fixed
 * point of parse-then-print on any text that parses (DESIGN.md → Query layer;
 * docs/brainstorms/2026-10-20-query-builder, properties 1 and 2).
 */
import {
  LIST_TAGS_QUERY,
  isCanonicalIr,
  parseEdn,
  printEdn,
  readsAsEdn,
  type IrQuery,
} from "@kb/query";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { readEdn, type Edn } from "../src/ir/edn.ts";
import { canonicalIrArb } from "./canonical-arb.ts";
import { ednCorpus } from "./edn-corpus.ts";

function reparsed(edn: string): IrQuery {
  const ir = parseEdn(edn);
  if (ir.kind !== "query") throw new Error(`does not parse: ${edn}`);
  return ir;
}

describe("printEdn writes the canonical form", () => {
  test("the head on one line, each clause on its own, in IR order", () => {
    expect(printEdn(reparsed(LIST_TAGS_QUERY))).toBe(
      [
        "[:find ?id ?text :where",
        " [?n :node/id ?id]",
        " [?n :node/text ?text]",
        " [?n :f/sys.f.type ?t]",
        ' [?t :node/id "sys.tag"]]',
      ].join("\n"),
    );
  });

  test(":in, children as its two patterns, reach in its storage form, escapes", () => {
    const edn = `[:find ?id (count ?c) :in $ % ?root
      :where [?r :node/id ?root] [?r :node/child ?c] (reach ?r :node/mentions ?m 3)
             [?r :node/child-order ?o] [?c :node/text "a\\n\\"b\\""] (leaf ?c 1e-7)]`;
    expect(printEdn(reparsed(edn))).toBe(
      [
        "[:find ?id (count ?c) :in $ % ?root :where",
        " [?r :node/id ?root]",
        " [?r :node/child ?c] [?r :node/child-order ?o]",
        " (reach ?r :node/mentions ?m 3)",
        ' [?c :node/text "a\\n\\"b\\""]',
        " (leaf ?c 1e-7)]",
      ].join("\n"),
    );
  });
});

describe("property 1: print then parse is the identity on canonical IR", () => {
  test("parseEdn(printEdn(ir)) deep-equals ir", () => {
    fc.assert(
      fc.property(canonicalIrArb, (ir) => {
        expect(isCanonicalIr(ir)).toBe(true);
        expect(parseEdn(printEdn(ir))).toEqual(ir);
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * `edn` written again with lexical choices the printer never makes: other
 * whitespace, commas and comments between forms, a `+` on a number, a string
 * character written as its `\uXXXX` escape. Every choice reads the same.
 */
function rewrite(edn: Edn, pick: () => number): string {
  const separators = [" ", "\n  ", ",", " , ", "\t", " ;; note\n"];
  const join = (items: Edn[]) =>
    items.map((item) => rewrite(item, pick)).join(separators[pick() % separators.length]);
  switch (edn.k) {
    case "str":
      return `"${Array.from(edn.v, String)
        .map((c) => (pick() % 3 === 0 ? escapeUnits(c) : writeChar(c)))
        .join("")}"`;
    case "num":
      return edn.v >= 0 && pick() % 2 === 0 ? `+${String(edn.v)}` : String(edn.v);
    case "bool":
      return String(edn.v);
    case "kw":
    case "sym":
      return edn.v;
    case "vec":
      return `[${join(edn.v)}]`;
    case "list":
      return `(${join(edn.v)})`;
    case "map":
      return `{${join(edn.v.flat())}}`;
    default: {
      const _exhaustive: never = edn;
      return _exhaustive;
    }
  }
}

function escapeUnits(c: string): string {
  return Array.from({ length: c.length }, (_, i) => c.charCodeAt(i))
    .map((code) => `\\u${code.toString(16).padStart(4, "0")}`)
    .join("");
}

function writeChar(c: string): string {
  if (c === '"' || c === "\\") return `\\${c}`;
  return c.charCodeAt(0) < 0x20 ? escapeUnits(c) : c;
}

const noisyText: fc.Arbitrary<{ ir: IrQuery; text: string }> = fc
  .tuple(canonicalIrArb, fc.array(fc.nat({ max: 999 }), { minLength: 1, maxLength: 64 }))
  .map(([ir, picks]) => {
    let i = 0;
    const pick = () => picks[i++ % picks.length] ?? 0;
    const edn = readEdn(printEdn(ir));
    if (edn === null) throw new Error("printEdn wrote text the reader does not read");
    return { ir, text: rewrite(edn, pick) };
  });

describe("property 2: parse then print is stable", () => {
  test("over generated text: it reads as the IR it was written from, and printing is a fixed point", () => {
    fc.assert(
      fc.property(noisyText, ({ ir, text }) => {
        const once = parseEdn(text);
        expect(once).toEqual(ir);
        const printed = printEdn(reparsed(text));
        expect(printEdn(reparsed(printed))).toBe(printed);
      }),
      { numRuns: 300 },
    );
  });

  const corpus = ednCorpus();

  test("the corpus is the repo's queries, not an empty list", () => {
    const from = (part: string) => corpus.filter((e) => e.source.includes(part)).length;
    expect(from("seed.golden.jsonl")).toBeGreaterThan(0);
    expect(from(".kb/nodes.jsonl")).toBeGreaterThan(0);
    expect(from(".test.ts")).toBeGreaterThan(10);
    expect(from("/src/")).toBeGreaterThan(0);
  });

  test("over the corpus: every query's printed form prints back to itself", () => {
    for (const { source, ir } of corpus) {
      const printed = printEdn(ir);
      expect({ source, printed: printEdn(reparsed(printed)) }).toEqual({ source, printed });
      expect({ source, canonical: isCanonicalIr(ir) }).toEqual({ source, canonical: true });
    }
  });
});

describe("whether text reads as EDN", () => {
  test("is whether it is one whole form, before any query is read from it", () => {
    expect(readsAsEdn("[:find ?id :where [?n :node/id ?id]]")).toBe(true);
    expect(readsAsEdn("[:find ?id :where")).toBe(false);
    expect(readsAsEdn("[:find ?id] extra")).toBe(false);
    expect(readsAsEdn('[:find ?x :where [?n :node/text "unterminated]]')).toBe(false);
  });
});
