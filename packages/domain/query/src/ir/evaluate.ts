/**
 * The condition model evaluated over nodes in JS: the narrowing placement's
 * implementation (`conditions.ts`), until a view's narrowing runs in datalog
 * with its frame's query. GAP [[01M5E7RM5EQ2TSJZSMM330T5DH]]
 *
 * It answers what `compile(lowerIr(conditions))` answers on kb's index, row
 * by row, over the values as the index stores them (`datoms.ts`): a ref to a
 * node that exists is that node, a dangling one is its id as text, a date is
 * its text. The shared contract property (`evaluate.test.ts`) holds the two
 * to one answer. Where DataScript orders values of different kinds against
 * each other (a number field compared with a date), this answers false.
 */
import { SYSTEM_IDS, type ClockSample, type KbNode, type NodeId } from "@kb/model";
import type { DerivedRef } from "../index/derived.ts";
import {
  canonicalConditions,
  includesFn,
  isGroup,
  isRow,
  labelNumber,
  type CompareOp,
  type ConditionEdge,
  type ConditionRow,
  type ConditionValue,
  type NarrowingCondition,
} from "./conditions.ts";
import { kbFunctions } from "./kb-functions.ts";

/** What the evaluator reads of the graph a node is in. */
export interface ConditionGraph {
  /** A node by id, when it exists. */
  readonly node: (id: NodeId) => KbNode | undefined;
  /** The nodes `node` references (`:node/mentions`): every carrier, existing targets only. */
  readonly mentions: (node: KbNode) => ReadonlySet<NodeId>;
  /** The run's one clock sample, for the date rows; without one, a date row fails naming its function. */
  readonly clock?: ClockSample;
}

/**
 * The graph over `nodes`, its reference relation read by the carriers of
 * `derived` (the table the index builds, `derivedWith`), each node's read once.
 */
export function conditionGraph(
  nodes: ReadonlyMap<NodeId, KbNode>,
  derived: readonly DerivedRef[],
  clock?: ClockSample,
): ConditionGraph {
  const carriers = derived.find((d) => d.attr === ":node/mentions")?.carriers ?? [];
  const memo = new Map<NodeId, ReadonlySet<NodeId>>();
  const mentions = (node: KbNode): ReadonlySet<NodeId> => {
    let out = memo.get(node.id);
    if (out === undefined) {
      const ids = carriers.flatMap((carrier) => [...carrier.refsOf(node)]);
      out = new Set(ids.filter((id) => nodes.has(id)));
      memo.set(node.id, out);
    }
    return out;
  };
  return { node: (id) => nodes.get(id), mentions, ...(clock === undefined ? {} : { clock }) };
}

/** A field's value as the index stores it. */
type Datum =
  | { readonly t: "ref"; readonly id: NodeId }
  | { readonly t: "str"; readonly v: string }
  | { readonly t: "num"; readonly v: number }
  | { readonly t: "bool"; readonly v: boolean };

function datumsOf(node: KbNode, field: string, graph: ConditionGraph): Datum[] {
  return (node.props[field] ?? []).map((pv): Datum => {
    if (pv.t === "ref")
      return graph.node(pv.v) === undefined ? { t: "str", v: pv.v } : { t: "ref", id: pv.v };
    if (pv.t === "date") return { t: "str", v: pv.v };
    return pv;
  });
}

function matchesValue(value: ConditionValue, d: Datum, graph: ConditionGraph): boolean {
  if (value.t === "ref") return d.t === "ref" && d.id === value.v;
  if (value.t === "label") return matchesLabel(value.v, d, graph);
  return d.t === value.t && d.v === value.v;
}

/** A label is a value whose text it is: a text, a node's id or text, the number or boolean it reads as. */
function matchesLabel(label: string, d: Datum, graph: ConditionGraph): boolean {
  if (d.t === "str") return d.v === label;
  if (d.t === "ref") return d.id === label || graph.node(d.id)?.text === label;
  if (d.t === "num") return labelNumber(label) === d.v;
  return String(d.v) === label;
}

