import { Effect, Layer, Predicate } from "effect";
import {
  type ActionRequest,
  type ActionReceipt,
  type FilledInput,
  type KbContext,
  type KbCtx,
  type KbStore,
  ContextReferencePoint,
  CurrentContextReferences,
  CurrentInterception,
  PAGE_WIRE,
  Screens,
  type ScreensPort,
  contextReferencesOf,
  ViewCatalog,
  failed,
  kbCtxLayer,
  kbStoreLayer,
  onWire,
} from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";
import {
  DatalogError,
  type NodeIndex,
  type QueryEngine,
  QueryEngineService,
  QueryError,
} from "@kb/query"; // GAP [[01M1RXNP3EMV1ES85BVE9CXMYE]]
import { StoreTxLog } from "@kb/tx-log";
import {
  interceptionFrom,
  invokeReceiptWith,
  isomorphicActions,
  noteStoreSynced,
} from "@kb/operations";
import { postAction, type ActionResponse } from "@/api/action";
import { inTabSession } from "@/api/tab-session";
import {
  answerMessage,
  type QueryAnswer,
  type QueryAnswers,
  toast,
  uiKernelReader,
} from "@kb/ui-sdk";
import { livePageCatalog } from "@/lib/view-catalog";
import { BrowserStore } from "./browser-store";
import { BrowserReplica, type Hold, type ReplicaLink } from "./replica";

/** How the graph store follows the session: local commits, server deltas, snapshots. */
export interface BrowserSessionView {
  readonly onLocalCommit: () => void;
  readonly applyServerTx: (tx: StoreTx, rev: number) => void;
  readonly installServerSnapshot: (nodes: KbNode[], rev: number) => void;
  /** A change made elsewhere reached what the page shows (`ReplicaView.arrived`). */
  readonly arrived: () => void;
}

interface BrowserSession {
  readonly ctx: KbContext<NodeIndex>;
  readonly store: BrowserStore;
  readonly layer: Layer.Layer<KbCtx | KbStore | QueryEngineService | ViewCatalog>;
  readonly onLocalCommit: () => void;
  readonly replica: BrowserReplica;
}

let session: BrowserSession | null = null;
let link: ReplicaLink | null = null;
let pushTail = Promise.resolve();

/**
 * Where an action can run is decided by what its handler needs, not by its
 * mode: `isomorphicActions` are those whose handlers need only the store and
 * index (`IsomorphicActionEnv`), whether they read or write.
 */
const localActions = new Map(isomorphicActions.map((action) => [action.def.id, action]));

/**
 * The guards and interceptors a local call goes through: the page kernel's,
 * where the families the server reports loaded contribute the same plugins
 * the server loads (governance's guards among them), so the replica decides
 * a local call as the server does. The server decides again on the push.
 */
const localInterception = interceptionFrom(uiKernelReader);

/**
 * The context references a local call is filled from: the page kernel's, the
 * same families' declarations the server loads, so both resolve "this" alike.
 */
const localReferences = contextReferencesOf(() =>
  uiKernelReader.contributions(ContextReferencePoint),
);

function noteBrowserStoreSynced(current: BrowserSession): void {
  Effect.runSync(noteStoreSynced(current.ctx).pipe(Effect.provide(current.layer)));
}

/**
 * An answer that is not rows, as the action boundary reads it
 * (`classifyQueryError`): wrong datalog is the caller's; a refusal of any
 * other kind, or a run stopped at its budget, is not.
 */
function refusal(answer: Exclude<QueryAnswer, { kind: "rows" }>): Error {
  if (answer.kind === "error" && answer.name === "DatalogError") {
    return new DatalogError(answer.message);
  }
  const error = new Error(answerMessage(answer));
  error.name = answer.kind === "error" ? answer.name : "QueryOverBudget";
  return error;
}

