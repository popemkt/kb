import type { NodeIndex } from "@kb/query";
import { seedRemovalNodes } from "@kb/seed";
import { Clock, Effect, Random, Result } from "effect";
import {
  currentIso,
  extensionNameOf,
  SYSTEM_IDS,
  type DomainError,
  domainError,
  txIntegrityError,
  writeRefusalMessage,
  writesOf,
  type KbNode,
  type NodeId,
  type StoreTx,
} from "@kb/model";
import {
  CurrentCall,
  CurrentInterception,
  KbStore,
  TxOrigin,
  WriteLockDeadline,
  type KbContext,
  type StoreCommit,
  type StoreFingerprint,
} from "@kb/contracts";
import { CurrentCommitFrame } from "./commit-frame.ts";
import { guardCommit, refusalOf } from "./interception.ts";
import { scriptWriteRefusal } from "@kb/sandbox";
import { personWriteRefusal } from "./write-refusal.ts";

/**
 * The store as this session last saw it.
 *
 * Reload exists for one reason — another process may have written the store —
 * and that question has a cheap answer. Without it, every defensive reload
 * (the HTTP path before each action, the watcher after each write) pays a full
 * parse and index build to discover that nothing changed, and a session's own
 * write looks exactly like someone else's.
 *
 * What makes two states "the same" is the store's business, not this module's:
 * it hands out an opaque {@link StoreFingerprint} and these functions only
 * compare. Kept beside reload rather than on `KbContext`: it is this module's
 * memory of the store, not part of the session's contract.
 */
const seen = new WeakMap<KbContext<NodeIndex>, StoreFingerprint>();

/**
 * Record that this session's index reflects the store as it is now.
 * Opening a session builds the index from the store it just read, so it says so
 * here; without that first mark the next reload rebuilds an index that is
 * already correct.
 */
export const noteStoreSynced = Effect.fn("kb.noteStoreSynced")(function* (
  ctx: KbContext<NodeIndex>,
): Effect.fn.Return<void, never, KbStore> {
  const store = yield* KbStore;
  const fingerprint = yield* store.fingerprint;
  if (fingerprint !== null) seen.set(ctx, fingerprint);
});

/**
 * Bring the session up to date with the store. A no-op when the store is in
 * the state this session last read or wrote.
 *
 * Answers the stored nodes the reload replaced, or null when the session was
 * already current, so a caller that must say what moved (the server's ingest
 * of another writer's change) compares against the state it actually held,
 * and asks nothing of the graph when nothing moved.
 *
 * The index keeps its virtual nodes (saved queries materialised by `kb ui`,
 * which live in the index and never in jsonl) across the rebuild, so a
 * post-write reload cannot leave the graph empty of them — and a `sys.query.*`
 * that really was persisted and then deleted cannot resurrect, because it was
 * never in the virtual set.
 */
export const reloadEffect = Effect.fn("kb.reload")(function* (
  ctx: KbContext<NodeIndex>,
): Effect.fn.Return<ReadonlyArray<KbNode> | null, DomainError, KbStore> {
  const store = yield* KbStore;
  const fingerprint = yield* store.fingerprint;
  if (fingerprint !== null && fingerprint === seen.get(ctx)) return null;
  const loaded = yield* store.loadEffect;
  const replaced = ctx.index.storedNodes();
  // GAP [[01M6950WQN8VDWJMSH8EZ8X3DR]] replay a foreign commit through the incremental index
  ctx.index.rebuild(loaded);
  if (fingerprint !== null) seen.set(ctx, fingerprint);
  return replaced;
});

/**
 * Who answers for a commit's writes to system nodes: a person's write is
 * `checked` against the system-write rule; the owner's force (`forced`) and
 * kb's own code writing the schema it owns (`system`: a migration, a family
 * minting its nodes, a fixture) are not.
 */
type SystemWrites = "checked" | "forced" | "system";

export interface PersistOptions {
  readonly systemWrites?: SystemWrites;
  /**
   * The state the commit lands on, or it fails `conflict` and writes
   * nothing (the store's conditional commit): for a write decided on a
   * state its caller read. Without it, the commit merges into whatever is
   * there.
   */
  readonly expected?: StoreFingerprint;
}

