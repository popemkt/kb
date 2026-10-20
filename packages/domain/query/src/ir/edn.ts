/**
 * The EDN reader the query IR is read through: the values a stored query is
 * made of, and the lexical forms they are read from. One home for the
 * grammar, so the parser (EDN → IR) and the canonical domain
 * (`isCanonicalIr`) agree on what reads as what.
 */
import { present } from "@kb/model";

export type Edn =
  | { k: "kw"; v: string }
  | { k: "sym"; v: string }
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "vec"; v: Edn[] }
  | { k: "list"; v: Edn[] }
  | { k: "map"; v: [Edn, Edn][] };

type Src = { readonly s: string; i: number };

class ParseFail extends Error {}

/** A keyword's characters after the colon. */
const KEYWORD_CHAR = /[A-Za-z0-9_./+*-]/;
/** EDN's symbol characters, so a predicate (`[(> ?n 2)]`) reads as a symbol. */
const SYMBOL_CHAR = /[A-Za-z0-9_./+*?$%!<>=&'-]/;

/** `text` as one EDN value, or null when it is not exactly one value the reader reads. */
export function readEdn(text: string): Edn | null {
  try {
    const src: Src = { s: text, i: 0 };
    const value = readValue(src);
    skipWs(src);
    return src.i === src.s.length ? value : null;
  } catch (err) {
    if (err instanceof ParseFail) return null;
    throw err;
  }
}

/** Whether `name` is a keyword's text the reader reads back as that keyword (`:node/id`). */
export function isKeywordText(name: string): boolean {
  return readsAs(name, "kw");
}

/** Whether `name` is a symbol's text the reader reads back as that symbol (`?n`, `clojure.string/includes?`). */
export function isSymbolText(name: string): boolean {
  return readsAs(name, "sym");
}

/** Whether `n` is a number the reader reads back exactly from `String(n)`. */
export function isReadableNumber(n: number): boolean {
  if (!Number.isFinite(n) || Object.is(n, -0)) return false;
  const read = readEdn(String(n));
  return read?.k === "num" && read.v === n;
}

function readsAs(text: string, kind: "kw" | "sym"): boolean {
  const read = readEdn(text);
  return read?.k === kind && read.v === text;
}

function skipWs(src: Src): void {
  while (src.i < src.s.length) {
    const c = src.s[src.i];
    if (c === ";") {
      while (src.i < src.s.length && src.s[src.i] !== "\n") src.i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",") {
      src.i += 1;
      continue;
    }
    break;
  }
}

function readValue(src: Src): Edn {
  skipWs(src);
  const c = src.s[src.i];
  if (c === undefined) throw new ParseFail("eof");
  if (c === '"') return { k: "str", v: readString(src) };
  if (c === ":") return { k: "kw", v: readKeyword(src) };
  if (c === "[") return { k: "vec", v: readSeq(src, "]") };
  if (c === "(") return { k: "list", v: readSeq(src, ")") };
  if (c === "{") return { k: "map", v: readMap(src) };
  if (c === "-" || (c >= "0" && c <= "9")) return { k: "num", v: readNumber(src) };
  return readSymbolOrBool(src);
}

function readString(src: Src): string {
  src.i += 1;
  let out = "";
  while (src.i < src.s.length) {
    const c = src.s[src.i];
    if (c === undefined) throw new ParseFail("unterminated string");
    if (c === '"') {
      src.i += 1;
      return out;
    }
    if (c === "\\") {
      src.i += 1;
      const e = src.s[src.i];
      if (e === undefined) throw new ParseFail("unterminated escape");
      out += e;
      src.i += 1;
      continue;
    }
    out += c;
    src.i += 1;
  }
  throw new ParseFail("unterminated string");
}

function readKeyword(src: Src): string {
  const start = src.i;
  src.i += 1;
  while (src.i < src.s.length && KEYWORD_CHAR.test(present(src.s[src.i], "kw"))) {
    src.i += 1;
  }
  const kw = src.s.slice(start, src.i);
  if (kw.length < 2) throw new ParseFail("empty keyword");
  return kw;
}

function readNumber(src: Src): number {
  const start = src.i;
  if (src.s[src.i] === "-") src.i += 1;
  while (src.i < src.s.length && /[0-9.]/.test(present(src.s[src.i], "num"))) src.i += 1;
  const n = Number(src.s.slice(start, src.i));
  if (!Number.isFinite(n)) throw new ParseFail("bad number");
  return n;
}

function readSymbolOrBool(src: Src): Edn {
  const start = src.i;
  while (src.i < src.s.length && SYMBOL_CHAR.test(present(src.s[src.i], "sym"))) {
    src.i += 1;
  }
  const v = src.s.slice(start, src.i);
  if (v.length === 0) throw new ParseFail("empty symbol");
  if (v === "true") return { k: "bool", v: true };
  if (v === "false") return { k: "bool", v: false };
  return { k: "sym", v };
}

function readSeq(src: Src, close: "]" | ")"): Edn[] {
  src.i += 1;
  const out: Edn[] = [];
  for (;;) {
    skipWs(src);
    if (src.s[src.i] === close) {
      src.i += 1;
      return out;
    }
    out.push(readValue(src));
  }
}

function readMap(src: Src): [Edn, Edn][] {
  src.i += 1;
  const out: [Edn, Edn][] = [];
  for (;;) {
    skipWs(src);
    if (src.s[src.i] === "}") {
      src.i += 1;
      return out;
    }
    const key = readValue(src);
    const val = readValue(src);
    out.push([key, val]);
  }
}
