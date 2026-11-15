/**
 * The procedure contract (DESIGN.md → Action registry → Procedures), through
 * the invoke core as every surface walks one, over a procedure a hosted
 * plugin contributes: three steps, the middle one's action needing approval.
 *
 * - status reads every step's check now, and names the first not done;
 * - only the next step runs, and nothing is written for one out of order;
 * - a step's action is decided as on its own: one that needs approval needs
 *   it on the call that walks it;
 * - a later step done puts every step before it behind the procedure, so a
 *   procedure resumes where its store says it is;
 * - a step that offers more than one action is a decision: the call names
 *   which, and none is taken for it;
 * - a check may recommend one of its step's actions and give notes to show
 *   beside it; a recommendation naming no action of the step is dropped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import {
  ActionPoint,
  KbCtx,
  KbStore,
  ProcedurePoint,
  StepCheckSchema,
  onWire,
  type ActionInvocation,
  type HostedFamilies,
  type KbContext,
  type ProcedureStatus,
} from "@kb/contracts";
import type { KbNode } from "@kb/model";
import { persistEffect } from "@kb/operations";
import { definePlugin, makeKernel } from "@kb/plugin";
import { CONTRACT_AT } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKbEffect } from "../src/open.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { IN_PROCESS_WIRE } from "../src/invoke.ts";
import { invokeReceiptEffect } from "../src/registry.ts";
import { createStore } from "../src/store-selection.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const note = (id: string): KbNode => ({
  id,
  text: id,
  props: {},
  children: [],
  createdAt: CONTRACT_AT,
  updatedAt: CONTRACT_AT,
});

const Marked = z.object({ id: z.string() });
const Advice = z.object({ recommended: z.string() });

/** A call of `action` about the node `n.<id>`. */
const call = (action: string, id: string) => ({ action, input: { id: `n.${id}` } });

/** A step `id` that runs `action` once, done when its node is there. */
const step = (id: string, action: string) => ({
  id,
  title: id,
  actions: [{ id: "do", title: id, call: call(action, id) }] as const,
  check: call("t.marked", id),
});

/** `t.mark` writes a node, `t.ask` too with a person's approval, `t.marked` reads whether it is there. */
const stepsPlugin = definePlugin({
  name: "t",
  namespace: "t",
  apply: (ctx) =>
    Effect.gen(function* () {
      const mark = (input: never) =>
        Effect.gen(function* () {
          const { id } = Marked.parse(input);
          yield* persistEffect(yield* KbCtx, { upserts: [note(id)], deletes: [] });
          return { id };
        });
      const write = { inputSchema: Marked, outputSchema: Marked, effect: mark };
      yield* ctx.contribute(ActionPoint, {
        id: "mark",
        value: { title: "mark", description: "mark", mode: { kind: "write" }, ...write },
      });
      yield* ctx.contribute(ActionPoint, {
        id: "ask",
        value: {
          title: "ask",
          description: "mark, asking first",
          mode: { kind: "write", approval: "required" },
          ...write,
        },
      });
      yield* ctx.contribute(ActionPoint, {
        id: "marked",
        value: {
          title: "marked",
          description: "whether the node is there",
          mode: { kind: "read" },
          inputSchema: Marked,
          outputSchema: z.object({ done: z.boolean() }),
          effect: (input: never) =>
            Effect.gen(function* () {
              const { id } = Marked.parse(input);
              return { done: (yield* KbCtx).nodes.some((node) => node.id === id) };
            }),
        },
      });
      yield* ctx.contribute(ActionPoint, {
        id: "advise",
        value: {
          title: "advise",
          description: "not done, recommending what its input names",
          mode: { kind: "read" },
          inputSchema: Advice,
          outputSchema: StepCheckSchema,
          effect: (input: never) =>
            Effect.sync(() => {
              const { recommended } = Advice.parse(input);
              return { done: false, recommended, notes: [`why ${recommended}`] };
            }),
        },
      });
      for (const recommended of ["drop", "maybe"])
        yield* ctx.contribute(ProcedurePoint, {
          id: `advised.${recommended}`,
          value: {
            title: "an advised decision",
            steps: [
              {
                id: "decide",
                title: "keep or drop",
                actions: [
                  { id: "keep", title: "Keep", call: call("t.mark", "keep") },
                  { id: "drop", title: "Drop", call: call("t.mark", "drop") },
                ],
                check: { action: "t.advise", input: { recommended } },
              },
            ],
          },
        });
      yield* ctx.contribute(ProcedurePoint, {
        id: "proc",
        value: {
          title: "a procedure",
          steps: [
            step("one", "t.mark"),
            step("two", "t.ask"),
            step("three", "t.mark"),
            {
              id: "four",
              title: "keep or drop",
              actions: [
                { id: "keep", title: "Keep", call: call("t.mark", "four") },
                { id: "drop", title: "Drop", call: call("t.ask", "four") },
              ],
              check: call("t.marked", "four"),
            },
          ],
        },
      });
    }),
});

