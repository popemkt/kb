import { KB_SOURCE_BIN } from "@kb/test-kit";
/**
 * `ext.canvas.run` through the invoke core: a canvas as a computer. Cards
 * standing for nodes are its components and its edges carry outputs;
 * constants say their words, a component whose node names a script runs
 * it on its inputs, and an instruction asks the agent family's model,
 * which no host here serves, so it fails by name and what follows it is
 * skipped. Every output is its node's `output` field. The engine's own
 * cases, with a stub model, are `@kb/canvas`'s `flow.test.ts`; an
 * instruction a scripted provider performs, over `kb ui`, is
 * `canvas-run-model.test.ts` (`@kb/cli`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CANVAS_RUN_FIELDS } from "@kb/canvas";
import { createStore, STORE_BACKENDS, type StoreBackend } from "../src/store-selection.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { CODE_IDS } from "@kb/code";
import type { ActionReceipt } from "@kb/contracts";
import { canonicalJson, present, SYSTEM_IDS } from "@kb/model";
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
const chosenPorts = [
  { field: CANVAS_RUN_FIELDS.input.field, value: { t: "ref" as const, v: "f.input" } },
  { field: CANVAS_RUN_FIELDS.output.field, value: { t: "ref" as const, v: "f.output" } },
];
async function computerKb(backend: StoreBackend = "jsonl", ports = chosenPorts): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-run-"));
  roots.push(root);
  await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
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
    input: { text: "Computer", id: "n.board", tags: ["canvas"], props: ports },
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
    const before = canonicalJson(ctx.nodes);
    expect(
      await invoke(ctx, { id: "ext.canvas.run", actor: "agent", input: { canvasId: "n.board" } }),
    ).toMatchObject({ status: "failed", code: "approval_required" });
    expect(canonicalJson(ctx.nodes)).toBe(before);
    const out = output(
      await invoke(ctx, {
        id: "ext.canvas.run",
        actor: "agent",
        approved: true,
        input: { canvasId: "n.board" },
      }),
    );
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
      await invoke(ctx, {
        id: "ext.canvas.run",
        actor: "agent",
        approved: true,
        input: { canvasId: "n.board", from: "b" },
      }),
    );
    expect(out.order).toEqual(["b", "sum"]);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Empty", id: "n.empty", tags: ["canvas"] },
    });
    const empty = await invoke(ctx, {
      id: "ext.canvas.run",
      actor: "agent",
      approved: true,
      input: { canvasId: "n.empty" },
    });
    expect(empty.status === "failed" ? empty.message : "").toMatch(/has no flow/);
  });
});

test("a terminal-approved non-human canvas run performs its script components", async () => {
  const ctx = await computerKb();
  let transcript = "";
  let answered = false;
  const child = Bun.spawn(
    [
      KB_SOURCE_BIN,
      "--root",
      ctx.root,
      "--json",
      "action-invoke",
      JSON.stringify({ id: "ext.canvas.run", input: { canvasId: "n.board" } }),
    ],
    {
      env: process.env,
      terminal: {
        data(terminal, bytes) {
          transcript += new TextDecoder().decode(bytes);
          if (!answered && transcript.includes("[y/N]")) {
            answered = true;
            terminal.write("yes\n");
          }
        },
      },
    },
  );
  try {
    expect(await child.exited).toBe(0);
    expect(answered).toBe(true);
    expect(transcript).toContain('"output": "42"');
  } finally {
    child.kill();
    child.terminal?.close();
  }
});

/** Historical stores had unique protocol labels and no persisted port choices. */
async function legacyKb(backend: StoreBackend): Promise<Kb> {
  const ctx = await computerKb(backend, []);
  for (const field of ctx.nodes.filter(
    (node) => ["input", "output"].includes(node.text) && !["f.input", "f.output"].includes(node.id),
  )) {
    await invoke(ctx, {
      id: "node.update",
      input: { id: field.id, text: `Unrelated ${field.id}` },
    });
  }
  return ctx;
}

const run = (ctx: Kb) =>
  invoke(ctx, { id: "ext.canvas.run", actor: "human", input: { canvasId: "n.board" } });

