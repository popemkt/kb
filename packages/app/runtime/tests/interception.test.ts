/**
 * The invoke core's interception points (`@kb/operations` → interception.ts,
 * DESIGN.md → Action registry → Interception), held to their properties over
 * a real session: guards decide and cannot change a call, interceptors
 * transform and cannot refuse it, a failing guard denies and a failing
 * interceptor aborts in the plugin's name, order is the kernel's
 * (dependencies first, then load order), every listener gets the call's
 * abort signal and a budget, a guard the deployment requires that is not
 * there denies every call, and calls nested in calls are guarded again,
 * to a depth limit.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Tracer } from "effect";
import { z } from "zod";
import {
  CurrentCall,
  CurrentInterception,
  guardAction,
  onAction,
  type ActionGuard,
  type ActionInterceptor,
  type ActionInvocation,
  type ActionReceipt,
  type GuardVerdict,
  type Interception,
  type KbContext,
  type Listener,
} from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import {
  MAX_CALL_DEPTH,
  coreActions,
  interceptionFrom,
  interceptionOf,
  invokeReceiptWith,
  type RegisteredAction,
} from "@kb/operations";
import { Service, definePlugin, makeKernel } from "@kb/plugin";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";

let root = "";
let ctx: KbContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-interception-"));
  ctx = await openKb(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** How many times each test action's handler ran. */
let ran = 0;

const NumberIo = z.object({ n: z.number() });

/** `test.echo` answers with its input; `test.recurse` calls itself, one deeper each time. */
const ACTIONS: ReadonlyMap<string, RegisteredAction> = new Map([
  [
    "test.echo",
    {
      def: {
        id: "test.echo",
        title: "Echo",
        description: "answers with its input",
        mode: { kind: "read" },
        inputSchema: NumberIo,
        outputSchema: NumberIo,
      },
      effect: (input: never) =>
        Effect.sync(() => {
          ran += 1;
          return input;
        }),
      source: "core",
      aliases: [],
    },
  ],
  [
    "test.recurse",
    {
      def: {
        id: "test.recurse",
        title: "Recurse",
        description: "calls itself",
        mode: { kind: "read" },
        inputSchema: z.object({}),
        outputSchema: z.unknown(),
      },
      effect: () =>
        Effect.gen(function* () {
          ran += 1;
          const outer = yield* CurrentCall;
          return yield* invokeReceiptWith(ACTIONS, ctx, {
            id: "test.recurse",
            input: {},
            actor: outer?.invocation.actor ?? "cli",
          });
        }),
      source: "core",
      aliases: [],
    },
  ],
]);

function call(interception: Interception, invocation: ActionInvocation): Promise<ActionReceipt> {
  return Effect.runPromise(
    invokeReceiptWith(ACTIONS, ctx, invocation).pipe(
      Effect.provideService(CurrentInterception, interception),
      Effect.provide(kbRuntimeLayer(ctx)),
    ),
  );
}

const echo = (n = 1): ActionInvocation => ({ id: "test.echo", input: { n }, actor: "agent" });

function guard(
  owner: string,
  value: Omit<ActionGuard, "match">,
  match = "*",
): Listener<ActionGuard> {
  return { owner, id: `${owner}.guard`, value: { match, ...value } };
}

function interceptor(
  owner: string,
  value: Omit<ActionInterceptor, "match">,
  match = "*",
): Listener<ActionInterceptor> {
  return { owner, id: `${owner}.interceptor`, value: { match, ...value } };
}

const allow: GuardVerdict = { decision: "allow" };