function compares(a: string | number, op: CompareOp, b: string | number): boolean {
  if (op === "<") return a < b;
  if (op === "<=") return a <= b;
  if (op === ">") return a > b;
  return a >= b;
}

/** The nodes `node` steps to along `edge`: its existing children, the nodes it references, or a ref field's nodes. */
function stepsOf(node: KbNode, edge: ConditionEdge, graph: ConditionGraph): Iterable<NodeId> {
  if (edge.t === "child") return node.children.filter((id) => graph.node(id) !== undefined);
  if (edge.t === "mentions") return graph.mentions(node);
  return datumsOf(node, edge.field, graph).flatMap((d) => (d.t === "ref" ? [d.id] : []));
}

/** Every node `from` reaches along `edge` in 1..`maxHops` steps (unbounded when absent). */
function reached(
  from: KbNode,
  edge: ConditionEdge,
  graph: ConditionGraph,
  maxHops?: number,
): Set<NodeId> {
  const seen = new Set<NodeId>();
  const hops = maxHops ?? Number.POSITIVE_INFINITY;
  let frontier = [from];
  for (let hop = 1; frontier.length > 0 && hop <= hops; hop++) {
    const next: KbNode[] = [];
    for (const n of frontier) {
      for (const id of stepsOf(n, edge, graph)) {
        const target = graph.node(id);
        if (seen.has(id) || target === undefined) continue;
        seen.add(id);
        next.push(target);
      }
    }
    frontier = next;
  }
  return seen;
}

/** `attr`'s window over the run's clock sample, as the kb functions answer it. */
function windowOf(
  row: Extract<ConditionRow, { kind: "instant-within" | "date-within" }>,
  graph: ConditionGraph,
): [string, string] {
  const fns = kbFunctions(graph.clock);
  if (row.kind === "instant-within") {
    return [String(fns["kb/instant-days-ago"](row.days)), String(fns["kb/instant-now"]())];
  }
  const today = String(fns["kb/today"]());
  return row.direction === "next"
    ? [today, String(fns["kb/date-in-days"](row.days))]
    : [String(fns["kb/date-in-days"](0 - row.days)), today];
}

const within = (v: string, [lo, hi]: [string, string]) => lo <= v && v <= hi;

/** A row over `node`, by kind; a negated row is its positive one negated, so the two cannot drift. */
type Evaluation<K extends ConditionRow["kind"]> = (
  row: Extract<ConditionRow, { kind: K }>,
  node: KbNode,
  graph: ConditionGraph,
) => boolean;

const anchor = (id: string, graph: ConditionGraph) => graph.node(id);