for (const backend of STORE_BACKENDS) {
  describe(`${backend}: canvas run field bindings`, () => {
    test("adopts custom field IDs once and keeps the script contract after labels change", async () => {
      const ctx = await legacyKb(backend);
      expect((await run(ctx)).status).toBe("succeeded");
      const bindings = () => present(ctx.index.getNode("n.board"), "board").props;
      expect(bindings()[CANVAS_RUN_FIELDS.input.field]).toEqual([{ t: "ref", v: "f.input" }]);
      expect(bindings()[CANVAS_RUN_FIELDS.output.field]).toEqual([{ t: "ref", v: "f.output" }]);
      for (const id of ["f.input", "f.output"])
        expect(
          (await invoke(ctx, { id: "node.update", input: { id, text: `Renamed ${id}` } })).status,
        ).toBe("succeeded");
      await invoke(ctx, { id: "field.define", input: { name: "input", id: "other.input" } });
      await invoke(ctx, { id: "field.define", input: { name: "output", id: "other.output" } });
      expect(
        (
          await invoke(ctx, {
            id: "node.update",
            input: {
              id: "other.input",
              setProps: [
                {
                  field: SYSTEM_IDS.cardinalityField,
                  value: { t: "ref", v: SYSTEM_IDS.cardinalityOne },
                },
              ],
            },
          })
        ).status,
      ).toBe("succeeded");
      await invoke(ctx, { id: "node.update", input: { id: "n.a", text: "11" } });
      expect((await run(ctx)).status).toBe("succeeded");
      expect(outputOf(ctx, "n.double")).toEqual([{ t: "str", v: "22" }]);
      expect(present(ctx.index.getNode("n.double"), "double").props["other.input"]).toBeUndefined();
      expect(bindings()[CANVAS_RUN_FIELDS.input.field]).toEqual([{ t: "ref", v: "f.input" }]);
    });
    test("ambiguous second binding refuses before any graph write or component execution", async () => {
      let ctx = await legacyKb(backend);
      await invoke(ctx, { id: "field.define", input: { name: "output", id: "duplicate.output" } });
      await Effect.runPromise(
        ctx.store.commitEffect(
          { upserts: [], deletes: ["f.input"] },
          { at: "2026-11-12T00:00:00.000Z" },
        ),
      );
      ctx = await openKb(ctx.root);
      const before = canonicalJson(ctx.nodes);
      const receipt = await run(ctx);
      expect(receipt.status).toBe("failed");
      expect(receipt.status === "failed" ? receipt.message : "").toContain(
        "choose sys.f.canvas.run.outputField",
      );
      expect(canonicalJson(ctx.nodes)).toBe(before);
      expect(outputOf(ctx, "n.a")).toBeUndefined();
    });
    test("simultaneous first runs adopt the same definitions and references", async () => {
      const ctx = await legacyKb(backend);
      const other = await openKb(ctx.root);
      const receipts = await Promise.all([run(ctx), run(other)]);
      expect(receipts.map(({ status }) => status)).toEqual(["succeeded", "succeeded"]);
      const reopened = await openKb(ctx.root);
      expect(
        present(reopened.index.getNode("n.board"), "board").props[CANVAS_RUN_FIELDS.input.field],
      ).toEqual([{ t: "ref", v: "f.input" }]);
      expect(reopened.nodes.filter(({ text }) => text === "input")).toHaveLength(1);
      expect(reopened.nodes.filter(({ text }) => text === "output")).toHaveLength(1);
    });
  });
}