/**
 * The page's query engine as an action asks it (`QueryEngineService`): each
 * query answered by the replica's engine, once, as of now. An action's query
 * may carry inputs, which no reader of the page's answers shares, so it is
 * asked outside them (`QueryAnswers.once`).
 */
function pageEngine(queries: QueryAnswers): QueryEngine {
  return {
    runDatalog: (edn, inputs) =>
      Effect.promise(() => queries.once({ edn, ...(inputs === undefined ? {} : { inputs }) })).pipe(
        Effect.flatMap((answer) =>
          answer.kind === "rows"
            ? Effect.succeed(answer.rows)
            : Effect.fail(new QueryError({ cause: refusal(answer) })),
        ),
      ),
  };
}

/** Install the browser infrastructure around the graph store's one index and its engine. */
export function replaceBrowserSession(
  nodes: readonly KbNode[],
  rev: number,
  index: NodeIndex,
  queries: QueryAnswers,
  view: BrowserSessionView,
): void {
  const store = new BrowserStore(nodes);
  const ctx: KbContext<NodeIndex> = {
    root: "browser",
    store,
    index,
    log: new StoreTxLog(store.txTail),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  const nextSession: BrowserSession = {
    ctx,
    store,
    layer: Layer.mergeAll(
      kbStoreLayer(store),
      kbCtxLayer(ctx),
      Layer.succeed(QueryEngineService, pageEngine(queries)),
      Layer.succeed(ViewCatalog, livePageCatalog),
    ),
    onLocalCommit: view.onLocalCommit,
    replica: new BrowserReplica(
      nodes,
      rev,
      {
        apply: view.applyServerTx,
        install: view.installServerSnapshot,
        local: (id) => index.getNode(id),
        arrived: view.arrived,
      },
      () => link,
    ),
  };
  session = nextSession;
  noteBrowserStoreSynced(nextSession);
}

/** Advance the replicated store and index together when a server tx arrives. */
export function ingestBrowserTx(tx: StoreTx): void {
  const current = session;
  if (current === null) return;
  current.store.apply(tx);
  current.ctx.index.applyTx(tx);
  noteBrowserStoreSynced(current);
}

/** Replace the replicated store and index with an authoritative server snapshot. */
export function installBrowserNodes(nodes: readonly KbNode[]): void {
  const current = requireSession();
  current.store.replace(nodes);
  current.ctx.index.rebuild([...nodes]);
  noteBrowserStoreSynced(current);
}

/** The current session's sync machine; null before the first hydrate. */
export function browserReplica(): BrowserReplica | null {
  return session?.replica ?? null;
}

/**
 * This tab's screen as its own calls read it, once the screen plugin serves
 * it (`screen.ts`): what a local call made in the tab's session fills from.
 * Without it a local call fills nothing.
 */
let localScreens: ScreensPort | null = null;

export function setLocalScreens(screens: ScreensPort | null): void {
  localScreens = screens;
}

/** The network the sync machine talks through (the live socket and /api/graph). */
export function setBrowserLink(next: ReplicaLink | null): void {
  link = next;
}

function requireSession(): BrowserSession {
  if (session === null) throw new Error("browser kb session is not hydrated");
  return session;
}

/**
 * The one ordered network lane for this tab's writes (DESIGN-UI.md → Replica
 * sync → Push lane). The server is handed the writes in the order the tab
 * committed them, so it judges each against the graph the person saw when
 * they made it. A push that carries a hold settles it with its receipt.
 */
function send(invocation: ActionRequest, hold?: Hold): Promise<ActionResponse> {
  const result = pushTail.catch(() => undefined).then(() => postAction(invocation));
  pushTail = result.then(
    () => undefined,
    () => undefined,
  );
  if (hold === undefined) return result;
  const { replica } = requireSession();
  return result.then(
    (response) => {
      if (response.status === "succeeded") replica.settle(hold, response.rev);
      else replica.drop(hold);
      return response;
    },
    (error: unknown) => {
      replica.drop(hold);
      throw error;
    },
  );
}

/**
 * The lane's last write, when it coalesces and is not sent yet: the next
 * write of its key replaces what it sends, and its hold takes that write's
 * ids too. Only the last write lingers, so joining it never moves a write
 * past one the tab committed after it.
 */
interface Lingering {
  readonly key: string;
  invocation: ActionRequest;
  readonly hold: Hold;
  timer: ReturnType<typeof setTimeout>;
  readonly response: PromiseWithResolvers<ActionResponse>;
  /** Its server answer, read once, whichever of the writes it carries asks. */
  readonly settled: Promise<ActionReceipt>;
}

/** How long a coalescing write waits for the next of its key: a pause in typing. */
const COALESCE_MS = 280;

let lingering: Lingering | null = null;

/** Send the lingering write now, in its place in the lane, ahead of whatever is pushed next. */
function release(): void {
  const entry = lingering;
  if (entry === null) return;
  lingering = null;
  clearTimeout(entry.timer);
  entry.response.resolve(send(entry.invocation, entry.hold));
}

/** Push a write: everything committed before it is sent first, then it. */
function pushInvocation(invocation: ActionRequest, hold?: Hold): Promise<ActionResponse> {
  release();
  return send(invocation, hold);
}

/** Wait until the ordered push lane drains. Test-only observation seam. */
export function waitForBrowserPushes(): Promise<void> {
  return pushTail;
}

/** @internal Forget lingering writes and the lane's tail between tests. */
export function resetPushLaneForTests(): void {
  if (lingering !== null) clearTimeout(lingering.timer);
  lingering = null;
  pushTail = Promise.resolve();
}

/**
 * Browser action entry point. The shared invoker is wired here once its w5
 * prerequisite export lands; port-backed actions remain server-owned.
 */
export function invokeLocal(invocation: ActionRequest): Promise<ActionReceipt> {
  const current = requireSession();
  const call = invokeReceiptWith(
    localActions,
    current.ctx,
    onWire(PAGE_WIRE, inTabSession(invocation)),
  ).pipe(
    Effect.provideService(CurrentInterception, localInterception),
    Effect.provideService(CurrentContextReferences, localReferences),
  );
  const screened =
    localScreens === null ? call : call.pipe(Effect.provideService(Screens, localScreens));
  return Effect.runPromise(screened.pipe(Effect.provide(current.layer))).then((receipt) => {
    // Only a write commits; a read leaves the graph store nothing to follow.
    const writes = localActions.get(invocation.id)?.def.mode.kind === "write";
    if (writes && receipt.status === "succeeded") current.onLocalCommit();
    return receipt;
  });
}

/** Commit `invocation` to the replica; on success, the ids the commit touched. */
async function commitLocal(
  invocation: ActionRequest,
): Promise<{ receipt: ActionReceipt; touched: string[] }> {
  const current = requireSession();
  const before = current.store.txTail.head();
  const receipt = await invokeLocal(invocation);
  if (receipt.status === "failed") return { receipt, touched: [] };
  const touched = current.store.txTail
    .entries()
    .flatMap((tx) =>
      tx.rev > before ? [...tx.ops.upserts.map((node) => node.id), ...tx.ops.deletes] : [],
    );
  return { receipt, touched };
}

/**
 * What became of a pushed write on the server, as its caller reads it. A
 * refusal is said once, here, as a change that was not saved: the replica has
 * already gone back to the server's image (`BrowserReplica.drop`).
 */
function settledOf(
  id: string,
  push: Promise<ActionResponse>,
  context: Readonly<Record<string, FilledInput>> | undefined,
): Promise<ActionReceipt> {
  return push.then(
    (response): ActionReceipt => {
      if (response.status === "failed") toast(`Not saved: ${response.message}`);
      return response.status === "succeeded" && context !== undefined
        ? { ...response, context }
        : response;
    },
    (error: unknown): ActionReceipt => {
      const message = error instanceof Error ? error.message : String(error);
      toast(`Not saved: ${message}`);
      return failed(id, "internal", message);
    },
  );
}

/** An action's outcome: what the caller can act on now, and what became of it on the server. */
export interface Invoked {
  /** The receipt of the lane the action ran on first (the local replica for a local write). */
  readonly receipt: ActionReceipt;
  /**
   * The receipt once the server has answered. It is `receipt` itself for a
   * call that was never optimistic, and it never rejects: a push that could
   * not reach the server settles as an `internal` failure.
   */
  readonly settled: Promise<ActionReceipt>;
}

const done = (receipt: ActionReceipt): Invoked => ({
  receipt,
  settled: Promise.resolve(receipt),
});

/**
 * Run an action where it can run. An action whose handler needs only the
 * store and index runs locally first. A local read is then done, because it
 * has nothing to replicate. A local write is pushed so the server commits it
 * too: its `receipt` is the local commit, its `settled` is the server's
 * answer. Any other action goes to the server. Every lane gets the whole
 * envelope, so what the invocation declares reaches the invoke core that
 * decides it, locally and on the server.
 */
export async function invokeSettled(invocation: ActionRequest): Promise<Invoked> {
  const { id } = invocation;
  const local = localActions.get(id);
  if (local === undefined) return done(await pushInvocation(invocation));
  if (local.def.mode.kind === "read") return done(await invokeLocal(invocation));
  const { receipt, touched } = await commitLocal(invocation);
  if (receipt.status === "failed") return done(receipt);
  const hold = requireSession().replica.hold(touched);
  // What the local commit filled from this tab's screen is pushed as given,
  // so the server fills nothing and commits what the replica did; its
  // receipt says what was filled, as the local one does.
  const { context } = receipt;
  return {
    receipt,
    settled: settledOf(id, pushInvocation(asFilled(invocation, context), hold), context),
  };
}

/**
 * {@link invokeSettled} for a write that coalesces: typed text, where each
 * keystroke is a local commit and the server needs only the last one of a
 * pause. It is committed now, and its push lingers at the lane's end until
 * {@link COALESCE_MS} pass with no further write of the same `key`, or any
 * other write is pushed or lingers, which sends it first.
 */
export async function invokeCoalesced(invocation: ActionRequest, key: string): Promise<Invoked> {
  const { receipt, touched } = await commitLocal(invocation);
  if (receipt.status === "failed") return done(receipt);
  const waiting = lingering?.key === key ? lingering : null;
  const hold = requireSession().replica.hold(touched, waiting?.hold);
  if (waiting !== null && waiting.hold === hold) {
    clearTimeout(waiting.timer);
    waiting.invocation = invocation;
    waiting.timer = setTimeout(release, COALESCE_MS);
    return { receipt, settled: waiting.settled };
  }
  // Whatever lingers was committed before this write, so it goes out first:
  // another key's text, or this key's under a hold the replica no longer has.
  release();
  const response = Promise.withResolvers<ActionResponse>();
  const settled = settledOf(invocation.id, response.promise, undefined);
  lingering = {
    key,
    invocation,
    hold,
    timer: setTimeout(release, COALESCE_MS),
    response,
    settled,
  };
  return { receipt, settled };
}

/** `invocation` with the inputs its tab session filled given, as the local commit ran it. */
function asFilled(
  invocation: ActionRequest,
  context: Readonly<Record<string, FilledInput>> | undefined,
): ActionRequest {
  if (context === undefined || !Predicate.isObject(invocation.input)) return invocation;
  const filled = Object.entries(context).map(([key, { value }]) => [key, value]);
  return { ...invocation, input: { ...invocation.input, ...Object.fromEntries(filled) } };
}

/** {@link invokeSettled} for a caller that acts on the first receipt and lets a rejected push surface as a toast. */
export async function invoke(id: string, input: unknown): Promise<ActionReceipt> {
  return (await invokeSettled({ id, input })).receipt;
}
