import { DateTime, Effect } from "effect";
import { z } from "zod";
import {
  CAPTURE_CONTRACT,
  CAPTURE_PAIR,
  CAPTURE_PAIR_CODE,
  CAPTURE_REVOKE,
  CapturePairReceiptSchema,
  CurrentCall,
  KbCtx,
  type ActionDefinition,
} from "@kb/contracts";
import {
  IndexedNodes,
  currentIso,
  domainError,
  freshId,
  planNodeAdd,
  present,
  strValueOf,
  syncDomain,
  type KbNode,
} from "@kb/model";
import { CAPTURE_IDS, digestText, recordsIn } from "./capture-model.ts";
import { persistPlannedEffect } from "./session.ts";

// GAP [[01M7QT8Z33KEHWZ5KNQXRWGYZ4]] Pairing follows the canonical host root.
export const captureStore = Effect.fn("capture.store")(function* (root: string) {
  const key = yield* digestText(root);
  const name = root.split(/[\\/]/).findLast((part) => part.length > 0) ?? "kb";
  return { key, name };
});

export function captureDeviceDigest(root: string, secret: string) {
  return digestText(`${root}\0${secret}`);
}

export function captureCredential(nodes: readonly KbNode[], digest: string) {
  return recordsIn(nodes, CAPTURE_IDS.devices).find(
    (record) =>
      strValueOf(record, CAPTURE_IDS.expiry) === null &&
      strValueOf(record, CAPTURE_IDS.digest) === digest,
  );
}

export const capturePairCodeDef = {
  id: CAPTURE_PAIR_CODE,
  title: "Issue a capture pairing code",
  description: "On the host CLI, issue a one-use capture pairing code valid for ten minutes.",
  mode: { kind: "write" },
  inputSchema: z.object({}),
  outputSchema: z.object({ code: z.string(), expiresAt: z.string(), deviceId: z.string() }),
} satisfies ActionDefinition;

export const capturePairDef = {
  id: CAPTURE_PAIR,
  title: "Pair a capture device",
  description: "Exchange a one-use host pairing code for a capture credential in this store.",
  mode: { kind: "write" },
  callers: ["person", "program", "capture-pairing"],
  inputSchema: z.object({
    code: z.string().regex(/^[a-f0-9]{32}$/),
    deviceName: z.string().trim().min(1).max(120),
  }),
  outputSchema: CapturePairReceiptSchema,
} satisfies ActionDefinition;

export const captureRevokeDef = {
  id: CAPTURE_REVOKE,
  title: "Revoke a capture device",
  description: "On the host CLI, revoke the capture credential or unused code of a device.",
  mode: { kind: "write" },
  inputSchema: z.object({ deviceId: z.string() }),
  outputSchema: z.object({ deviceId: z.string() }),
} satisfies ActionDefinition;

const requireHostCli = Effect.fn("capture.requireHostCli")(function* () {
  const call = yield* CurrentCall;
  if (call?.invocation.actor !== "cli") {
    return yield* domainError("forbidden", "run this action on the store's host CLI");
  }
  return undefined;
});

export const capturePairCodeEffect = Effect.fn("capture.pairCode")(function* () {
  yield* requireHostCli();
  const ctx = yield* KbCtx;
  const code = crypto.getRandomValues(new Uint8Array(16)).toHex();
  const digest = yield* captureDeviceDigest(ctx.root, code);
  const expiresAt = DateTime.formatIso(DateTime.add(yield* DateTime.now, { minutes: 10 }));
  const at = yield* currentIso;
  const id = yield* freshId;
  const plan = Effect.fn("capture.pairCode.plan")(function* (nodes: readonly KbNode[]) {
    const graph = IndexedNodes.of(nodes);
    const { written } = yield* syncDomain(() =>
      planNodeAdd(
        graph,
        {
          parent: CAPTURE_IDS.devices,
          text: "Pending capture device",
          props: [
            { field: CAPTURE_IDS.digest, value: { t: "str", v: digest } },
            { field: CAPTURE_IDS.expiry, value: { t: "str", v: expiresAt } },
          ],
        },
        id,
        at,
      ),
    );
    return {
      upserts: written.map((nodeId) => present(graph.get(nodeId), "a written capture device node")),
      deletes: [],
    };
  });
  yield* persistPlannedEffect(ctx, plan);
  return { code, expiresAt, deviceId: id };
});

export const capturePairEffect = Effect.fn("capture.pair")(function* (
  input: z.infer<typeof capturePairDef.inputSchema>,
) {
  const ctx = yield* KbCtx;
  const code = yield* captureDeviceDigest(ctx.root, input.code);
  const token = `kbcap_${crypto.getRandomValues(new Uint8Array(32)).toHex()}`;
  const digest = yield* captureDeviceDigest(ctx.root, token);
  const store = yield* captureStore(ctx.root);

  const plan = Effect.fn("capture.pair.plan")(function* (nodes: readonly KbNode[]) {
    const record = recordsIn(nodes, CAPTURE_IDS.devices).find(
      (node) => strValueOf(node, CAPTURE_IDS.digest) === code,
    );
    const expiresAt = strValueOf(record, CAPTURE_IDS.expiry);
    const at = yield* currentIso;
    if (record === undefined || expiresAt === null || expiresAt <= at) {
      return yield* domainError(
        "forbidden",
        "capture pairing code is invalid, expired or already used",
      );
    }
    const props: KbNode["props"] = {
      ...record.props,
      [CAPTURE_IDS.digest]: [{ t: "str" as const, v: digest }],
    };
    delete props[CAPTURE_IDS.expiry];
    return {
      upserts: [{ ...record, props, text: input.deviceName, updatedAt: at }],
      deletes: [],
      deviceId: record.id,
    };
  });

  const { deviceId } = present(yield* persistPlannedEffect(ctx, plan), "a paired capture device");
  return { token, deviceId, store, captureContract: CAPTURE_CONTRACT };
});

export const captureRevokeEffect = Effect.fn("capture.revoke")(function* ({
  deviceId,
}: z.infer<typeof captureRevokeDef.inputSchema>) {
  yield* requireHostCli();
  const ctx = yield* KbCtx;
  const plan = Effect.fn("capture.revoke.plan")(function* (nodes: readonly KbNode[]) {
    const record = recordsIn(nodes, CAPTURE_IDS.devices).find(({ id }) => id === deviceId);
    if (record === undefined)
      return yield* domainError("not_found", "capture device not found", { deviceId });
    const props = { ...record.props };
    delete props[CAPTURE_IDS.digest];
    const at = yield* currentIso;
    return { upserts: [{ ...record, props, updatedAt: at }], deletes: [] };
  });
  yield* persistPlannedEffect(ctx, plan);
  return { deviceId };
});
