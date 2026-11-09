/** After-commit behavior is one contract over every store selected by the host. */
import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { z } from "zod";
import {
  ActionReceiptSchema,
  CurrentInterception,
  CurrentReactions,
  ExtensionCatalog,
  ExtensionFailures,
  FamilyKernels,
  extensionRow,
  guardAction,
  onCommit,
  type ActionInvocation,
  type ActionMode,
  type ActionReceipt,
  type KbContext,
  type Reactions,
  type TxReaction,
} from "@kb/contracts";
import { SYSTEM_IDS, present, type StoreTx } from "@kb/model";
import {
  coreActions,
  interceptionFrom,
  invokeReceiptWith,
  MAX_REACTION_DEPTH,
  persistEffect,
  reactionsFrom,
  reloadEffect,
  type RegisteredAction,
} from "@kb/operations";
import { definePlugin, makeKernel, type Kernel } from "@kb/plugin";
import { kbRuntimeLayer } from "@kb/runtime";
import {
  backendRoot,
  CONTRACT_AT,
  openSession,
  plainNode,
  type StoreFactory,
} from "./store-session.ts";

interface Harness {
  readonly root: string;
  readonly ctx: KbContext;
  readonly kernel: Kernel;
  readonly reactions: Reactions;
  readonly actions: Map<string, RegisteredAction>;
  readonly run: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt>;
  readonly write: (tx: StoreTx) => Effect.Effect<ActionReceipt>;
}

function action(
  id: string,
  effect: NonNullable<RegisteredAction["effect"]>,
  mode: ActionMode = { kind: "write" },
): RegisteredAction {
  return {
    def: {
      id,
      title: id,
      description: id,
      mode,
      inputSchema: z.looseObject({}),
      outputSchema: z.unknown(),
    },
    effect,
    source: "core",
    aliases: [],
  };
}

const fixture = Effect.fn("reactionContract.fixture")(function* (
  makeStore: StoreFactory,
  budgetMs: number,
) {
  const root = yield* backendRoot(makeStore);
  const ctx = yield* openSession(root);
  const kernel = makeKernel({ host: "registry" });
  yield* Effect.addFinalizer(() => kernel.shutdown);
  const reactions = reactionsFrom(kernel, budgetMs);
  const actions = new Map(coreActions.map((entry) => [entry.def.id, entry]));
  const catalog = [
    extensionRow(
      { name: "reactor", label: "Reactor" },
      { source: "fixture", origin: { kind: "host" } },
      true,
    ),
  ];
  const run = (invocation: ActionInvocation) =>
    invokeReceiptWith(actions, ctx, invocation).pipe(
      Effect.provideService(CurrentInterception, interceptionFrom(kernel)),
      Effect.provideService(CurrentReactions, reactions),
      Effect.provideService(ExtensionCatalog, catalog),
      Effect.provideService(ExtensionFailures, []),
      Effect.provideService(FamilyKernels, [{ source: "registry", kernel }]),
      Effect.provide(kbRuntimeLayer(ctx)),
    );
  let writes = 0;
  const write = (tx: StoreTx) => {
    const id = `test.write.${++writes}`;
    actions.set(
      id,
      action(id, () => persistEffect(ctx, tx).pipe(Effect.as({}))),
    );
    return run({ id, input: {}, actor: "human" });
  };
  return { root, ctx, kernel, reactions, actions, run, write } satisfies Harness;
});

function withReactions<E>(
  makeStore: StoreFactory,
  use: (h: Harness) => Effect.Effect<void, E>,
  budgetMs = 2000,
): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* use(yield* fixture(makeStore, budgetMs));
      }),
    ),
  );
}

function listen(h: Harness, entries: Readonly<Record<string, TxReaction>>) {
  return h.kernel.load(
    definePlugin({
      name: "reactor",
      apply: (ctx) =>
        Effect.forEach(
          Object.entries(entries),
          ([id, reaction]) => onCommit(ctx, reaction.match, reaction.react, id),
          { discard: true },
        ),
    }),
  );
}