const EVALUATIONS: { readonly [K in ConditionRow["kind"]]: Evaluation<K> } = {
  "has-tag": (row, node, graph) =>
    datumsOf(node, SYSTEM_IDS.typeField, graph).some((d) => d.t === "ref" && d.id === row.tag),
  "lacks-tag": (row, node, graph) => !matchesRow({ kind: "has-tag", tag: row.tag }, node, graph),
  "field-set": (row, node, graph) => datumsOf(node, row.field, graph).length > 0,
  "field-unset": (row, node, graph) =>
    !matchesRow({ kind: "field-set", field: row.field }, node, graph),
  "field-is": (row, node, graph) => {
    const datums = datumsOf(node, row.field, graph);
    return row.values.some((value) => datums.some((d) => matchesValue(value, d, graph)));
  },
  "field-is-not": (row, node, graph) =>
    !matchesRow({ kind: "field-is", field: row.field, values: row.values }, node, graph),
  "field-contains": (row, node, graph) => {
    const contains = kbFunctions(undefined)[includesFn(row.exactCase)];
    return datumsOf(node, row.field, graph).some(
      (d) => d.t === "str" && contains(d.v, row.text) === true,
    );
  },
  "field-compares": (row, node, graph) => {
    const { op, value } = row;
    return datumsOf(node, row.field, graph).some(
      (d) =>
        (d.t === "num" && value.t === "num" && compares(d.v, op, value.v)) ||
        (d.t === "str" && value.t === "str" && compares(d.v, op, value.v)),
    );
  },
  "text-contains": (row, node) =>
    kbFunctions(undefined)[includesFn(row.exactCase)](node.text, row.text) === true,
  "instant-within": (row, node, graph) =>
    within(row.attr === "created" ? node.createdAt : node.updatedAt, windowOf(row, graph)),
  "date-within": (row, node, graph) => {
    const window = windowOf(row, graph);
    return datumsOf(node, row.field, graph).some((d) => d.t === "str" && within(d.v, window));
  },
  under: (row, node, graph) => {
    const from = anchor(row.node, graph);
    return from !== undefined && reached(from, row.via, graph, row.maxHops).has(node.id);
  },
  above: (row, node, graph) =>
    anchor(row.node, graph) !== undefined &&
    reached(node, row.via, graph, row.maxHops).has(row.node),
  "child-of": (row, node, graph) => anchor(row.node, graph)?.children.includes(node.id) === true,
  "has-children": (_row, node, graph) => node.children.some((id) => graph.node(id) !== undefined),
  "links-to": (row, node, graph) => graph.mentions(node).has(row.node),
  "linked-from": (row, node, graph) => {
    const from = anchor(row.node, graph);
    return from !== undefined && graph.mentions(from).has(node.id);
  },
};

function matchesRow(row: ConditionRow, node: KbNode, graph: ConditionGraph): boolean {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the table is keyed by kind, so EVALUATIONS[row.kind] takes this row; TypeScript cannot correlate the two
  const evaluate = EVALUATIONS[row.kind] as (
    row: ConditionRow,
    node: KbNode,
    graph: ConditionGraph,
  ) => boolean;
  return evaluate(row, node, graph);
}

/** The text a value shows: a ref its node's text (its id when that is empty or gone), any other its text. */
function valueLabel(d: { t: string; v: unknown }, graph: ConditionGraph): string {
  if (d.t !== "ref") return String(d.v);
  const id = String(d.v);
  const text = graph.node(id)?.text;
  return text === undefined || text === "" ? id : text;
}

/** `anywhere-contains`: an empty text holds everywhere; else the node's text or any value's label contains it. */
function matchesAnywhere(
  text: string,
  exactCase: boolean,
  node: KbNode,
  graph: ConditionGraph,
): boolean {
  if (text === "") return true;
  const contains = kbFunctions(undefined)[includesFn(exactCase)];
  if (contains(node.text, text) === true) return true;
  return Object.values(node.props).some((values) =>
    values.some((pv) => contains(valueLabel(pv, graph), text) === true),
  );
}

function matches(c: NarrowingCondition, node: KbNode, graph: ConditionGraph): boolean {
  if (isGroup(c)) {
    if (c.kind === "all-of") return c.conditions.every((x) => matches(x, node, graph));
    const any = c.branches.some((b) => b.every((x) => matches(x, node, graph)));
    return c.kind === "any-of" ? any : !any;
  }
  if (isRow(c)) return matchesRow(c, node, graph);
  return matchesAnywhere(c.text, c.exactCase, node, graph);
}

/**
 * Whether a node meets every one of `conditions`, as the query they lower
 * to answers it: read in their canonical form (`canonicalConditions`), so an
 * empty group constrains nothing here as it does there.
 */
export function conditionsMatcher(
  conditions: readonly NarrowingCondition[],
  graph: ConditionGraph,
): (node: KbNode) => boolean {
  const canonical = canonicalConditions(conditions);
  return (node) => canonical.every((c) => matches(c, node, graph));
}
