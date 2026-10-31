/**
 * EXPERIMENT: the datom kernel in TypeScript, over typed arrays — the
 * control the Rust→WASM kernel is measured against. Same algorithm as
 * `datom-kernel-wasm`'s crate, line for line where the languages allow: two
 * sorted permutations of the datoms (EAVT, AVET), and a left-to-right index
 * nested-loop join, rows deduplicated on what the query finds.
 */
import { TAG, type DatomKernel, type Encoded, type KernelIndex } from "./contract.ts";

type Cols = Pick<Encoded, "e" | "a" | "t" | "v">;

function sortedBy(n: number, cmp: (i: number, j: number) => number): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort(cmp);
  return order;
}

/** First position in `order` whose datom is not below the key, by `below`. */
function lowerBound(order: Uint32Array, below: (d: number) => boolean): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (below(order[mid] ?? 0)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class TsIndex implements KernelIndex {
  readonly #c: Cols;
  readonly #eavt: Uint32Array;
  readonly #avet: Uint32Array;

  constructor(c: Cols) {
    this.#c = c;
    const { e, a, t, v } = c;
    const n = e.length;
    this.#eavt = sortedBy(
      n,
      (i, j) =>
        (e[i] ?? 0) - (e[j] ?? 0) ||
        (a[i] ?? 0) - (a[j] ?? 0) ||
        (t[i] ?? 0) - (t[j] ?? 0) ||
        (v[i] ?? 0) - (v[j] ?? 0),
    );
    this.#avet = sortedBy(
      n,
      (i, j) =>
        (a[i] ?? 0) - (a[j] ?? 0) ||
        (t[i] ?? 0) - (t[j] ?? 0) ||
        (v[i] ?? 0) - (v[j] ?? 0) ||
        (e[i] ?? 0) - (e[j] ?? 0),
    );
  }

  /** The EAVT positions of entity `en`'s datoms on attribute `at`. */
  #byEntity(en: number, at: number): [number, number] {
    const { e, a } = this.#c;
    const o = this.#eavt;
    const lo = lowerBound(o, (d) => (e[d] ?? 0) < en || (e[d] === en && (a[d] ?? 0) < at));
    const hi = lowerBound(o, (d) => (e[d] ?? 0) < en || (e[d] === en && (a[d] ?? 0) <= at));
    return [lo, hi];
  }

  /** The AVET positions of attribute `at`'s datoms, with value `(vt, vv)` when given. */
  #byValue(at: number, vt: number, vv: number, withValue: boolean): [number, number] {
    const { a, t, v } = this.#c;
    const o = this.#avet;
    if (!withValue) {
      return [lowerBound(o, (d) => (a[d] ?? 0) < at), lowerBound(o, (d) => (a[d] ?? 0) <= at)];
    }
    const below = (d: number, inclusive: boolean) => {
      const ad = a[d] ?? 0;
      if (ad !== at) return ad < at;
      const td = t[d] ?? 0;
      if (td !== vt) return td < vt;
      return inclusive ? (v[d] ?? 0) <= vv : (v[d] ?? 0) < vv;
    };
    return [lowerBound(o, (d) => below(d, false)), lowerBound(o, (d) => below(d, true))];
  }

  run(q: Float64Array) {
    const { e, t, v } = this.#c;
    const nVars = q[0] ?? 0;
    const nFind = q[1] ?? 0;
    const find = Array.from(q.subarray(2, 2 + nFind));
    const countVar = q[2 + nFind] ?? 0;
    const nPat = q[3 + nFind] ?? 0;
    let p = 4 + nFind;

    const bound = Array.from({ length: nVars }, () => false);
    let tags: number[] = Array.from({ length: nVars }, () => 0);
    let vals: number[] = Array.from({ length: nVars }, () => 0);
    let rows = 1;
    for (let k = 0; k < nPat && rows > 0; k++, p += 7) {
      const scan = scanAt(q, p, bound);
      const { eKind, eVal, vKind, vVal, eBound, vBound, attr } = scan;
      const nextTags: number[] = [];
      const nextVals: number[] = [];
      let next = 0;
      const emit = (r: number, d: number) => {
        const base = r * nVars;
        for (let c = 0; c < nVars; c++) {
          nextTags.push(tags[base + c] ?? 0);
          nextVals.push(vals[base + c] ?? 0);
        }
        const out = next * nVars;
        if (eKind === 0 && !eBound) {
          nextTags[out + eVal] = TAG.num;
          nextVals[out + eVal] = e[d] ?? 0;
        }
        if (vKind === 0 && !vBound) {
          // `[?x :a ?x]`, both unbound: the datom must hold its own entity.
          if (eKind === 0 && eVal === vVal && !eBound) {
            if (t[d] !== TAG.num || v[d] !== e[d]) {
              nextTags.length = out;
              nextVals.length = out;
              return;
            }
          }
          nextTags[out + vVal] = t[d] ?? 0;
          nextVals[out + vVal] = v[d] ?? 0;
        }
        next++;
      };
      if (attr >= 0) {
        for (let r = 0; r < rows; r++)
          this.#scanRow(scan, r * nVars, tags, vals, (d) => emit(r, d));
      }
      if (eKind === 0) bound[eVal] = true;
      if (vKind === 0) bound[vVal] = true;
      tags = nextTags;
      vals = nextVals;
      rows = next;
    }
    return project({ rows, nVars, tags, vals }, find, countVar);
  }

  /** The datoms one pattern matches for the row at `base`, each passed to `emit`. */
  #scanRow(
    s: Scan,
    base: number,
    tags: readonly number[],
    vals: readonly number[],
    emit: (d: number) => void,
  ) {
    const { t, v } = this.#c;
    const et = s.eKind === 1 ? s.eTag : (tags[base + s.eVal] ?? 0);
    const ev = s.eKind === 1 ? s.eVal : (vals[base + s.eVal] ?? 0);
    const vt = s.vKind === 1 ? s.vTag : (tags[base + s.vVal] ?? 0);
    const vv = s.vKind === 1 ? s.vVal : (vals[base + s.vVal] ?? 0);
    if (!s.eBound) {
      const [lo, hi] = this.#byValue(s.attr, vt, vv, s.vBound);
      for (let i = lo; i < hi; i++) emit(this.#avet[i] ?? 0);
      return;
    }
    if (et !== TAG.num) return;
    const [lo, hi] = this.#byEntity(ev, s.attr);
    for (let i = lo; i < hi; i++) {
      const d = this.#eavt[i] ?? 0;
      if (s.vBound && (t[d] !== vt || v[d] !== vv)) continue;
      emit(d);
    }
  }

  free(): void {}
}

