/**
 * A docs view for a test root, made the way any caller makes one: a view
 * node naming `docs.markdown`, added with `node.add` (DESIGN.md → Kinds,
 * roles and options → View nodes).
 */
import { Effect } from "effect";
import { docsViewNodeId, docsViewProps, type DocsViewSpec } from "@kb/model";
import { invokeReceiptEffect, IN_PROCESS_WIRE, kbRuntimeLayer } from "@kb/runtime";
import { onWire, type KbContext } from "@kb/contracts";
import { CONTRACT_AT, openSession, plainNode } from "./store-session.ts";

export const addDocsView = Effect.fn("testKit.addDocsView")(function* (
  root: string,
  name: string,
  spec: DocsViewSpec,
) {
  const ctx = yield* openSession(root);
  const props = Object.entries(docsViewProps(spec)).flatMap(([field, values]) =>
    values.map((value) => ({ field, value })),
  );
  const receipt = yield* invokeReceiptEffect(
    ctx,
    onWire(IN_PROCESS_WIRE, {
      id: "node.add",
      input: { id: docsViewNodeId(name), text: name, parent: null, props },
    }),
  ).pipe(Effect.provide(kbRuntimeLayer(ctx)));
  if (receipt.status !== "succeeded")
    return yield* Effect.die(new Error(`docs view ${name}: ${receipt.message}`));
  return receipt;
});

/** Hold a docs view as a hand edit or merge can leave it, past the actions' checks. */
export function holdDocsView(ctx: KbContext, name: string, spec: DocsViewSpec): Promise<void> {
  const view = { ...plainNode(docsViewNodeId(name), name), props: docsViewProps(spec) };
  return Effect.runPromise(
    Effect.asVoid(ctx.store.commitEffect({ upserts: [view], deletes: [] }, { at: CONTRACT_AT })),
  );
}