describe("the two kinds", () => {
  test("a guard cannot change the call it is asked about: trying denies", async () => {
    ran = 0;
    const meddler = guard("meddler", {
      before: (asked) =>
        Effect.sync(() => {
          (asked.invocation as { input: unknown }).input = { n: 99 };
          return allow;
        }),
    });
    const receipt = await call(interceptionOf({ guards: [meddler] }), echo());
    expect(receipt).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { decidedBy: { plugin: "meddler", rule: "guard-failed" } },
    });
    expect(ran).toBe(0);
  });

  test("nor anything inside it: the input it is asked about is its own sealed copy", async () => {
    ran = 0;
    const seen: unknown[] = [];
    const meddler = guard("meddler", {
      before: (asked) =>
        Effect.sync(() => {
          (asked.invocation.input as { n: number }).n = 99;
          return allow;
        }),
    });
    const after = guard("after", {
      before: ({ invocation }) =>
        Effect.sync(() => {
          seen.push(invocation.input);
          return allow;
        }),
    });
    expect(await call(interceptionOf({ guards: [meddler, after] }), echo())).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "meddler", rule: "guard-failed" } },
    });
    expect(seen).toEqual([]);
    expect(ran).toBe(0);
  });

  test("a commit guard cannot change what the commit writes, or the graph it reads", async () => {
    const core = new Map(coreActions.map((action) => [action.def.id, action]));
    const rewriter = guard("rewriter", {
      commit: ({ writes }) =>
        Effect.sync(() => {
          const write = writes[0];
          if (write?.after !== undefined)
            (write.after as { id: string }).id = "sys.review.protected";
          return allow;
        }),
    });
    const reader = guard("reader", {
      commit: ({ nodeOf }) =>
        Effect.sync(() => {
          const tagNode = nodeOf(SYSTEM_IDS.tag);
          if (tagNode !== undefined) (tagNode as { text: string }).text = "renamed";
          return allow;
        }),
    });
    const add = (guards: Listener<ActionGuard>[]) =>
      Effect.runPromise(
        invokeReceiptWith(core, ctx, {
          id: "node.add",
          input: { text: "Plain", id: "n.plain" },
          actor: "agent",
        }).pipe(
          Effect.provideService(CurrentInterception, interceptionOf({ guards })),
          Effect.provide(kbRuntimeLayer(ctx)),
        ),
      );
    expect(await add([rewriter])).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "rewriter", rule: "guard-failed" } },
    });
    expect(await add([reader])).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "reader", rule: "guard-failed" } },
    });
    expect(ctx.index.getNode("sys.review.protected")).toBeUndefined();
    expect(ctx.index.getNode("n.plain")).toBeUndefined();
    expect(ctx.index.getNode(SYSTEM_IDS.tag)?.text).not.toBe("renamed");
  });

  test("nor the call as it runs, through CurrentCall, nor the action the registry holds", async () => {
    ran = 0;
    const throughCall = guard("through-call", {
      before: () =>
        Effect.gen(function* () {
          const running = yield* CurrentCall;
          if (running !== null) (running.invocation.input as { n: number }).n = 99;
          return allow;
        }),
    });
    const throughAction = guard("through-action", {
      before: ({ action }) =>
        Effect.sync(() => {
          (action.mode as { kind: string }).kind = "write";
          return allow;
        }),
    });
    for (const meddler of [throughCall, throughAction]) {
      expect(await call(interceptionOf({ guards: [meddler] }), echo())).toMatchObject({
        code: "forbidden",
        details: { decidedBy: { plugin: meddler.owner, rule: "guard-failed" } },
      });
    }
    expect(ran).toBe(0);
    expect(ACTIONS.get("test.echo")?.def.mode).toEqual({ kind: "read" });
    // The call is held as data, so what is not data is refused as its input.
    for (const extra of [() => {}, new Uint8Array([1])]) {
      expect(await call(interceptionOf({}), { ...echo(), input: { n: 1, extra } })).toMatchObject({
        status: "failed",
        code: "invalid_input",
      });
    }
  });

  test("a guard that throws as it makes its effect denies, in its plugin's name", async () => {
    const throwing = guard("throwing", {
      before: () => {
        throw new Error("thrown while making the effect");
      },
    });
    expect(await call(interceptionOf({ guards: [throwing] }), echo())).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "throwing", rule: "guard-failed" } },
    });
  });

  test("an interceptor transforms the input and output, and the guards see the input that will run", async () => {
    const seen: unknown[] = [];
    const doubler = interceptor("doubler", {
      input: ({ invocation }) => Effect.succeed({ n: NumberIo.parse(invocation.input).n * 2 }),
      output: (_call, output) => Effect.succeed({ n: NumberIo.parse(output).n + 1 }),
    });
    const watcher = guard("watcher", {
      before: ({ invocation }) =>
        Effect.sync(() => {
          seen.push(invocation.input);
          return allow;
        }),
    });
    const receipt = await call(
      interceptionOf({ guards: [watcher], interceptors: [doubler] }),
      echo(5),
    );
    expect(receipt).toEqual({ status: "succeeded", id: "test.echo", output: { n: 11 } });
    expect(seen).toEqual([{ n: 10 }]);
  });
});

