//! EXPERIMENT: kb's datom kernel in Rust, compiled to WebAssembly.
//!
//! The same algorithm as `@kb/query`'s `ts-kernel.ts`, line for line where
//! the languages allow, so the two measure the language and runtime and not
//! two designs: two sorted permutations of the datoms (EAVT, AVET), and a
//! left-to-right index nested-loop join whose rows are deduplicated on what
//! the query finds. What crosses the boundary is typed arrays only; the
//! encoding is `@kb/query`'s `kernel/contract.ts`.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

const TAG_NUM: u8 = 0;

#[wasm_bindgen]
pub struct Index {
    e: Vec<u32>,
    a: Vec<u32>,
    t: Vec<u8>,
    v: Vec<f64>,
    eavt: Vec<u32>,
    avet: Vec<u32>,
    out_tags: Vec<u8>,
    out_vals: Vec<f64>,
}

fn cmp_f64(x: f64, y: f64) -> Ordering {
    x.partial_cmp(&y).unwrap_or(Ordering::Equal)
}

/// First position in `order` whose datom is not below the key, by `below`.
fn lower_bound(order: &[u32], below: impl Fn(usize) -> bool) -> usize {
    let (mut lo, mut hi) = (0usize, order.len());
    while lo < hi {
        let mid = (lo + hi) / 2;
        if below(order[mid] as usize) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

#[wasm_bindgen]
impl Index {
    /// Build both permutations. The columns are copied in by the binding.
    #[wasm_bindgen(constructor)]
    pub fn new(e: Vec<u32>, a: Vec<u32>, t: Vec<u8>, v: Vec<f64>) -> Index {
        let n = e.len() as u32;
        let mut eavt: Vec<u32> = (0..n).collect();
        eavt.sort_unstable_by(|&i, &j| {
            let (i, j) = (i as usize, j as usize);
            e[i].cmp(&e[j])
                .then(a[i].cmp(&a[j]))
                .then(t[i].cmp(&t[j]))
                .then(cmp_f64(v[i], v[j]))
        });
        let mut avet: Vec<u32> = (0..n).collect();
        avet.sort_unstable_by(|&i, &j| {
            let (i, j) = (i as usize, j as usize);
            a[i].cmp(&a[j])
                .then(t[i].cmp(&t[j]))
                .then(cmp_f64(v[i], v[j]))
                .then(e[i].cmp(&e[j]))
        });
        Index { e, a, t, v, eavt, avet, out_tags: Vec::new(), out_vals: Vec::new() }
    }

    fn by_entity(&self, en: u32, at: u32) -> (usize, usize) {
        let (e, a) = (&self.e, &self.a);
        let lo = lower_bound(&self.eavt, |d| e[d] < en || (e[d] == en && a[d] < at));
        let hi = lower_bound(&self.eavt, |d| e[d] < en || (e[d] == en && a[d] <= at));
        (lo, hi)
    }

    fn by_value(&self, at: u32, vt: u8, vv: f64, with_value: bool) -> (usize, usize) {
        let (a, t, v) = (&self.a, &self.t, &self.v);
        if !with_value {
            return (
                lower_bound(&self.avet, |d| a[d] < at),
                lower_bound(&self.avet, |d| a[d] <= at),
            );
        }
        let below = |d: usize, inclusive: bool| {
            if a[d] != at {
                return a[d] < at;
            }
            if t[d] != vt {
                return t[d] < vt;
            }
            if inclusive { v[d] <= vv } else { v[d] < vv }
        };
        (
            lower_bound(&self.avet, |d| below(d, false)),
            lower_bound(&self.avet, |d| below(d, true)),
        )
    }

    /// Answer an encoded query; returns the row width. Rows are read back
    /// with `tags()` and `values()`.
    pub fn run(&mut self, q: &[f64]) -> u32 {
        let n_vars = q[0] as usize;
        let n_find = q[1] as usize;
        let find: Vec<usize> = q[2..2 + n_find].iter().map(|&x| x as usize).collect();
        let count_var = q[2 + n_find] as i64;
        let n_pat = q[3 + n_find] as usize;
        let mut p = 4 + n_find;

        let mut bound = vec![false; n_vars];
        let mut tags: Vec<u8> = vec![0; n_vars];
        let mut vals: Vec<f64> = vec![0.0; n_vars];
        let mut rows = 1usize;
        for _ in 0..n_pat {
            if rows == 0 {
                break;
            }
            let (e_kind, e_tag, e_val) = (q[p] as u8, q[p + 1] as u8, q[p + 2]);
            let attr = q[p + 3];
            let (v_kind, v_tag, v_val) = (q[p + 4] as u8, q[p + 5] as u8, q[p + 6]);
            p += 7;
            let e_bound = e_kind == 1 || (e_kind == 0 && bound[e_val as usize]);
            let v_bound = v_kind == 1 || (v_kind == 0 && bound[v_val as usize]);
            let mut next_tags: Vec<u8> = Vec::new();
            let mut next_vals: Vec<f64> = Vec::new();
            let mut next = 0usize;
            if attr >= 0.0 {
                let attr = attr as u32;
                for r in 0..rows {
                    let base = r * n_vars;
                    let (et, ev) = if e_kind == 1 { (e_tag, e_val) } else { (tags[base + e_val as usize], vals[base + e_val as usize]) };
                    let (vt, vv) = if v_kind == 1 { (v_tag, v_val) } else { (tags[base + v_val as usize], vals[base + v_val as usize]) };
                    let mut emit = |d: usize| {
                        if e_kind == 0 && !e_bound && v_kind == 0 && !v_bound && e_val == v_val {
                            // `[?x :a ?x]`, both unbound: the datom must hold its own entity.
                            if self.t[d] != TAG_NUM || self.v[d] != self.e[d] as f64 {
                                return;
                            }
                        }
                        next_tags.extend_from_slice(&tags[base..base + n_vars]);
                        next_vals.extend_from_slice(&vals[base..base + n_vars]);
                        let out = next * n_vars;
                        if e_kind == 0 && !e_bound {
                            next_tags[out + e_val as usize] = TAG_NUM;
                            next_vals[out + e_val as usize] = self.e[d] as f64;
                        }
                        if v_kind == 0 && !v_bound {
                            next_tags[out + v_val as usize] = self.t[d];
                            next_vals[out + v_val as usize] = self.v[d];
                        }
                        next += 1;
                    };
                    if e_bound {
                        if et != TAG_NUM {
                            continue;
                        }
                        let (lo, hi) = self.by_entity(ev as u32, attr);
                        for i in lo..hi {
                            let d = self.eavt[i] as usize;
                            if v_bound && (self.t[d] != vt || self.v[d] != vv) {
                                continue;
                            }
                            emit(d);
                        }
                    } else {
                        let (lo, hi) = self.by_value(attr, vt, vv, v_bound);
                        for i in lo..hi {
                            emit(self.avet[i] as usize);
                        }
                    }
                }
            }
            if e_kind == 0 {
                bound[e_val as usize] = true;
            }
            if v_kind == 0 {
                bound[v_val as usize] = true;
            }
            tags = next_tags;
            vals = next_vals;
            rows = next;
        }
        self.project(rows, n_vars, &tags, &vals, &find, count_var)
    }

    fn project(&mut self, rows: usize, n_vars: usize, tags: &[u8], vals: &[f64], find: &[usize], count_var: i64) -> u32 {
        let mut cols: Vec<usize> = find.to_vec();
        if count_var >= 0 {
            cols.push(count_var as usize);
        }
        let key = |base: usize, cols: &[usize]| -> Vec<u64> {
            cols.iter().flat_map(|&c| [tags[base + c] as u64, vals[base + c].to_bits()]).collect()
        };
        let mut seen: HashSet<Vec<u64>> = HashSet::new();
        let mut groups: HashMap<Vec<u64>, usize> = HashMap::new();
        let width = find.len() + if count_var >= 0 { 1 } else { 0 };
        self.out_tags.clear();
        self.out_vals.clear();
        for r in 0..rows {
            let base = r * n_vars;
            if !seen.insert(key(base, &cols)) {
                continue;
            }
            if count_var < 0 {
                for &c in find {
                    self.out_tags.push(tags[base + c]);
                    self.out_vals.push(vals[base + c]);
                }
                continue;
            }
            let group = key(base, find);
            match groups.get(&group) {
                Some(&at) => self.out_vals[at * width + find.len()] += 1.0,
                None => {
                    groups.insert(group, self.out_vals.len() / width);
                    for &c in find {
                        self.out_tags.push(tags[base + c]);
                        self.out_vals.push(vals[base + c]);
                    }
                    self.out_tags.push(TAG_NUM);
                    self.out_vals.push(1.0);
                }
            }
        }
        width as u32
    }

    /// The last run's cell tags, row by row.
    pub fn tags(&self) -> Vec<u8> {
        self.out_tags.clone()
    }

    /// The last run's cell values, row by row.
    pub fn values(&self) -> Vec<f64> {
        self.out_vals.clone()
    }
}