function settledOuterCall(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      const reads: string[][] = [];
      yield* listen(h, {
        seen: {
          match: { created: true },
          react: () =>
            Effect.sync(() => {
              reads.push(
                h.ctx.nodes
                  .filter(({ id }) => id === "first" || id === "second")
                  .map(({ id }) => id)
                  .toSorted(),
              );
            }),
        },
      });
      h.actions.set(
        "test.outer",
        action("test.outer", () =>
          Effect.gen(function* () {
            yield* h.run({ id: "node.add", input: { id: "first", text: "first" }, actor: "human" });
            expect(reads).toEqual([]);
            yield* h.run({
              id: "node.add",
              input: { id: "second", text: "second" },
              actor: "human",
            });
            expect(reads).toEqual([]);
            return {};
          }),
        ),
      );
      expect((yield* h.run({ id: "test.outer", input: {}, actor: "human" })).status).toBe(
        "succeeded",
      );
      expect(reads).toEqual([
        ["first", "second"],
        ["first", "second"],
      ]);
    }),
  );
}

function committedThenFailed(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      const seen: string[] = [];
      yield* listen(h, {
        seen: {
          match: { created: true },
          react: (change) =>
            Effect.sync(() => {
              seen.push(
                ...change.writes.flatMap(({ after }) => (after === undefined ? [] : [after.id])),
              );
            }),
        },
      });
      const outer = action("test.bad-output", () =>
        persistEffect(h.ctx, { upserts: [plainNode("committed", "committed")], deletes: [] }).pipe(
          Effect.as({}),
        ),
      );
      outer.def = { ...outer.def, outputSchema: z.object({ valid: z.literal(true) }) };
      h.actions.set(outer.def.id, outer);
      expect((yield* h.run({ id: outer.def.id, input: {}, actor: "human" })).status).toBe("failed");
      expect(seen).toEqual(["committed"]);
      yield* h.run({ id: "node.get", input: { id: "committed" }, actor: "human" });
      expect(seen).toEqual(["committed"]);
    }),
  );
}

function localCommitsOnly(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      let calls = 0;
      yield* listen(h, {
        seen: {
          match: { created: true },
          react: () =>
            Effect.sync(() => {
              calls += 1;
            }),
        },
      });
      yield* makeStore(h.root).commitEffect(
        { upserts: [plainNode("foreign", "foreign")], deletes: [] },
        { at: CONTRACT_AT },
      );
      yield* reloadEffect(h.ctx).pipe(Effect.provide(kbRuntimeLayer(h.ctx)));
      h.ctx.log.refresh();
      h.ctx.log.append({ upserts: [plainNode("virtual", "virtual")], deletes: [] }, CONTRACT_AT);
      yield* h.run({ id: "node.get", input: { id: "foreign" }, actor: "human" });
      expect(calls).toBe(0);
      yield* h.run({ id: "node.add", input: { id: "local", text: "local" }, actor: "human" });
      expect(calls).toBe(1);
    }),
  );
}

function dataMatches(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      const tag = {
        ...plainNode("inbox-tag", "inbox"),
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.tag }] },
      };
      const field = {
        ...plainNode("note-field", "note"),
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.field }] },
      };
      yield* h.write({ upserts: [tag, field], deletes: [] });
      const seen: string[] = [];
      const reaction = (name: string, match: TxReaction["match"]): TxReaction => ({
        match,
        react: (change) =>
          Effect.sync(() => {
            seen.push(`${name}:${change.writes.length}`);
          }),
      });
      yield* listen(h, {
        tagged: reaction("tagged", { tagged: [tag.id] }),
        untagged: reaction("untagged", { untagged: [tag.id] }),
        fields: reaction("fields", { fields: [field.id] }),
        created: reaction("created", { created: true }),
        deleted: reaction("deleted", { deleted: true }),
      });
      const node = {
        ...plainNode("subject", "subject"),
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: tag.id }],
          [field.id]: [{ t: "str" as const, v: "one" }],
        },
      };
      yield* h.write({ upserts: [node], deletes: [] });
      expect(seen.toSorted()).toEqual(["created:1", "fields:1", "tagged:1"]);
      seen.length = 0;
      yield* h.write({
        upserts: [{ ...node, props: { [field.id]: [{ t: "str", v: "two" }] } }],
        deletes: [],
      });
      expect(seen.toSorted()).toEqual(["fields:1", "untagged:1"]);
      seen.length = 0;
      yield* h.write({ upserts: [], deletes: [node.id] });
      expect(seen.toSorted()).toEqual(["deleted:1", "fields:1"]);
    }),
  );
}

