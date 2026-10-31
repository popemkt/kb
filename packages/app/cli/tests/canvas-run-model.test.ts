/**
 * `ext.canvas.run`'s instruction components over `kb ui` (DESIGN.md → Canvas
 * documents → Run): where the server hosts the agent, an instruction is one
 * `ext.agent.complete` turn of the selected provider, here a scripted one (no
 * model, no login, no network). The instruction is the system prompt and the
 * upstream outputs, in edge order, the message; the reply is the component's
 * output, written to its node and carried on to what it feeds. A provider
 * that fails fails its component by name and skips what follows. And the run
 * stays a person's or the agent's: no sandboxed code may start one, and a
 * script a run performs cannot ask the model either. With no agent hosted,
 * `canvas-run.test.ts` (`@kb/runtime`) holds that an instruction fails by name.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  DEFAULT_ADAPTER,
  agentExtension,
  agentPlugin,
  scriptedRuntime,
  type ScriptStep,
  type ScriptedRuntime,
} from "@kb/agent";
import { CODE_IDS } from "@kb/code";
import { NO_SECRETS, type ExtensionEntry } from "@kb/contracts";
import { canonicalJson } from "@kb/model";
import { bunFileSystemLayer } from "@kb/runtime";
import { codeDigest } from "@kb/sandbox";
import { startUi, type UiServerHandle } from "@kb/server";
const RUN = "ext.canvas.run";
const ADD = "Add the numbers you are given";
const SHOUT = "Say it loudly";
const BREAK = "Break";
/** What the scripted provider makes of a turn: it reads the instruction in the system prompt. */
function script(system: string, message: string): readonly ScriptStep[] {
  if (system.endsWith(`Instruction: ${ADD}`)) return [{ say: "2" }, { say: "5" }];
  if (system.endsWith(`Instruction: ${SHOUT}`)) return [{ say: `${message}!` }];
  if (system.endsWith(`Instruction: ${BREAK}`)) return [{ fail: "the model is down" }];
  return [{ say: "unexpected" }];
}
/** Every runtime the scripted adapter built, in order: one per instruction performed. */
const built: ScriptedRuntime[] = [];
const AGENT: ExtensionEntry = {
  declaration: agentExtension,
  entry: agentPlugin({
    adapters: [
      {
        id: DEFAULT_ADAPTER,
        login: () => [],
        runtime: () => {
          const runtime = scriptedRuntime((turn) => script(turn.system, turn.message.text));
          built.push(runtime);
          return runtime;
        },
      },
    ],
    secrets: NO_SECRETS,
  }),
};
/** Asks the model from inside the sandbox, and leaves what came of it as its node's `output`. */
const ASK = `let said;
try {
  await kb.invoke("ext.agent.complete", { message: "hi" });
  said = "the model answered";
} catch (error) {
  said = "refused: " + error.code;
}
await kb.invoke("node.update", {
  id: kb.subject,
  unsetProps: [{ field: "f.output" }],
  setProps: [{ field: "f.output", value: { t: "str", v: said } }],
});`;
/** A grant that names the completion, which no grant can make callable. */
const ASK_GRANT = { reads: "subject" as const, actions: ["ext.agent.complete", "node.update"] };
let root = "";
let handle: UiServerHandle;
/** A call from the page, over HTTP as the page makes it, with `envelope` beside it: its receipt. */
async function call(
  id: string,
  input: unknown,
  envelope: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const origin = new URL(handle.url).origin;
  const response = await fetch(`${origin}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ id, input, ...envelope }),
  });
  return (await response.json()) as Record<string, unknown>;
}
/** `call`, which must succeed: its output. */
async function done(id: string, input: unknown): Promise<Record<string, unknown>> {
  const receipt = await call(id, input);
  expect(receipt).toMatchObject({ status: "succeeded" });
  return receipt.output as Record<string, unknown>;
}
const card = (id: string, x: number) => ({
  id,
  type: "kb-node",
  nodeId: `n.${id}`,
  x,
  y: 0,
  width: 160,
  height: 80,
});
const wire = (from: string, to: string) => ({ id: `${from}-${to}`, fromNode: from, toNode: to });
/** A canvas `id` of these cards and wires. */
async function board(id: string, cards: readonly string[], wires: readonly [string, string][]) {
  await done("node.add", { id, text: id, tags: ["canvas"] });
  await done("ext.canvas.tx.apply", {
    canvasId: id,
    doc: {
      nodes: cards.map((c, i) => card(c, i * 200)),
      edges: wires.map(([from, to]) => wire(from, to)),
    },
  });
}
/** A node's stored output. */
async function outputOf(id: string): Promise<unknown> {
  const got = await done("node.get", { id });
  return (got.node as { props: Record<string, unknown> }).props["f.output"];
}
type Outcome = Record<string, unknown>;
const outcomesOf = (out: Record<string, unknown>) => out.outcomes as Outcome[];
const outcome = (out: Record<string, unknown>, item: string) =>
  outcomesOf(out).find((o) => o.item === item);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-canvas-run-model-"));
  handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions: [AGENT] }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
  await done("field.define", { name: "input", id: "f.input" });
  await done("field.define", { name: "output", id: "f.output" });
  for (const [id, text] of [
    ["a", "21"],
    ["b", "4"],
    ["sum", ADD],
    ["shout", SHOUT],
    ["broken", BREAK],
    ["after", SHOUT],
  ] as const) {
    await done("node.add", { id: `n.${id}`, text });
  }
  await done("node.add", {
    id: "s.ask",
    text: "Ask the model",
    tags: ["script"],
    props: [
      { field: CODE_IDS.codeField, value: { t: "str", v: ASK } },
      { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(ASK_GRANT) } },
    ],
  });
  // Trusted, so it runs in a Worker as a person's script does: trust widens its engine, never its grant.
  await done("sandbox.trust", { digest: await Effect.runPromise(codeDigest(ASK, ASK_GRANT)) });
  await done("node.add", {
    id: "n.asker",
    text: "Asks the model",
    props: [{ field: CODE_IDS.scriptsField, value: { t: "ref", v: "s.ask" } }],
  });
  // a and b feed sum, which feeds shout: two instructions in a row.
  await board(
    "n.computer",
    ["a", "b", "sum", "shout"],
    [
      ["a", "sum"],
      ["b", "sum"],
      ["sum", "shout"],
    ],
  );
  await board(
    "n.broken-board",
    ["a", "broken", "after"],
    [
      ["a", "broken"],
      ["broken", "after"],
    ],
  );
  await board("n.coded", ["a", "asker"], [["a", "asker"]]);
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});
describe("ext.canvas.run with the agent's model", () => {
  test("an instruction is one completion: its words the system prompt, its inputs the message", async () => {
    const from = built.length;
    const out = await done(RUN, { canvasId: "n.computer" });
    expect(out.order).toEqual(["a", "b", "sum", "shout"]);
    expect(outcome(out, "sum")).toEqual({
      item: "sum",
      nodeId: "n.sum",
      status: "done",
      output: "25",
      by: "model",
    });
    // What sum made is what shout was given.
    expect(outcome(out, "shout")).toMatchObject({ status: "done", output: "25!", by: "model" });
    // One runtime per instruction, one tool-less turn each.
    expect(built).toHaveLength(from + 2);
    const [sum, shout] = built.slice(from).map((runtime) => runtime.turns);
    expect(sum).toHaveLength(1);
    expect(sum?.[0]?.system).toMatch(/^You are one component of a canvas/);
    expect(sum?.[0]?.system.endsWith(`\n\nInstruction: ${ADD}`)).toBe(true);
    // The inputs in edge order, set apart by a line of dashes.
    expect(sum?.[0]?.message).toEqual({ text: "21\n\n---\n\n4", screen: null, images: [] });
    expect(sum?.[0]?.tools).toEqual([]);
    expect(shout?.[0]?.message.text).toBe("25");
    // Outputs land on their nodes as they did before a model performed them.
    expect(await outputOf("n.sum")).toEqual([{ t: "str", v: "25" }]);
    expect(await outputOf("n.shout")).toEqual([{ t: "str", v: "25!" }]);
  });
  test("a provider that fails fails its component by name, and what follows is skipped", async () => {
    const out = await done(RUN, { canvasId: "n.broken-board" });
    expect(outcome(out, "broken")).toMatchObject({
      status: "failed",
      message: "no model performed it: the model is down",
    });
    expect(outcome(out, "after")).toMatchObject({ status: "skipped", after: ["broken"] });
    expect(await outputOf("n.broken")).toBeUndefined();
  });
  test("no sandboxed code may start a run, so none reaches the model through one", async () => {
    const from = built.length;
    const receipt = await call(
      RUN,
      { canvasId: "n.computer" },
      { script: { subject: "n.computer", grant: { reads: "graph", actions: [RUN] } } },
    );
    expect(receipt).toMatchObject({ status: "failed", code: "forbidden" });
    expect(built).toHaveLength(from);
  });
  test("a script a run performs cannot ask the model, whatever its grant names", async () => {
    const from = built.length;
    const out = await done(RUN, { canvasId: "n.coded" });
    expect(outcome(out, "asker")).toMatchObject({
      status: "done",
      by: "script",
      output: "refused: forbidden",
    });
    expect(built).toHaveLength(from);
  });
});