/**
 * Commit a transaction and move the index with it.
 *
 * The catch-up first is not defensive noise: the store commits under a lock by
 * reloading, merging and replacing the whole file, so anything another process
 * wrote lands in the file this commit produces. It also means integrity is
 * checked against the graph the commit will actually merge into.
 *
 * The catch-up cannot be the whole answer, though: it happens outside the
 * store's lock, so a write can still land between it and the merge. So the
 * commit is conditional on the state the checks below read (the store's
 * conditional commit): a commit's integrity, system-write rule and guards
 * hold for the state it lands on, whoever else writes at the same time, and
 * a guard's "one node per key" is a promise across processes, not a hope.
 * For a transaction authored independently of the graph, the same write is checked and
 * committed again under the session retry policy (DESIGN.md → Storage). A
 * caller that names its own `expected` (a write planned from what it read)
 * gets that state or the conflict, and can plan again itself. A write that
 * derives its transaction from the graph uses {@link persistPlannedEffect}.
 *
 * The transaction is recorded by the commit itself: the store's tail is
 * durable and the store is the only thing that can make the node write and
 * the record one act, so this function hands the commit the caller's half of
 * the entry (`at`, and the ambient {@link TxOrigin}) and then asks the log to
 * catch up to whatever the tail now holds. `refresh` rather than an append,
 * because the same call also adopts anything another process appended in the
 * meantime — the log has one way to learn what happened, not two.
 *
 * A person's write to a virtual node is refused the same way
 * (`virtualWriteRefusal`): it is file-backed, whatever its id.
 *
 * The commit is the one owner of the system-write rule (`systemTxRefusal`,
 * DESIGN.md → Data model → write protection): a transaction that writes a
 * `sys.*` node beyond what a person may write there is refused here, before
 * the store is touched, whoever planned it. A commit made with the owner's
 * force, or by kb's own code writing its own schema, says so in
 * `systemWrites`; nothing skips the check by not calling it.
 *
 * Inside a script's invocation, what the commit writes is bounded to the
 * script's subject (`scriptWriteRefusal`), so no action can write past it.
 *
 * Inside an invocation, the guards are asked again with what the commit
 * writes (`guardCommit`), and a refusal is made here, before the store is
 * touched, as a guard reads what is written (the governance family's
 * approval guard would refuse a write to an approval policy with no person
 * behind the call; it is not contributed for now).
 */
export const persistEffect = Effect.fn("kb.persist")(function* (
  ctx: KbContext<NodeIndex>,
  tx: StoreTx,
  options: PersistOptions = {},
): Effect.fn.Return<StoreCommit, DomainError, KbStore> {
  const commit = persistAttempt(ctx, tx, options);
  return yield* options.expected === undefined ? retryCommit(Effect.result(commit)) : commit;
});

const COMMIT_WAIT_MS = 15_000;

// Preparing a write may itself refuse. Only a conflict during commit starts another attempt.
const retryCommit = Effect.fnUntraced(function* <A, R>(
  attempt: Effect.Effect<Result.Result<A, DomainError>, DomainError, R>,
) {
  const deadline = (yield* WriteLockDeadline) ?? (yield* Clock.currentTimeMillis) + COMMIT_WAIT_MS;
  const run = Effect.provideService(attempt, WriteLockDeadline, deadline);
  let delayCap = 10;
  for (;;) {
    const result = yield* run;
    if (Result.isSuccess(result)) return result.success;
    const { failure } = result;
    if (failure.code !== "conflict") return yield* failure;

    const now = yield* Clock.currentTimeMillis;
    const delay = delayCap * (yield* Random.next);
    if (now + delay >= deadline) return yield* failure;
    yield* Effect.sleep(delay);
    if ((yield* Clock.currentTimeMillis) >= deadline) return yield* failure;
    delayCap = Math.min(delayCap * 2, 250);
  }
});

/**
 * One attempt of {@link persistEffect}: catch up, check, and commit on the
 * state the checks read, or on the caller's `expected`.
 */