for (const backend of STORE_BACKENDS) {
  describe(`${backend}: canvas run refusal and contention`, () => {
    test("present invalid second bindings never fall back or partially execute", async () => {
      for (const value of [
        { t: "ref" as const, v: "missing.field" },
        { t: "ref" as const, v: CANVAS_RUN_FIELDS.output.field },
        { t: "str" as const, v: "f.output" },
        { t: "ref" as const, v: "f.input" },
      ]) {
        const ctx = await legacyKb(backend);
        const canvas = present(ctx.index.getNode("n.board"), "board");
        // Imports can contain invalid bindings; runtime must refuse those as well.
        await Effect.runPromise(
          ctx.store.commitEffect(
            {
              upserts: [
                {
                  ...canvas,
                  props: {
                    ...canvas.props,
                    [CANVAS_RUN_FIELDS.input.field]: [{ t: "ref", v: "f.input" }],
                    [CANVAS_RUN_FIELDS.output.field]: [value],
                  },
                },
              ],
              deletes: [],
            },
            { at: "2026-11-12T00:00:00.000Z" },
          ),
        );
        const reopened = await openKb(ctx.root);
        const before = canonicalJson(reopened.nodes);
        const receipt = await invoke(reopened, {
          id: "ext.canvas.run",
          actor: "human",
          input: { canvasId: "n.board" },
        });
        expect(receipt.status).toBe("failed");
        expect(canonicalJson(reopened.nodes)).toBe(before);
        expect(outputOf(reopened, "n.a")).toBeUndefined();
      }
    });
    test("ordinary edits validate the chosen fields on every commit", async () => {
      const ctx = await legacyKb(backend);
      const bound = await invoke(ctx, {
        id: "node.update",
        input: {
          id: "n.board",
          setProps: [
            { field: CANVAS_RUN_FIELDS.input.field, value: { t: "ref", v: "f.input" } },
            { field: CANVAS_RUN_FIELDS.output.field, value: { t: "ref", v: "f.output" } },
          ],
        },
      });
      expect(bound.status).toBe("succeeded");
      const before = canonicalJson(ctx.nodes);
      const invalid = await invoke(ctx, {
        id: "node.update",
        input: {
          id: "f.input",
          setProps: [
            {
              field: SYSTEM_IDS.cardinalityField,
              value: { t: "ref", v: SYSTEM_IDS.cardinalityOne },
            },
          ],
        },
      });
      expect(invalid.status).toBe("failed");
      expect(canonicalJson(ctx.nodes)).toBe(before);
    });
    test("concurrent adoption creates missing definitions only once", async () => {
      const ctx = await legacyKb(backend);
      await Effect.runPromise(
        ctx.store.commitEffect(
          { upserts: [], deletes: ["f.input", "f.output"] },
          { at: "2026-11-12T00:00:00.000Z" },
        ),
      );
      const first = await openKb(ctx.root);
      const second = await openKb(ctx.root);
      const receipts = await Promise.all(
        [first, second].map((session) =>
          invoke(session, { id: "ext.canvas.run", actor: "human", input: { canvasId: "n.board" } }),
        ),
      );
      expect(receipts.map(({ status }) => status)).toEqual(["succeeded", "succeeded"]);
      const reopened = await openKb(ctx.root);
      for (const role of ["input", "output"] as const) {
        const definitions = reopened.nodes.filter(({ text }) => text === role);
        expect(definitions).toHaveLength(1);
        expect(
          present(reopened.index.getNode("n.board"), "board").props[CANVAS_RUN_FIELDS[role].field],
        ).toEqual([{ t: "ref", v: present(definitions[0], "one definition").id }]);
      }
    });
    test("a person's intervening binding choice survives adoption retry", async () => {
      const ctx = await legacyKb(backend);
      for (const role of ["input", "output"])
        await invoke(ctx, {
          id: "field.define",
          input: { name: `Alternate ${role}`, id: `alternate.${role}` },
        });
      const original = ctx.store.commitEffect.bind(ctx.store);
      let intervened = false;
      const commit: typeof ctx.store.commitEffect = Effect.fn("test.canvas.adoptionRace")(
        function* (...args: Parameters<typeof original>) {
          const [tx] = args;
          if (
            !intervened &&
            tx.upserts.some(
              (node) =>
                node.id === "n.board" && node.props[CANVAS_RUN_FIELDS.input.field] !== undefined,
            )
          ) {
            intervened = true;
            const board = present(ctx.index.getNode("n.board"), "board");
            yield* original(
              {
                upserts: [
                  {
                    ...board,
                    props: {
                      ...board.props,
                      [CANVAS_RUN_FIELDS.input.field]: [{ t: "ref", v: "alternate.input" }],
                      [CANVAS_RUN_FIELDS.output.field]: [{ t: "ref", v: "alternate.output" }],
                    },
                  },
                ],
                deletes: [],
              },
              { at: "2026-11-12T00:00:00.000Z" },
            );
          }
          return yield* original(...args);
        },
      );
      Object.defineProperty(ctx.store, "commitEffect", { value: commit, configurable: true });
      expect(
        (
          await invoke(ctx, {
            id: "ext.canvas.run",
            actor: "human",
            input: { canvasId: "n.board" },
          })
        ).status,
      ).toBe("succeeded");
      expect(intervened).toBe(true);
      const reopened = await openKb(ctx.root);
      expect(
        present(reopened.index.getNode("n.board"), "board").props[CANVAS_RUN_FIELDS.input.field],
      ).toEqual([{ t: "ref", v: "alternate.input" }]);
      expect(
        present(reopened.index.getNode("n.board"), "board").props[CANVAS_RUN_FIELDS.output.field],
      ).toEqual([{ t: "ref", v: "alternate.output" }]);
    });
  });
}