function ownWritesExcluded(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      let calls = 0;
      yield* listen(h, {
        self: {
          match: { created: true },
          react: (_change, kb) =>
            Effect.gen(function* () {
              calls += 1;
              yield* kb.invoke("node.add", { text: "reaction child" });
            }),
        },
      });
      expect(
        (yield* h.run({ id: "node.add", input: { id: "start", text: "start" }, actor: "human" }))
          .status,
      ).toBe("succeeded");
      expect(calls).toBe(1);
      expect(h.ctx.nodes.filter(({ text }) => text === "reaction child")).toHaveLength(1);
      expect(h.ctx.store.txTail.entries().at(-1)?.actor).toEqual({
        kind: "reaction",
        id: "reactor.self",
      });
      const history = yield* h.run({ id: "graph.changes", input: { since: 0 }, actor: "human" });
      expect(history.status).toBe("succeeded");
    }),
  );
}

function chainStops(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      let calls = 0;
      const tagA = {
        ...plainNode("tag-a", "A"),
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.tag }] },
      };
      const tagB = {
        ...plainNode("tag-b", "B"),
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.tag }] },
      };
      yield* h.write({ upserts: [tagA, tagB], deletes: [] });
      h.actions.set(
        "test.flip",
        action("test.flip", () =>
          Effect.gen(function* () {
            const before = present(h.ctx.index.getNode("loop"), "loop node");
            const current = before.props[SYSTEM_IDS.typeField]?.[0]?.v;
            yield* persistEffect(h.ctx, {
              upserts: [
                {
                  ...before,
                  props: {
                    [SYSTEM_IDS.typeField]: [
                      { t: "ref", v: current === tagA.id ? tagB.id : tagA.id },
                    ],
                  },
                },
              ],
              deletes: [],
            });
            return {};
          }),
        ),
      );
      const react = (tag: string): TxReaction => ({
        match: { tagged: [tag] },
        react: (_change, kb) =>
          Effect.gen(function* () {
            calls += 1;
            yield* kb.invoke("test.flip", {});
          }),
      });
      yield* listen(h, { one: react(tagA.id), two: react(tagB.id) });
      yield* h.write({
        upserts: [
          {
            ...plainNode("loop", "loop"),
            props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tagA.id }] },
          },
        ],
        deletes: [],
      });
      expect(calls).toBe(MAX_REACTION_DEPTH);
      expect(
        h.reactions.failures().some(({ message }) => message.includes("reaction chain exceeds 4")),
      ).toBe(true);
    }),
  );
}

function failureIsolation(makeStore: StoreFactory): Promise<void> {
  return withReactions(
    makeStore,
    (h) =>
      Effect.gen(function* () {
        let observed = "";
        yield* listen(h, {
          bad: {
            match: { created: true },
            react: (change) =>
              Effect.sync(() => {
                present(change.writes[0]?.after, "written node").text = "clobbered";
              }),
          },
          slow: { match: { created: true }, react: () => Effect.never },
          good: {
            match: { created: true },
            react: (change, host) =>
              Effect.sync(() => {
                expect(change.tx).not.toHaveProperty("ops");
                expect(host).not.toHaveProperty("store");
                expect(host).not.toHaveProperty("log");
                observed = present(change.writes[0]?.after, "written node").text;
              }),
          },
        });
        expect(
          (yield* h.run({ id: "node.add", input: { id: "safe", text: "safe" }, actor: "human" }))
            .status,
        ).toBe("succeeded");
        expect(observed).toBe("safe");
        expect(h.ctx.index.getNode("safe")?.text).toBe("safe");
        expect(
          h.reactions
            .failures()
            .map(({ id }) => id)
            .toSorted(),
        ).toEqual(["reactor.bad", "reactor.slow"]);
        const report = yield* h.run({ id: "extension.list", input: {}, actor: "human" });
        expect(report.status).toBe("succeeded");
        if (report.status === "succeeded")
          expect(JSON.stringify(report.output)).toContain("budget exceeded");
      }),
    30,
  );
}

function hostRetires(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      const retained: Effect.Effect<ActionReceipt>[] = [];
      const during: ActionReceipt[] = [];
      yield* listen(h, {
        early: {
          match: { created: true },
          react: (_change, kb) =>
            Effect.sync(() => {
              retained.push(kb.invoke("node.add", { id: "late", text: "late" }));
            }),
        },
        throws: {
          match: { created: true },
          react: (_change, kb) => {
            retained.push(kb.invoke("node.add", { id: "late-throw", text: "late" }));
            throw new Error("callback construction failed");
          },
        },
        later: {
          match: { created: true },
          react: () =>
            Effect.gen(function* () {
              yield* Effect.sleep(5);
              for (const pending of retained) during.push(yield* pending);
            }),
        },
      });
      yield* h.run({ id: "node.add", input: { id: "start", text: "start" }, actor: "human" });
      expect(during.map(({ status }) => status)).toEqual(["failed", "failed"]);
      for (const pending of retained) expect((yield* pending).status).toBe("failed");
      expect(h.ctx.nodes.some(({ id }) => id === "late" || id === "late-throw")).toBe(false);
    }),
  );
}

