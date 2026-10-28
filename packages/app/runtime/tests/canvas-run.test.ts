/**
 * `ext.canvas.run` through the invoke core: a canvas as a computer. Cards
 * standing for nodes are its components and its edges carry outputs;
 * constants say their words, a component whose node names a script runs
 * it on its inputs, and an instruction asks the agent family's model,
 * which no host here serves, so it fails by name and what follows it is
 * skipped. Every output is its node's `output` field. The engine's own
 * cases, with a stub model, are `@kb/canvas`'s `flow.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CODE_IDS } from "@kb/code";
import type { ActionReceipt } from "@kb/contracts";
import { canonicalJson, present } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

/** Doubles each number its node's `input` holds, and leaves them, joined, as its `output`. */
const DOUBLE = `const me = await kb.node(kb.subject);
const ins = (me.props["f.input"] || []).map((value) => Number(value.v) * 2);
await kb.invoke("node.update", {
  id: kb.subject,
  unsetProps: [{ field: "f.output" }],
  setProps: [{ field: "f.output", value: { t: "str", v: ins.join(",") } }],
});`;
const GRANT = { reads: "subject" as const, actions: ["node.update"] };

const card = (id: string, x: number) => ({
  id,
  type: "kb-node",
  nodeId: `n.${id}`,
  x,
  y: 0,
  width: 160,
  height: 80,
});

/** A board whose constants a and b feed `sum` (an instruction) and a, `double` (a script). */
async function computerKb(): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-run-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "field.define", input: { name: "input", id: "f.input" } });
  await invoke(ctx, { id: "field.define", input: { name: "output", id: "f.output" } });
  await invoke(ctx, {
    id: "node.add",
    input: {
      id: "s.double",
      text: "Double",
      tags: ["script"],
      props: [
        { field: CODE_IDS.codeField, value: { t: "str", v: DOUBLE } },
        { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(GRANT) } },
      ],
    },
  });
  const digest = await Effect.runPromise(codeDigest(DOUBLE, GRANT));
  await invoke(ctx, { id: "sandbox.trust", input: { digest }, actor: "human" });
  await invoke(ctx, {
    id: "node.add",
    input: { text: "Computer", id: "n.board", tags: ["canvas"] },
  });
  for (const [id, text] of [
    ["a", "21"],
    ["b", "4"],
    ["sum", "Add the numbers you are given"],
  ]) {
    await invoke(ctx, { id: "node.add", input: { id: `n.${id ?? ""}`, text: text ?? "" } });
  }
  await invoke(ctx, {
    id: "node.add",
    input: {
      id: "n.double",
      text: "Double each",
      props: [{ field: CODE_IDS.scriptsField, value: { t: "ref", v: "s.double" } }],
    },
  });
  const applied = await invoke(ctx, {
    id: "ext.canvas.tx.apply",
    input: {
      canvasId: "n.board",
      doc: {
        nodes: [card("sum", 400), card("a", 0), card("b", 200), card("double", 600)],
        edges: [
          { id: "a-sum", fromNode: "a", toNode: "sum" },
          { id: "b-sum", fromNode: "b", toNode: "sum" },
          { id: "a-double", fromNode: "a", toNode: "double" },
        ],
      },
    },
  });
  expect(applied.status).toBe("succeeded");
  return ctx;
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

const outputOf = (ctx: Kb, id: string) =>
  present(
    ctx.nodes.find((n) => n.id === id),
    id,
  ).props["f.output"];

describe("ext.canvas.run", () => {
  test("constants say their words, a script runs on its inputs, and an instruction without a model fails by name", async () => {
    const ctx = await computerKb();
    const out = output(await invoke(ctx, { id: "ext.canvas.run", input: { canvasId: "n.board" } }));
    expect(out).toMatchObject({
      order: ["a", "b", "sum", "double"],
      rounds: 1,
      steps: 4,
      outputField: "f.output",
    });
    const outcomes = out.outcomes as Record<string, unknown>[];
    expect(outcomes.filter((o) => o.status === "done")).toEqual([
      { item: "a", nodeId: "n.a", status: "done", output: "21", by: "constant" },
      { item: "b", nodeId: "n.b", status: "done", output: "4", by: "constant" },
      { item: "double", nodeId: "n.double", status: "done", output: "42", by: "script" },
    ]);
    expect(outcomes.find((o) => o.item === "sum")).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/no model performed it: .*ext\.agent\.complete/),
    });
    expect(outputOf(ctx, "n.a")).toEqual([{ t: "str", v: "21" }]);
    expect(outputOf(ctx, "n.double")).toEqual([{ t: "str", v: "42" }]);
    expect(outputOf(ctx, "n.sum")).toBeUndefined();
    // The script read its inputs from its node, where the run wrote them.
    expect(
      present(
        ctx.nodes.find((n) => n.id === "n.double"),
        "double",
      ).props["f.input"],
    ).toEqual([{ t: "str", v: "21" }]);
  });

  test("from runs one component and what it reaches; a canvas with no flow is refused", async () => {
    const ctx = await computerKb();
    const out = output(
      await invoke(ctx, { id: "ext.canvas.run", input: { canvasId: "n.board", from: "b" } }),
    );
    expect(out.order).toEqual(["b", "sum"]);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Empty", id: "n.empty", tags: ["canvas"] },
    });
    const empty = await invoke(ctx, { id: "ext.canvas.run", input: { canvasId: "n.empty" } });
    expect(empty.status === "failed" ? empty.message : "").toMatch(/has no flow/);
  });
});