describe("procedure contract", () => {
  let scratch = "";
  let session: KbContext | null = null;
  let hosted: HostedFamilies | null = null;

  const ctx = (): KbContext => {
    if (session === null) throw new Error("no session: beforeEach did not run");
    return session;
  };

  const invoke = (
    id: string,
    input: unknown,
    claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
  ) =>
    invokeReceiptEffect(ctx(), onWire(IN_PROCESS_WIRE, { id, input, ...claims })).pipe(
      Effect.provide(kbRuntimeLayer(ctx(), undefined, hosted ?? undefined)),
    );

  const status = () =>
    invoke("procedure.status", { procedure: "t.proc" }).pipe(
      Effect.map((receipt) => {
        if (receipt.status !== "succeeded")
          throw new Error(`procedure.status failed: ${receipt.code} ${receipt.message}`);
        return receipt.output as ProcedureStatus;
      }),
    );

  const ids = () => ctx().nodes.map((node) => node.id);

  beforeEach(() =>
    run(
      Effect.gen(function* () {
        scratch = yield* Effect.promise(async () =>
          realpath(await mkdtemp(join(tmpdir(), "kb-procedure-contract-"))),
        );
        yield* createStore(scratch, "jsonl").pipe(Effect.provide(bunFileSystemLayer));
        session = yield* openKbEffect(scratch).pipe(Effect.provide(bunFileSystemLayer));
        const kernel = makeKernel({ host: "server" });
        yield* kernel.load(stepsPlugin);
        hosted = { rows: Effect.succeed([]), kernel };
      }),
    ),
  );

  afterEach(() => {
    session = null;
    hosted = null;
    return rm(scratch, { recursive: true, force: true });
  });

  test("status reads every step's check and names the first not done", () =>
    run(
      Effect.gen(function* () {
        const at = yield* status();
        expect(at.current).toBe("one");
        expect(at.steps.map((s) => [s.id, s.check.status, s.done])).toEqual([
          ["one", "not-done", false],
          ["two", "not-done", false],
          ["three", "not-done", false],
          ["four", "not-done", false],
        ]);
        expect(at.steps.map((s) => s.decision)).toEqual([false, false, false, true]);
        const listed = yield* invoke("procedure.list", {});
        expect(listed.status === "succeeded" && listed.output).toEqual({
          procedures: [
            { id: "t.advised.drop", title: "an advised decision", current: "decide" },
            { id: "t.advised.maybe", title: "an advised decision", current: "decide" },
            { id: "t.proc", title: "a procedure", current: "one" },
          ],
        });
      }),
    ));

  test("only the next step runs; one out of order writes nothing", () =>
    run(
      Effect.gen(function* () {
        const skipped = yield* invoke("procedure.step", { procedure: "t.proc", step: "three" });
        expect(skipped.status === "failed" && skipped.code).toBe("conflict");
        expect(ids()).not.toContain("n.three");
        const ran = yield* invoke("procedure.step", { procedure: "t.proc", step: "one" });
        expect(ran.status).toBe("succeeded");
        expect(ids()).toContain("n.one");
        expect((yield* status()).current).toBe("two");
        const again = yield* invoke("procedure.step", { procedure: "t.proc", step: "one" });
        expect(again.status === "failed" && again.code).toBe("conflict");
      }),
    ));

  test("a step whose action needs approval needs it on the call that walks it", () =>
    run(
      Effect.gen(function* () {
        yield* invoke("procedure.step", { procedure: "t.proc", step: "one" });
        const refused = yield* invoke("procedure.step", { procedure: "t.proc", step: "two" });
        expect(refused.status === "failed" && refused.code).toBe("approval_required");
        expect(ids()).not.toContain("n.two");
        const approved = yield* invoke(
          "procedure.step",
          { procedure: "t.proc", step: "two" },
          { actor: "human", approved: true },
        );
        expect(approved.status).toBe("succeeded");
        expect(ids()).toContain("n.two");
        expect((yield* status()).current).toBe("three");
      }),
    ));

  test("a later step done puts each before it behind; every step done leaves none next", () =>
    run(
      Effect.gen(function* () {
        yield* persistEffect(ctx(), { upserts: [note("n.two")], deletes: [] }).pipe(
          Effect.provideService(KbStore, ctx().store),
        );
        const at = yield* status();
        expect(at.steps.map((s) => [s.id, s.check.status, s.done])).toEqual([
          ["one", "not-done", true],
          ["two", "done", true],
          ["three", "not-done", false],
          ["four", "not-done", false],
        ]);
        expect(at.current).toBe("three");
        yield* invoke("procedure.step", { procedure: "t.proc", step: "three" });
        yield* invoke("procedure.step", { procedure: "t.proc", step: "four", action: "keep" });
        expect((yield* status()).current).toBeNull();
      }),
    ));

  test("a decision runs only the action the call names, decided as that action is", () =>
    run(
      Effect.gen(function* () {
        yield* persistEffect(ctx(), { upserts: [note("n.three")], deletes: [] }).pipe(
          Effect.provideService(KbStore, ctx().store),
        );
        expect((yield* status()).current).toBe("four");
        const unnamed = yield* invoke("procedure.step", { procedure: "t.proc", step: "four" });
        expect(unnamed.status === "failed" && unnamed.code).toBe("invalid_input");
        const unknown = yield* invoke("procedure.step", {
          procedure: "t.proc",
          step: "four",
          action: "maybe",
        });
        expect(unknown.status === "failed" && unknown.code).toBe("invalid_input");
        const drop = yield* invoke("procedure.step", {
          procedure: "t.proc",
          step: "four",
          action: "drop",
        });
        expect(drop.status === "failed" && drop.code).toBe("approval_required");
        expect(ids()).not.toContain("n.four");
        yield* invoke(
          "procedure.step",
          { procedure: "t.proc", step: "four", action: "drop" },
          { actor: "human", approved: true },
        );
        expect(ids()).toContain("n.four");
        expect((yield* status()).current).toBeNull();
      }),
    ));

  test("a check's recommendation and notes reach the status, a stray one dropped", () =>
    run(
      Effect.gen(function* () {
        const read = (procedure: string) =>
          invoke("procedure.status", { procedure }).pipe(
            Effect.map((receipt) =>
              receipt.status === "succeeded" ? (receipt.output as ProcedureStatus) : null,
            ),
          );
        const advised = yield* read("t.advised.drop");
        expect(advised?.steps[0]).toMatchObject({
          decision: true,
          recommended: "drop",
          notes: ["why drop"],
        });
        const stray = yield* read("t.advised.maybe");
        expect(stray?.steps[0]?.recommended).toBeUndefined();
        expect(stray?.steps[0]?.notes).toEqual(["why maybe"]);
      }),
    ));

  test("a procedure no plugin offers is not found", () =>
    run(
      Effect.gen(function* () {
        const receipt = yield* invoke("procedure.status", { procedure: "t.nope" });
        expect(receipt.status === "failed" && receipt.code).toBe("not_found");
      }),
    ));
});
