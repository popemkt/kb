import { Context, Layer } from "effect";
import type { KbNode } from "@kb/model";
import type { KbIndex, NodeIndex } from "@kb/query";
import type { EffectStore } from "./store.ts";
import type { KbTxLog } from "./tx-log.ts";

/**
 * Mutable kb session state. Surfaces still pass this object; Effect programs
 * receive it via {@link KbCtx}.
 */
export interface KbContext<Index extends NodeIndex = KbIndex> {
  root: string;
  /** The session's one persistence capability. */
  store: EffectStore;
  /**
   * The one owner of the derived graph. Every session reads its node set
   * here, synchronously, where its writes run. A session whose query engine
   * runs in process (the server's, the CLI's) holds a `KbIndex`; a session
   * whose engine runs elsewhere (the page's) holds only its node set
   * (`KbContext<NodeIndex>`), so code that runs in both reads that, and asks
   * datalog of the `QueryEngineService`.
   */
  index: Index;
  /** The one record of what this session's store has committed, in order. */
  log: KbTxLog;
  /**
   * The stored nodes, derived from {@link index}. Read-only on purpose: the
   * index owns the node set, and a session that could assign here would be a
   * second owner drifting from the datoms it is supposed to describe.
   */
  readonly nodes: KbNode[];
}

/**
 * `ctx` read through `index`, the in-process index its host provides beside
 * it (`KbIndexService`): the session as a surface that runs datalog
 * synchronously sees it, on a host whose engine is in process.
 */
export function inProcess(ctx: KbContext<NodeIndex>, index: KbIndex): KbContext {
  return {
    root: ctx.root,
    store: ctx.store,
    log: ctx.log,
    index,
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
}

/**
 * Effect-native store port. Live consumers: `reloadEffect` / `persistEffect`
 * (yield* KbStore → loadEffect/commitEffect).
 */
export class KbStore extends Context.Service<KbStore, EffectStore>()("kb/KbStore") {}

/** Live kb session as every action reads it: its node set, wherever its engine runs. */
export class KbCtx extends Context.Service<KbCtx, KbContext<NodeIndex>>()("kb/KbCtx") {}

export function kbStoreLayer(store: EffectStore): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, store);
}

export function kbCtxLayer(ctx: KbContext<NodeIndex>): Layer.Layer<KbCtx> {
  return Layer.succeed(KbCtx, ctx);
}
