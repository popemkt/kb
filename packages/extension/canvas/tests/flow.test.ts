/**
 * The canvas computer's engine (`flow.ts`): components are items standing
 * for nodes, joined by edges; a plan orders them upstream first with ties
 * in document order; a run hands each step its inputs' latest outputs
 * through a stub performer, skips what follows a failure, and runs a loop
 * only the rounds it is given, never more than the bound.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  MAX_FLOW_ROUNDS,
  flowPlan,
  runFlow,
  type CanvasDoc,
  type FlowResult,
  type FlowStep,
} from "../src/index.ts";

const card = (id: string) => ({
  id,
  type: "kb-node" as const,
  nodeId: `n.${id}`,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
});
const wire = (fromNode: string, toNode: string) => ({
  id: `${fromNode}-${toNode}`,
  fromNode,
  toNode,
});

/** A doc of cards `ids` (in that document order) joined by `wires`, and a text item no flow takes. */
function board(ids: string[], wires: [string, string][]): CanvasDoc {
  return {
    nodes: [
      ...ids.map(card),
      { id: "note", type: "text", text: "not a component", x: 0, y: 0, width: 10, height: 10 },
    ],
    edges: [...wires.map(([a, b]) => wire(a, b)), wire("note", ids[0] ?? "")],
  };
}

/** A stub performer: a constant says its node id; any other joins its inputs with its node id; `failing` fails. */
function stub(failing: ReadonlySet<string> = new Set()) {
  const seen: string[] = [];
  const perform = (step: FlowStep) =>
    Effect.sync((): FlowResult => {
      seen.push(`${step.component.item}@${String(step.round)}`);
      if (failing.has(step.component.item)) return { ok: false, message: "it broke" };
      const output =
        step.inputs.length === 0
          ? step.component.nodeId
          : `${step.component.item}(${step.inputs.map((i) => i.text).join(",")})`;
      return { ok: true, output, by: step.inputs.length === 0 ? "constant" : "model" };
    });
  return { perform, seen };
}

const none = () => undefined;

describe("flowPlan", () => {
  test("orders components upstream first, ties in document order, and leaves out what stands for no node", () => {
    // d is first in the document but waits for b and c.
    const plan = flowPlan(
      board(
        ["d", "c", "b", "a"],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "d"],
          ["c", "d"],
        ],
      ),
    );
    expect(plan.order).toEqual(["a", "c", "b", "d"]);
    expect(plan.cyclic).toBe(false);
    expect(plan.components.find((c) => c.item === "d")).toEqual({
      item: "d",
      nodeId: "n.d",
      inputs: ["b", "c"],
    });
    expect(plan.components.map((c) => c.item)).not.toContain("note");
  });

  test("from is that component and what it reaches; a from that is no component is refused", () => {
    const doc = board(
      ["a", "b", "c", "x"],
      [
        ["a", "b"],
        ["b", "c"],
        ["x", "c"],
      ],
    );
    const plan = flowPlan(doc, "b");
    expect(plan.order).toEqual(["b", "c"]);
    // x is not reached, so c's input from it is not part of this run.
    expect(plan.components.find((c) => c.item === "c")?.inputs).toEqual(["b"]);
    expect(() => flowPlan(doc, "note")).toThrow(/note is no component/);
  });

  test("a loop is cyclic, its members after what feeds it, in document order", () => {
    const plan = flowPlan(
      board(
        ["seed", "grow", "check"],
        [
          ["seed", "grow"],
          ["grow", "check"],
          ["check", "grow"],
        ],
      ),
    );
    expect(plan.cyclic).toBe(true);
    expect(plan.order).toEqual(["seed", "grow", "check"]);
  });
});

describe("runFlow", () => {
  test("each step is handed its inputs' outputs in edge order, and the outcomes are in run order", async () => {
    const plan = flowPlan(
      board(
        ["a", "b", "c"],
        [
          ["a", "c"],
          ["b", "c"],
        ],
      ),
    );
    const { perform } = stub();
    const run = await Effect.runPromise(runFlow(plan, perform, { stored: none }));
    expect(run).toEqual({
      rounds: 1,
      steps: 3,
      outcomes: [
        { item: "a", status: "done", output: "n.a", by: "constant" },
        { item: "b", status: "done", output: "n.b", by: "constant" },
        { item: "c", status: "done", output: "c(n.a,n.b)", by: "model" },
      ],
    });
  });

  test("what follows a failure is skipped, naming it; what does not depend on it still runs", async () => {
    const plan = flowPlan(
      board(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["b", "c"],
          ["d", "c"],
          ["d", "x"],
        ],
      ),
    );
    const { perform, seen } = stub(new Set(["a"]));
    const run = await Effect.runPromise(runFlow(plan, perform, { stored: none }));
    expect(run.outcomes).toEqual([
      { item: "a", status: "failed", message: "it broke" },
      { item: "b", status: "skipped", after: ["a"] },
      { item: "d", status: "done", output: "n.d", by: "constant" },
      { item: "c", status: "skipped", after: ["b"] },
    ]);
    expect(seen).toEqual(["a@1", "d@1"]);
  });

  test("a loop runs the rounds it is given, its back edge read from the round before (or what is stored)", async () => {
    const plan = flowPlan(
      board(
        ["seed", "grow", "check"],
        [
          ["seed", "grow"],
          ["grow", "check"],
          ["check", "grow"],
        ],
      ),
    );
    const { perform } = stub();
    const once = await Effect.runPromise(
      runFlow(plan, perform, { stored: (item) => (item === "check" ? "stored" : undefined) }),
    );
    expect(once.outcomes.find((o) => o.item === "grow")).toMatchObject({
      output: "grow(n.seed,stored)",
    });
    const twice = await Effect.runPromise(runFlow(plan, perform, { rounds: 2, stored: none }));
    expect(twice).toMatchObject({ rounds: 2, steps: 6 });
    expect(twice.outcomes.find((o) => o.item === "grow")).toMatchObject({
      output: "grow(n.seed,check(grow(n.seed)))",
    });
    const bounded = await Effect.runPromise(runFlow(plan, perform, { rounds: 100, stored: none }));
    expect(bounded.rounds).toBe(MAX_FLOW_ROUNDS);
  });

  test("an acyclic flow runs once whatever rounds it is given", async () => {
    const plan = flowPlan(board(["a", "b"], [["a", "b"]]));
    const run = await Effect.runPromise(runFlow(plan, stub().perform, { rounds: 5, stored: none }));
    expect(run).toMatchObject({ rounds: 1, steps: 2 });
  });
});
