/**
 * EXPERIMENT (docs/research/2026-10-31-rust-wasm-in-kb.md): a datom kernel —
 * covering indexes over kb's datoms and conjunctive pattern queries over
 * them — as one contract with several implementations, so the TypeScript
 * kernel and the Rust→WASM kernel are measured on the same work and proven
 * against the same answers (DataScript's).
 *
 * What crosses into a kernel is columns of numbers, never objects or strings:
 * a datom is `(e, a, tag, v)`, its attribute an index into {@link Encoded}'s
 * attribute table, a string value an index into its string table. A kernel
 * answers rows of the same `(tag, v)` pairs, and the host turns them back
 * into values. That keeps the boundary to a handful of typed-array copies,
 * whichever side of it the kernel runs on.
 */
import type { Datom } from "../index/datoms.ts";

/** How a value is held: a number (an eid is one), a string-table index, a boolean, anything else by identity. */
export const TAG = { num: 0, str: 1, bool: 2, other: 3 } as const;

/** The datoms as columns, and the tables their attribute and string indexes name. */
export interface Encoded {
  readonly e: Uint32Array;
  readonly a: Uint32Array;
  readonly t: Uint8Array;
  readonly v: Float64Array;
  readonly attrs: readonly string[];
  readonly strings: readonly string[];
  readonly attrIndex: ReadonlyMap<string, number>;
  readonly stringIndex: ReadonlyMap<string, number>;
  readonly others: readonly unknown[];
}

/** A term of a pattern: a variable, a constant, or `_`. */
export type KernelTerm =
  | { readonly var: string }
  | { readonly const: string | number | boolean }
  | { readonly blank: true };

/** `[e :attr v]`, the attribute always a constant. */
export interface KernelPattern {
  readonly e: KernelTerm;
  readonly attr: string;
  readonly v: KernelTerm;
}

/** `[:find ?x … (count ?y)? :where pattern…]`: a set of rows, or counts grouped by the other columns. */
export interface KernelQuery {
  readonly find: readonly string[];
  readonly count?: string;
  readonly where: readonly KernelPattern[];
}

/** An index a kernel built: it answers an encoded query with encoded rows. */
export interface KernelIndex {
  /** `query` as `encodeQuery` writes it; rows of `width` `(tag, v)` cells, flattened. */
  run(query: Float64Array): {
    readonly width: number;
    readonly tags: Uint8Array;
    readonly values: Float64Array;
  };
  /** Release what the index holds outside the JS heap; a no-op where nothing is. */
  free(): void;
}

/** A datom kernel: builds an index from encoded datoms. */
export interface DatomKernel {
  readonly name: string;
  build(encoded: Encoded): KernelIndex;
}

/** kb's datoms, as the columns every kernel reads. */
export function encodeDatoms(datoms: readonly Datom[]): Encoded {
  const n = datoms.length;
  const e = new Uint32Array(n);
  const a = new Uint32Array(n);
  const t = new Uint8Array(n);
  const v = new Float64Array(n);
  const attrs: string[] = [];
  const attrIndex = new Map<string, number>();
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const others: unknown[] = [];
  datoms.forEach(([entity, attr, value], i) => {
    // A string entity is a transaction's tempid; datoms read from an index carry eids.
    if (typeof entity !== "number") throw new Error(`encodeDatoms: datom ${i} has no eid`);
    e[i] = entity;
    let ai = attrIndex.get(attr);
    if (ai === undefined) {
      ai = attrs.length;
      attrs.push(attr);
      attrIndex.set(attr, ai);
    }
    a[i] = ai;
    if (typeof value === "number") {
      t[i] = TAG.num;
      v[i] = value;
    } else if (typeof value === "string") {
      let si = stringIndex.get(value);
      if (si === undefined) {
        si = strings.length;
        strings.push(value);
        stringIndex.set(value, si);
      }
      t[i] = TAG.str;
      v[i] = si;
    } else if (typeof value === "boolean") {
      t[i] = TAG.bool;
      v[i] = value ? 1 : 0;
    } else {
      t[i] = TAG.other;
      v[i] = others.length;
      others.push(value);
    }
  });
  return { e, a, t, v, attrs, strings, attrIndex, stringIndex, others };
}

/** Term kinds in an encoded query. */
const KIND = { var: 0, const: 1, blank: 2 } as const;

/**
 * `query` as numbers, against `encoded`'s tables: `[nVars, nFind, find…,
 * countVar|-1, nPatterns, (eKind, eTag, eVal, attr, vKind, vTag, vVal)…]`.
 * A constant no datom holds (an unknown string or attribute) encodes to a
 * value no datom has, so the query answers nothing, as DataScript would.
 */
export function encodeQuery(query: KernelQuery, encoded: Encoded): Float64Array {
  const vars = new Map<string, number>();
  const varOf = (name: string) => {
    let i = vars.get(name);
    if (i === undefined) {
      i = vars.size;
      vars.set(name, i);
    }
    return i;
  };
  const term = (x: KernelTerm): [number, number, number] => {
    if ("var" in x) return [KIND.var, 0, varOf(x.var)];
    if ("blank" in x) return [KIND.blank, 0, 0];
    const c = x.const;
    if (typeof c === "number") return [KIND.const, TAG.num, c];
    if (typeof c === "boolean") return [KIND.const, TAG.bool, c ? 1 : 0];
    return [KIND.const, TAG.str, encoded.stringIndex.get(c) ?? -1];
  };
  const body: number[] = [];
  for (const p of query.where) {
    body.push(...term(p.e), encoded.attrIndex.get(p.attr) ?? -1, ...term(p.v));
  }
  const find = query.find.map(varOf);
  const count = query.count === undefined ? -1 : varOf(query.count);
  return Float64Array.from([vars.size, find.length, ...find, count, query.where.length, ...body]);
}

/** Rows a kernel answered, as values: strings and others looked up, counts as numbers. */
export function decodeRows(
  out: { readonly width: number; readonly tags: Uint8Array; readonly values: Float64Array },
  encoded: Encoded,
): unknown[][] {
  const rows: unknown[][] = [];
  const { width, tags, values } = out;
  for (let r = 0; r * width < values.length; r++) {
    const row: unknown[] = [];
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const tag = tags[i];
      const value = values[i] ?? 0;
      row.push(
        tag === TAG.str
          ? encoded.strings[value]
          : tag === TAG.bool
            ? value === 1
            : tag === TAG.other
              ? encoded.others[value]
              : value,
      );
    }
    rows.push(row);
  }
  return rows;
}