function approvalAndGuards(makeStore: StoreFactory): Promise<void> {
  return withReactions(makeStore, (h) =>
    Effect.gen(function* () {
      let approvedRan = 0;
      const answers: ActionReceipt[] = [];
      h.actions.set(
        "test.approval",
        action(
          "test.approval",
          () =>
            Effect.sync(() => {
              approvedRan += 1;
              return {};
            }),
          { kind: "write", approval: "required" },
        ),
      );
      h.actions.set(
        "test.spoof",
        action("test.spoof", () =>
          h.run({ id: "test.approval", input: {}, actor: "human", approved: true }),
        ),
      );
      yield* h.kernel.load(
        definePlugin({
          name: "guard",
          apply: (ctx) =>
            guardAction(ctx, "node.update", {
              commit: () =>
                Effect.succeed({ decision: "deny", rule: "fixture", message: "guarded" }),
            }),
        }),
      );
      yield* listen(h, {
        act: {
          match: { created: true },
          react: (_change, kb) =>
            Effect.gen(function* () {
              answers.push(yield* kb.invoke("test.approval", {}));
              const nested = yield* kb.invoke("test.spoof", {});
              if (nested.status === "succeeded")
                answers.push(ActionReceiptSchema.parse(nested.output));
              answers.push(yield* kb.invoke("node.update", { id: "start", text: "blocked" }));
              answers.push(
                yield* kb.invoke("node.update", { id: "sys.extensions", text: "protected" }),
              );
            }),
        },
      });
      yield* h.run({
        id: "node.add",
        input: { id: "start", text: "start" },
        actor: "human",
        approved: true,
      });
      expect(approvedRan).toBe(0);
      expect(
        answers
          .slice(0, 2)
          .map((answer) => (answer.status === "failed" ? answer.code : "succeeded")),
      ).toEqual(["approval_required", "approval_required"]);
      expect(answers.slice(2).every((answer) => answer.status === "failed")).toBe(true);
      expect(h.ctx.index.getNode("start")?.text).toBe("start");
    }),
  );
}

function interruptedOuterCall(makeStore: StoreFactory): Promise<void> {
  return withReactions(
    makeStore,
    (h) =>
      Effect.gen(function* () {
        const committed = yield* Deferred.make<void>();
        yield* listen(h, { slow: { match: { created: true }, react: () => Effect.never } });
        h.actions.set(
          "test.interrupted",
          action("test.interrupted", () =>
            Effect.gen(function* () {
              yield* persistEffect(h.ctx, {
                upserts: [plainNode("interrupted", "committed")],
                deletes: [],
              });
              yield* Deferred.succeed(committed, undefined);
              return yield* Effect.never;
            }),
          ),
        );
        const outer = yield* h
          .run({ id: "test.interrupted", input: {}, actor: "human" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(committed);
        yield* Fiber.interrupt(outer);
        expect(h.ctx.index.getNode("interrupted")?.text).toBe("committed");
        expect(
          h.reactions
            .failures()
            .map(({ message }) => message)
            .join(" "),
        ).toContain("budget exceeded");
      }),
    30,
  );
}

const PROPERTIES: readonly (readonly [string, (makeStore: StoreFactory) => Promise<void>])[] = [
  ["nested commits react only after the outer call settles", settledOuterCall],
  ["a committed write reacts even when the outer output subsequently fails", committedThenFailed],
  ["adopted and log-only transactions never react or replay", localCommitsOnly],
  ["data matches select only changed nodes before extension code runs", dataMatches],
  ["a reaction's own writes are excluded and retain its identity in history", ownWritesExcluded],
  ["mutual reaction chains stop at the separate depth cap", chainStops],
  ["defects and overruns leave the outer receipt and other observers intact", failureIsolation],
  ["reactions and their nested calls cannot inherit approval or skip guards", approvalAndGuards],
  ["a retained host call retires when its callback settles", hostRetires],
  ["an interrupted outer call still bounds its drain", interruptedOuterCall],
];

export function reactionContract(name: string, makeStore: StoreFactory): void {
  describe(`${name} — tx/after contract`, () => {
    for (const [title, property] of PROPERTIES) test(title, () => property(makeStore));
  });
}
