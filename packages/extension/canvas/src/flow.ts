/**
 * A canvas as a computer (DESIGN.md → Canvas documents → Run): the items
 * that stand for nodes are its components, its edges carry each one's
 * output to the next, and a run performs them upstream first. This module
 * is the engine, pure and deterministic: it orders the components
 * (`flowPlan`) and runs a plan through a performer it is given
 * (`runFlow`), never naming a model or a script. Who performs a step, and
 * where its output is kept, is the caller's.
 */
import { Effect } from "effect";
import type { NodeId } from "@kb/model";
import type { CanvasDoc } from "./doc.ts";

/** A component: an item that stands for a node, and the components whose outputs flow into it, in edge order. */
interface FlowComponent {
  readonly item: string;
  readonly nodeId: NodeId;
  readonly inputs: readonly string[];
}

interface FlowPlan {
  readonly components: readonly FlowComponent[];
  /** Item ids in the order a round performs them: upstream first, ties in document order. */
  readonly order: readonly string[];
  /** Whether any output flows back into a component upstream of it, so a run may take more than one round. */
  readonly cyclic: boolean;
}

/** Why a canvas has no flow to run, said to the caller. */
class FlowError extends Error {
  override readonly name = "FlowError";
}

/**
 * The flow `doc` holds: every item that stands for a node and is an end of
 * an edge between two such items, or, given `from`, that one and every
 * component its outputs reach. Throws `FlowError` for a `from` that is no
 * component.
 */
export function flowPlan(doc: CanvasDoc, from?: string): FlowPlan {
  const standing = new Map<string, NodeId>();
  for (const item of doc.nodes) if (item.nodeId !== undefined) standing.set(item.id, item.nodeId);
  const wires = doc.edges.filter((e) => standing.has(e.fromNode) && standing.has(e.toNode));
  const wired = new Set(wires.flatMap((e) => [e.fromNode, e.toNode]));
  let members = wired;
  if (from !== undefined) {
    if (!standing.has(from)) {
      throw new FlowError(`${from} is no component: a component is an item that stands for a node`);
    }
    members = reach(from, wires);
  }
  const rank = new Map(doc.nodes.map((item, i) => [item.id, i]));
  const components = doc.nodes
    .filter((item) => members.has(item.id))
    .map((item) => ({
      item: item.id,
      nodeId: standing.get(item.id) ?? item.id,
      inputs: wires
        .filter((e) => e.toNode === item.id && members.has(e.fromNode))
        .map((e) => e.fromNode),
    }));
  const { order, cyclic } = upstreamFirst(components, rank);
  return { components, order, cyclic };
}

/** `from` and every item its edges reach, downstream. */
function reach(from: string, wires: readonly { fromNode: string; toNode: string }[]): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const wire of wires) {
      if (wire.fromNode !== next || seen.has(wire.toNode)) continue;
      seen.add(wire.toNode);
      queue.push(wire.toNode);
    }
  }
  return seen;
}

/** Kahn's order, the next ready component always the first in the document; what a cycle holds follows, in document order. */
function upstreamFirst(
  components: readonly FlowComponent[],
  rank: ReadonlyMap<string, number>,
): { order: string[]; cyclic: boolean } {
  const waiting = new Map(
    components.map((c) => [c.item, new Set(c.inputs.filter((i) => i !== c.item))]),
  );
  const byRank = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  const order: string[] = [];
  for (;;) {
    const ready = [...waiting].filter(([, inputs]) => inputs.size === 0).map(([item]) => item);
    if (ready.length === 0) break;
    const [first] = ready.toSorted(byRank);
    if (first === undefined) break;
    order.push(first);
    waiting.delete(first);
    for (const inputs of waiting.values()) inputs.delete(first);
  }
  const cyclic = waiting.size > 0 || components.some((c) => c.inputs.includes(c.item));
  return { order: [...order, ...[...waiting.keys()].toSorted(byRank)], cyclic };
}

/** One step a performer is handed: the component, and what flows into it, in edge order. */
export interface FlowStep {
  readonly component: FlowComponent;
  readonly inputs: readonly { readonly item: string; readonly text: string }[];
  readonly round: number;
}

/** What a performer answers: the output and who made it, or why it could not. */
export type FlowResult =
  | { readonly ok: true; readonly output: string; readonly by: string }
  | { readonly ok: false; readonly message: string };

/** How a component's last round ended. */
type FlowOutcome =
  | { readonly item: string; readonly status: "done"; readonly output: string; readonly by: string }
  | { readonly item: string; readonly status: "failed"; readonly message: string }
  | { readonly item: string; readonly status: "skipped"; readonly after: readonly string[] };

/** At most this many rounds a cyclic flow runs, whatever the caller asks: a loop ends, and spends a bounded amount. */
export const MAX_FLOW_ROUNDS = 8;

interface FlowRun {
  readonly rounds: number;
  readonly steps: number;
  readonly outcomes: readonly FlowOutcome[];
}

/**
 * Run `plan`: each round performs its components in order, each handed the
 * latest outputs of its inputs (`stored` before any is made); a component
 * an input of which failed or was skipped is skipped, naming those. An
 * acyclic flow runs once; a cyclic one `rounds` times (1 to
 * {@link MAX_FLOW_ROUNDS}). The outcomes are each component's last.
 */
export function runFlow<R>(
  plan: FlowPlan,
  perform: (step: FlowStep) => Effect.Effect<FlowResult, never, R>,
  options: { readonly rounds?: number; readonly stored: (item: string) => string | undefined },
): Effect.Effect<FlowRun, never, R> {
  return Effect.gen(function* () {
    const rounds = plan.cyclic ? Math.min(MAX_FLOW_ROUNDS, Math.max(1, options.rounds ?? 1)) : 1;
    const byItem = new Map(plan.components.map((c) => [c.item, c]));
    const outputs = new Map<string, string>();
    let outcomes = new Map<string, FlowOutcome>();
    let steps = 0;
    for (let round = 1; round <= rounds; round += 1) {
      const last = outcomes;
      outcomes = new Map();
      for (const item of plan.order) {
        const component = byItem.get(item);
        if (component === undefined) continue;
        const outcomeOf = (input: string) => outcomes.get(input) ?? last.get(input);
        const after = component.inputs.filter((input) => {
          const status = outcomeOf(input)?.status;
          return status === "failed" || status === "skipped";
        });
        if (after.length > 0) {
          outcomes.set(item, { item, status: "skipped", after });
          continue;
        }
        const inputs = component.inputs.flatMap((input) => {
          const text = outputs.get(input) ?? options.stored(input);
          return text === undefined ? [] : [{ item: input, text }];
        });
        steps += 1;
        const result = yield* perform({ component, inputs, round });
        if (result.ok) {
          outputs.set(item, result.output);
          outcomes.set(item, { item, status: "done", output: result.output, by: result.by });
        } else {
          outcomes.set(item, { item, status: "failed", message: result.message });
        }
      }
    }
    return {
      rounds,
      steps,
      outcomes: plan.order.flatMap((item) => outcomes.get(item) ?? []),
    } satisfies FlowRun;
  });
}