/** One decoded pattern, with which of its terms the rows already bind. */
interface Scan {
  readonly eKind: number;
  readonly eTag: number;
  readonly eVal: number;
  readonly attr: number;
  readonly vKind: number;
  readonly vTag: number;
  readonly vVal: number;
  readonly eBound: boolean;
  readonly vBound: boolean;
}

/** The pattern encoded at `p`, against the variables bound so far. */
function scanAt(q: Float64Array, p: number, bound: readonly boolean[]): Scan {
  const eKind = q[p] ?? 0;
  const eVal = q[p + 2] ?? 0;
  const vKind = q[p + 4] ?? 0;
  const vVal = q[p + 6] ?? 0;
  return {
    eKind,
    eTag: q[p + 1] ?? 0,
    eVal,
    attr: q[p + 3] ?? -1,
    vKind,
    vTag: q[p + 5] ?? 0,
    vVal,
    eBound: eKind === 1 || (eKind === 0 && bound[eVal] === true),
    vBound: vKind === 1 || (vKind === 0 && bound[vVal] === true),
  };
}

/** The rows' find columns, deduplicated; with a count, grouped by the find columns and counted. */
function project(
  {
    rows,
    nVars,
    tags,
    vals,
  }: { rows: number; nVars: number; tags: readonly number[]; vals: readonly number[] },
  find: readonly number[],
  countVar: number,
) {
  const cols = countVar >= 0 ? [...find, countVar] : find;
  const seen = new Set<string>();
  const outTags: number[] = [];
  const outVals: number[] = [];
  const counts = new Map<string, number>();
  const groups: string[] = [];
  for (let r = 0; r < rows; r++) {
    const base = r * nVars;
    let key = "";
    for (const c of cols) key += `${tags[base + c] ?? 0}:${vals[base + c] ?? 0}|`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (countVar < 0) {
      for (const c of find) {
        outTags.push(tags[base + c] ?? 0);
        outVals.push(vals[base + c] ?? 0);
      }
      continue;
    }
    let group = "";
    for (const c of find) group += `${tags[base + c] ?? 0}:${vals[base + c] ?? 0}|`;
    const had = counts.get(group);
    if (had === undefined) {
      groups.push(group);
      counts.set(group, 1);
      for (const c of find) {
        outTags.push(tags[base + c] ?? 0);
        outVals.push(vals[base + c] ?? 0);
      }
      outTags.push(TAG.num);
      outVals.push(0);
    } else {
      counts.set(group, had + 1);
    }
  }
  if (countVar >= 0) {
    const width = find.length + 1;
    groups.forEach((g, i) => {
      outVals[i * width + find.length] = counts.get(g) ?? 0;
    });
  }
  const width = find.length + (countVar >= 0 ? 1 : 0);
  return { width, tags: Uint8Array.from(outTags), values: Float64Array.from(outVals) };
}

export const tsKernel: DatomKernel = {
  name: "ts",
  build: (encoded) => new TsIndex(encoded),
};