describe("failures are never skipped", () => {
  test("a guard that fails or dies denies, naming the plugin, and the action never runs", async () => {
    ran = 0;
    for (const broken of [
      guard("failing", { before: () => Effect.die(new Error("boom")) }),
      guard("throwing", {
        before: () =>
          Effect.sync(() => {
            throw new Error("thrown");
          }),
      }),
    ]) {
      const receipt = await call(interceptionOf({ guards: [broken] }), echo());
      expect(receipt).toMatchObject({
        status: "failed",
        code: "forbidden",
        details: { decidedBy: { plugin: broken.owner, rule: "guard-failed" } },
      });
    }
    expect(ran).toBe(0);
  });

  test("a guard over its budget denies, and its abort signal fires", async () => {
    let aborted = false;
    const slow = guard("slow", {
      before: ({ signal }) =>
        Effect.sleep("1 second").pipe(
          Effect.ensuring(Effect.sync(() => (aborted = signal.aborted))),
          Effect.as(allow),
        ),
    });
    const receipt = await call(
      interceptionOf({ guards: [slow] }, { budgetMs: { guard: 20, intercept: 20 } }),
      echo(),
    );
    expect(receipt).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "slow", rule: "guard-timeout" } },
    });
    expect(aborted).toBe(true);
  });

  test("an interceptor that fails or overruns aborts the call, naming the plugin", async () => {
    ran = 0;
    const failing = interceptor("failing", { input: () => Effect.die(new Error("boom")) });
    const slow = interceptor("slow", { input: () => Effect.sleep("1 second").pipe(Effect.as({})) });
    const budget = { budgetMs: { guard: 20, intercept: 20 } };
    expect(await call(interceptionOf({ interceptors: [failing] }, budget), echo())).toMatchObject({
      code: "internal",
      details: { decidedBy: { plugin: "failing", rule: "interceptor-failed" } },
    });
    expect(await call(interceptionOf({ interceptors: [slow] }, budget), echo())).toMatchObject({
      code: "internal",
      details: { decidedBy: { plugin: "slow", rule: "interceptor-timeout" } },
    });
    expect(ran).toBe(0);
  });
});

