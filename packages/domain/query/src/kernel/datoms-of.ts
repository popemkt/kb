/**
 * EXPERIMENT: kb's datoms for a node set, and a kernel query as the EDN
 * DataScript answers — what the kernels are built from and checked against.
 */
import type { KbNode } from "@kb/model";
import type { DerivedRef } from "../index/derived.ts";
import { nodeToDatoms, type Datom, type IdMap } from "../index/datoms.ts";
import type { KernelQuery, KernelTerm } from "./contract.ts";

/** Every node's datoms, eids assigned in node order from 1, as the index assigns them on a first build. */
export function datomsOf(nodes: readonly KbNode[], derived: readonly DerivedRef[]): Datom[] {
  const ids: IdMap = { toEid: new Map(), toId: new Map() };
  nodes.forEach((node, i) => {
    ids.toEid.set(node.id, i + 1);
    ids.toId.set(i + 1, node.id);
  });
  const datoms: Datom[] = [];
  for (const node of nodes) for (const d of nodeToDatoms(node, ids, derived).datoms) datoms.push(d);
  return datoms;
}

function ednTerm(term: KernelTerm): string {
  if ("var" in term) return term.var;
  if ("blank" in term) return "_";
  return typeof term.const === "string" ? JSON.stringify(term.const) : String(term.const);
}

/** `query` in DataScript's dialect. */
export function kernelQueryEdn(query: KernelQuery): string {
  const find = [...query.find, ...(query.count === undefined ? [] : [`(count ${query.count})`])];
  const where = query.where.map((p) => `[${ednTerm(p.e)} ${p.attr} ${ednTerm(p.v)}]`);
  return `[:find ${find.join(" ")} :where ${where.join(" ")}]`;
}
