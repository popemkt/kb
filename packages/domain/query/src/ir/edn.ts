/**
 * The EDN reader and writer the query IR is read and printed through: the
 * values a stored query is made of, and the lexical forms they are read from.
 * One home for the grammar, so the parser (EDN → IR), the printer
 * (IR → EDN) and the canonical domain (`isCanonicalIr`) agree on what reads
 * as what.
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
/** The escapes an EDN string may hold besides `\uXXXX`, and what each stands for. */
const STRING_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
};

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

/**
 * Whether `text` is one EDN value the reader reads: whether text a person is
 * typing parses at all, before asking whether it is a query in the IR.
 */
export function readsAsEdn(text: string): boolean {
  return readEdn(text) !== null;
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

/**
 * `value` as EDN text the reader reads back as `value`: one space between
 * forms, a string escaped as EDN escapes it, a number as `String(n)` prints
 * it (so only a number {@link isReadableNumber} accepts round-trips).
 */
export function writeEdn(value: Edn): string {
  switch (value.k) {
    case "str":
      return writeString(value.v);
    case "num":
      return String(value.v);
    case "bool":
      return value.v ? "true" : "false";
    case "kw":
    case "sym":
      return value.v;
    case "vec":
      return `[${value.v.map(writeEdn).join(" ")}]`;
    case "list":
      return `(${value.v.map(writeEdn).join(" ")})`;
    case "map":
      return `{${value.v.map(([k, v]) => `${writeEdn(k)} ${writeEdn(v)}`).join(" ")}}`;
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

/** What each character that cannot stand for itself in a string is written as. */
const ESCAPED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(STRING_ESCAPES).map(([escape, char]) => [char, `\\${escape}`]),
);

function writeString(s: string): string {
  let out = '"';
  for (const c of s) {
    const code = c.charCodeAt(0);
    const escaped = ESCAPED[c];
    if (escaped !== undefined) out += escaped;
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
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
  if (startsNumber(src.s, src.i)) return { k: "num", v: readNumber(src) };
  return readSymbolOrBool(src);
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** A digit, or a sign followed by one: `-` alone, or `-x`, is a symbol. */
function startsNumber(s: string, i: number): boolean {
  const c = s[i];
  return isDigit(c) || ((c === "-" || c === "+") && isDigit(s[i + 1]));
}

function readString(src: Src): string {
  src.i += 1;
  let out = "";
  while (src.i < src.s.length) {
    const c = present(src.s[src.i], "string char");
    if (c === '"') {
      src.i += 1;
      return out;
    }
    if (c === "\\") {
      out += readEscape(src);
      continue;
    }
    out += c;
    src.i += 1;
  }
  throw new ParseFail("unterminated string");
}

/** One escape, `src.i` at its backslash; an escape EDN does not define is not read. */
function readEscape(src: Src): string {
  const e = src.s[src.i + 1];
  if (e === "u") {
    const hex = src.s.slice(src.i + 2, src.i + 6);
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new ParseFail("bad \\u escape");
    src.i += 6;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }
  const char = e === undefined ? undefined : STRING_ESCAPES[e];
  if (char === undefined) throw new ParseFail("bad escape");
  src.i += 2;
  return char;
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

/**
 * An integer or a decimal, signed or not, with an optional exponent: every
 * form `String(n)` prints for a finite number (`-2.5`, `1e-7`, `1e+21`).
 */
const NUMBER = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function readNumber(src: Src): number {
  const start = src.i;
  while (src.i < src.s.length && SYMBOL_CHAR.test(present(src.s[src.i], "num"))) src.i += 1;
  const token = src.s.slice(start, src.i);
  const n = Number(token);
  if (!NUMBER.test(token) || !Number.isFinite(n)) throw new ParseFail("bad number");
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