describe("verdicts", () => {
  test("a deny is final, an ask holds unless a person stands behind the call, and the refusal names who decided", async () => {
    const asked: string[] = [];
    const asking = guard("asking", {
      before: () =>
        Effect.sync(() => {
          asked.push("asking");
          return { decision: "ask", rule: "r.ask", message: "ask first" } as const;
        }),
    });
    const denying = guard("denying", {
      before: () =>
        Effect.sync(() => {
          asked.push("denying");
          return { decision: "deny", rule: "r.deny", message: "never" } as const;
        }),
    });
    const after = guard("after", {
      before: () =>
        Effect.sync(() => {
          asked.push("after");
          return allow;
        }),
    });
    const only = interceptionOf({ guards: [asking] });
    expect(await call(only, echo())).toMatchObject({
      code: "approval_required",
      message: "ask first",
      details: { decidedBy: { plugin: "asking", rule: "r.ask" } },
    });
    expect(await call(only, { ...echo(), approved: true })).toMatchObject({ status: "succeeded" });
    asked.length = 0;
    expect(await call(interceptionOf({ guards: [asking, denying, after] }), echo())).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "denying", rule: "r.deny" } },
    });
    expect(asked).toEqual(["asking", "denying"]);
  });

  test("a guard is asked only about the calls its match names: an id, a pattern, a mode word", async () => {
    const asked: string[] = [];
    const listen = (match: string) =>
      guard(
        match,
        {
          before: () =>
            Effect.sync(() => {
              asked.push(match);
              return allow;
            }),
        },
        match,
      );
    const interception = interceptionOf({
      guards: ["test.echo", "test.*", "every read", "every write", "other.*", "*"].map(listen),
    });
    await call(interception, echo());
    expect(asked).toEqual(["test.echo", "test.*", "every read", "*"]);
  });

  test("which guards match is worked out once per action, not by reading every listener per call", async () => {
    let reads = 0;
    const counted: ActionGuard = {
      get match() {
        reads += 1;
        return "other.*";
      },
      before: () => Effect.succeed(allow),
    };
    const interception = interceptionOf({ guards: [{ owner: "o", id: "g", value: counted }] });
    await call(interception, echo());
    const afterFirst = reads;
    for (let i = 0; i < 5; i++) await call(interception, echo());
    expect(afterFirst).toBeGreaterThan(0);
    expect(reads).toBe(afterFirst);
  });

  test("a guard's span is traced, under the plugin that contributed it", async () => {
    const traced: { name: string; plugin: unknown }[] = [];
    const tracing = guard("tracing", {
      before: () =>
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          traced.push({ name: span.name, plugin: span.attributes.get("plugin") });
          return allow;
        }).pipe(Effect.orDie),
    });
    await call(interceptionOf({ guards: [tracing] }), echo());
    expect(traced).toEqual([{ name: "kb.guard", plugin: "tracing" }]);
  });

  test("a guard's span records what it decided and by which rule, a failure's included", async () => {
    const spans: Tracer.NativeSpan[] = [];
    const recording = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const denying = guard("denying", {
      before: () => Effect.succeed({ decision: "deny", rule: "no-echo", message: "no" } as const),
    });
    const failing = guard("failing", { before: () => Effect.die(new Error("boom")) });
    for (const listener of [denying, failing]) {
      await Effect.runPromise(
        invokeReceiptWith(ACTIONS, ctx, echo()).pipe(
          Effect.provideService(CurrentInterception, interceptionOf({ guards: [listener] })),
          Effect.provide(kbRuntimeLayer(ctx)),
          Effect.withTracer(recording),
        ),
      );
    }
    const guardSpans = spans
      .filter(({ name }) => name === "kb.guard")
      .map(({ attributes }) => Object.fromEntries(attributes));
    expect(guardSpans).toEqual([
      { plugin: "denying", guard: "denying.guard", decision: "deny", rule: "no-echo" },
      { plugin: "failing", guard: "failing.guard", decision: "deny", rule: "guard-failed" },
    ]);
  });
});