const persistAttempt = Effect.fn("kb.persist.attempt")(function* (
  ctx: KbContext<NodeIndex>,
  tx: StoreTx,
  { systemWrites = "checked", expected }: PersistOptions,
): Effect.fn.Return<StoreCommit, DomainError, KbStore> {
  const store = yield* KbStore;
  const origin = yield* TxOrigin;
  yield* reloadEffect(ctx);
  const checkedOn = expected ?? seen.get(ctx);
  const integrityError = txIntegrityError(ctx.nodes, tx);
  if (integrityError !== null && integrityError !== "") {
    return yield* domainError("invalid_input", `invalid graph transaction: ${integrityError}`);
  }
  const call = yield* CurrentCall;
  if (systemWrites === "checked") {
    const refused = personWriteRefusal(tx, ctx.index);
    if (refused !== null) {
      return yield* domainError("forbidden", writeRefusalMessage(refused), {
        ...refused,
        ...(call === null ? {} : { action: call.invocation.id }),
      });
    }
  }
  if (call !== null) {
    const outOfReach = scriptWriteRefusal(call.invocation, tx, ctx);
    if (outOfReach !== null) {
      return yield* domainError("forbidden", outOfReach.message, outOfReach.details);
    }
    const writes = writesOf(tx, (id) => ctx.index.getNode(id));
    const outcome = yield* guardCommit(yield* CurrentInterception, {
      ctx,
      ...call,
      writes,
      nodeOf: (id) => ctx.index.getNode(id),
    });
    const refusal = refusalOf(outcome, call.invocation);
    if (refusal !== null) return yield* domainError(refusal.code, refusal.message, refusal.details);
  }
  const caughtUpTo = seen.get(ctx) ?? null;
  // Who made the call is recorded with what it wrote; nothing decides by it.
  const actor = call === null ? {} : { actor: call.invocation.actor };
  const session = call?.invocation.session;
  const where = session === undefined ? {} : { session };
  const via = call?.invocation.via;
  const label = via === undefined ? {} : { via };
  const at = yield* currentIso;
  // GAP [[01M549TK1WP4E6T4QHNDRSDYQA]]: a direct client's index knows only bundled owners.
  const choices =
    systemWrites === "system"
      ? []
      : seedRemovalNodes(
          tx,
          (id) => ctx.index.getNode(id),
          (id) =>
            ctx.index.related(id, ":node/owner").length > 0 ||
            (extensionNameOf(id) !== undefined &&
              ctx.index.getNode(SYSTEM_IDS.extensionsRoot)?.children.includes(id) === true),
          at,
        );
  const write = choices.length === 0 ? tx : { ...tx, upserts: [...tx.upserts, ...choices] };
  const commit = yield* store.commitEffect(
    write,
    { at, origin, ...actor, ...where, ...label },
    checkedOn,
  );
  // Once durable, reconciliation and receipt capture finish even if the caller is interrupted.
  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      if (commit.base !== null && commit.base === caughtUpTo) {
        // The store's version of the delta: it carries the ranks the commit
        // settled, which `tx` may not.
        ctx.index.applyTx(commit.tx);
        if (commit.fingerprint !== null) seen.set(ctx, commit.fingerprint);
      } else {
        // The commit merged into a store this session had not read, so the file it
        // wrote holds nodes our delta does not mention. Applying only `tx` would
        // leave the index short of them and the stamp would call that current.
        // Forget the stamp and read what was actually written.
        seen.delete(ctx);
        yield* reloadEffect(ctx);
      }
      ctx.log.refresh();
      const frame = yield* CurrentCommitFrame;
      if (frame !== null) yield* frame.capture(commit);
    }),
  );
  return commit;
});

/**
 * Commit a write planned from the graph as this session read it: `plan`
 * sees the session's nodes once it has caught up, and what it plans lands
 * only on that same state (the store's conditional commit, `expected`). A
 * plan that replaces a whole node from what it read (a list's children, say)
 * would otherwise merge over a write another process made in between and
 * lose it. When the store moved, the plan is made again over what it now
 * holds under the session retry policy (DESIGN.md → Storage). A plan may
 * refuse (a node it needs is gone, say), and the refusal is the caller's
 * failure. Answers what was committed, or null when `plan` had nothing to
 * write.
 */
export const persistPlannedEffect = Effect.fn("kb.persistPlanned")(function* <
  W extends { readonly upserts: readonly KbNode[]; readonly deletes: readonly NodeId[] },
  R = never,
>(
  ctx: KbContext<NodeIndex>,
  plan: (nodes: readonly KbNode[]) => Effect.Effect<W | null, DomainError, R>,
  options: PersistOptions = {},
): Effect.fn.Return<W | null, DomainError, KbStore | R> {
  return yield* retryCommit(
    Effect.gen(function* () {
      yield* reloadEffect(ctx);
      const expected = seen.get(ctx);
      const write = yield* plan(ctx.nodes);
      if (write === null || (write.upserts.length === 0 && write.deletes.length === 0))
        return Result.succeed(write);
      const tx: StoreTx = { upserts: [...write.upserts], deletes: [...write.deletes] };
      return yield* Effect.result(
        Effect.as(persistAttempt(ctx, tx, { ...options, expected }), write),
      );
    }),
  );
});