describe("order and lifecycle", () => {
  const Svc = Service<string>()("test.interception.svc");

  test("listeners run dependencies first, then in load order, as the kernel reports them", async () => {
    const order: string[] = [];
    const recording = (name: string) => ({
      before: () =>
        Effect.sync(() => {
          order.push(name);
          return allow;
        }),
    });
    const kernel = makeKernel();
    // `dependent` loads first but injects what `provider` provides, so it applies after it.
    const dependent = definePlugin({
      name: "dependent",
      inject: [Svc],
      apply: (plugin) => guardAction(plugin, "*", recording("dependent")),
    });
    const provider = definePlugin({
      name: "provider",
      apply: (plugin) =>
        Effect.gen(function* () {
          yield* plugin.provide(Svc, "here");
          yield* guardAction(plugin, "*", recording("provider"));
        }),
    });
    const later = definePlugin({
      name: "later",
      apply: (plugin) =>
        Effect.gen(function* () {
          yield* guardAction(plugin, "*", recording("later"));
          yield* onAction(plugin, "*", {
            input: ({ invocation }) => Effect.succeed(invocation.input),
          });
        }),
    });
    for (const plugin of [dependent, provider, later]) await Effect.runPromise(kernel.load(plugin));
    expect(await call(interceptionFrom(kernel), echo())).toMatchObject({ status: "succeeded" });
    expect(order).toEqual(["provider", "dependent", "later"]);
  });

  test("a plugin on its way out has no guards, even to a reader that indexed them, while its finalizers run", async () => {
    const kernel = makeKernel();
    const interception = interceptionFrom(kernel);
    const duringFinalizer: number[] = [];
    const echoing = { id: "test.echo", mode: { kind: "read" } } as const;
    const leaving = definePlugin({
      name: "leaving",
      apply: (plugin) =>
        Effect.gen(function* () {
          yield* guardAction(plugin, "*", { before: () => Effect.succeed(allow) });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              duringFinalizer.push(interception.guards(echoing).length);
            }),
          );
        }),
    });
    await Effect.runPromise(kernel.load(leaving));
    // Indexed while it was there.
    expect(interception.guards(echoing).length).toBe(1);
    await Effect.runPromise(kernel.unload("leaving"));
    expect(duringFinalizer).toEqual([0]);
    expect(interception.guards(echoing).length).toBe(0);
  });

  test("while a guard the deployment requires is not applied, every call is denied", async () => {
    const kernel = makeKernel();
    const interception = interceptionFrom(kernel, { required: ["governance"] });
    expect(await call(interception, echo())).toMatchObject({
      code: "forbidden",
      details: { decidedBy: { plugin: "governance", rule: "required-guard-missing" } },
    });
    const governance = definePlugin({
      name: "governance",
      apply: (plugin) => guardAction(plugin, "*", { before: () => Effect.succeed(allow) }),
    });
    await Effect.runPromise(kernel.load(governance));
    expect(await call(interception, echo())).toMatchObject({ status: "succeeded" });
    await Effect.runPromise(kernel.unload("governance"));
    expect(await call(interception, echo())).toMatchObject({ code: "forbidden" });
  });
});

describe("calls inside calls", () => {
  test("each nested call is guarded again, as its caller, and nesting stops at the depth limit", async () => {
    ran = 0;
    const actors: string[] = [];
    const counting = guard(
      "counting",
      {
        before: ({ invocation }) =>
          Effect.sync(() => {
            actors.push(invocation.actor);
            return allow;
          }),
      },
      "test.recurse",
    );
    const receipt = await call(interceptionOf({ guards: [counting] }), {
      id: "test.recurse",
      input: {},
      actor: "agent",
    });
    expect(receipt.status).toBe("succeeded");
    expect(ran).toBe(MAX_CALL_DEPTH);
    expect(actors).toEqual(Array.from({ length: MAX_CALL_DEPTH }, () => "agent"));
    // The innermost call answered with the refusal, carried out as output.
    expect(JSON.stringify(receipt)).toContain(`calls nest deeper than ${MAX_CALL_DEPTH}`);
  });

  test("a call a guard or an interceptor makes nests in the call it was asked about, to the same limit", async () => {
    for (const kind of ["guard", "interceptor"] as const) {
      let asked = 0;
      const nested = () =>
        // A listener that calls the action it listens to, as a careless one might.
        invokeReceiptWith(ACTIONS, ctx, echo()) as unknown as Effect.Effect<ActionReceipt>;
      const reentrant =
        kind === "guard"
          ? interceptionOf({
              guards: [
                guard("reentrant", {
                  before: () =>
                    Effect.gen(function* () {
                      asked += 1;
                      yield* nested();
                      return allow;
                    }),
                }),
              ],
            })
          : interceptionOf({
              interceptors: [
                interceptor("reentrant", {
                  input: ({ invocation }) =>
                    Effect.gen(function* () {
                      asked += 1;
                      yield* nested();
                      return invocation.input;
                    }),
                }),
              ],
            });
      const receipt = await call(reentrant, echo());
      expect(receipt.status).toBe("succeeded");
      expect(asked).toBe(MAX_CALL_DEPTH);
    }
  });
});
