import { Effect, Schema, Stream } from "effect";
import type { EffectStore } from "@kb/contracts";
import {
  canonicalJson,
  currentIso,
  firstRef,
  firstStr,
  seededField,
  seededTag,
  SYSTEM_IDS,
  type KbNode,
} from "@kb/model";
import {
  LedgerState,
  ledgerFromStorage,
  SyncError,
  type LedgerSnapshot,
  type LedgerStorage,
} from "@kb/routines";

const PREFIX = "routines.ops.";
const TAG = PREFIX + "record";
const KIND = PREFIX + "kind";
const KEY = PREFIX + "key";
const VALUE = PREFIX + "value";
const KINDS = ["unit", "cursor", "lease", "log", "meta"] as const;
type Kind = (typeof KINDS)[number];
const kindById = new Map(KINDS.map((kind) => [KIND + "." + kind, kind]));
const failed = () => new SyncError({ status: 500, code: "ledger_unavailable" });
const corrupt = () => new SyncError({ status: 500, code: "ledger_corrupt" });

function seed(at: string): readonly KbNode[] {
  return [
    seededTag(TAG, "ledger record", [KIND, KEY, VALUE], at),
    {
      ...seededField(KIND, "kind", "ref", at, { one: true }),
      children: KINDS.map((kind) => KIND + "." + kind),
    },
    seededField(KEY, "key", "text", at, { one: true }),
    seededField(VALUE, "record", "text", at, { one: true }),
    ...KINDS.map((kind) => ({
      id: KIND + "." + kind,
      text: kind,
      children: [],
      props: {},
      createdAt: at,
      updatedAt: at,
    })),
  ];
}
function owned(node: KbNode): boolean {
  return (
    node.props[SYSTEM_IDS.typeField]?.some((value) => value.t === "ref" && value.v === TAG) ?? false
  );
}
function records(state: LedgerState): readonly { kind: Kind; key: string; value: unknown }[] {
  return [
    ...Object.entries(state.units).map(([key, value]) => ({ kind: "unit" as const, key, value })),
    ...Object.entries(state.cursors).map(([key, value]) => ({
      kind: "cursor" as const,
      key,
      value,
    })),
    ...Object.entries(state.leases).map(([key, value]) => ({ kind: "lease" as const, key, value })),
    ...state.logs.map((value, index) => ({
      kind: "log" as const,
      key: String(state.logStart + index),
      value,
    })),
    { kind: "meta", key: "logStart", value: state.logStart },
  ];
}
function encode(state: LedgerState, existing: readonly KbNode[], at: string): readonly KbNode[] {
  const byId = new Map(existing.map((node) => [node.id, node]));
  const nodes: KbNode[] = seed(at).map((node) => byId.get(node.id) ?? node);
  for (const record of records(state)) {
    const id = PREFIX + record.kind + ":" + encodeURIComponent(record.key);
    const before = byId.get(id);
    const props = {
      ...before?.props,
      [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: TAG }],
      [KIND]: [{ t: "ref" as const, v: KIND + "." + record.kind }],
      [KEY]: [{ t: "str" as const, v: record.key }],
      [VALUE]: [{ t: "str" as const, v: canonicalJson(record.value) }],
    };
    if (before !== undefined && canonicalJson(before.props) === canonicalJson(props)) {
      nodes.push(before);
    } else {
      nodes.push({
        id,
        text: record.kind + " " + record.key,
        props,
        children: before?.children ?? [],
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
      });
    }
  }
  return nodes;
}
function decode(nodes: readonly KbNode[]): LedgerState {
  const groups = new Map<Kind, [string, unknown][]>(KINDS.map((kind) => [kind, []]));
  for (const node of nodes.filter(owned)) {
    const kind = kindById.get(firstRef(KIND)(node.props) ?? "");
    const key = firstStr(KEY)(node.props) ?? null;
    const raw = firstStr(VALUE)(node.props) ?? null;
    if (kind === undefined || key === null || raw === null) throw corrupt();
    groups.get(kind)?.push([key, JSON.parse(raw)]);
  }
  const entries = (kind: Kind) => groups.get(kind) ?? [];
  const logStart = entries("meta").find(([key]) => key === "logStart")?.[1] ?? 0;
  const logs = entries("log").toSorted(([a], [b]) => Number(a) - Number(b));
  if (typeof logStart !== "number" || logs.some(([key], index) => Number(key) !== logStart + index))
    throw corrupt();
  const state = Schema.decodeUnknownSync(LedgerState)({
    units: Object.fromEntries(entries("unit")),
    cursors: Object.fromEntries(entries("cursor")),
    leases: Object.fromEntries(entries("lease")),
    logs: logs.map(([, value]) => value),
    logStart,
  });
  if (Object.entries(state.units).some(([key, unit]) => key !== unit.key)) throw corrupt();
  return state;
}

/** Store fingerprints make load/compute/replace atomic across processes. */
export const makeKbLedger = Effect.fn("routines.makeKbLedger")(function* (store: EffectStore) {
  if ((yield* store.fingerprint.pipe(Effect.mapError(failed))) === null) {
    yield* store
      .commitEffect(
        { upserts: [], deletes: [] },
        { at: yield* currentIso, via: "ext.routines.ledger" },
      )
      .pipe(Effect.mapError(failed));
  }
  let cached: { nodes: readonly KbNode[]; snapshot: LedgerSnapshot } | null = null;
  const stableRead = Effect.fn("routines.ledger.read")(function* () {
    for (let attempt = 0; attempt < 32; attempt++) {
      const before = yield* store.fingerprint.pipe(Effect.mapError(failed));
      if (cached !== null && cached.snapshot.revision === before) return cached;
      const nodes = yield* store.loadEffect.pipe(Effect.mapError(failed));
      const after = yield* store.fingerprint.pipe(Effect.mapError(failed));
      if (before !== null && before === after) {
        const state = yield* Effect.try({ try: () => decode(nodes), catch: corrupt });
        cached = { nodes, snapshot: { revision: before, state } };
        return cached;
      }
      yield* Effect.yieldNow;
    }
    return yield* failed();
  });
  const storage: LedgerStorage = {
    read: stableRead().pipe(Effect.map(({ snapshot }) => snapshot)),
    comparePut: Effect.fn("routines.ledger.comparePut")(function* (expected, state) {
      const before = yield* stableRead();
      if (before.snapshot.revision !== expected) return false;
      const at = yield* currentIso;
      const next = encode(state, before.nodes, at);
      const previous = new Map(before.nodes.map((node) => [node.id, node]));
      const ids = new Set(next.map((node) => node.id));
      const upserts = next.filter((node) => {
        const old = previous.get(node.id);
        return old === undefined || canonicalJson(old) !== canonicalJson(node);
      });
      const deletes = before.nodes
        .filter((node) => owned(node) && !ids.has(node.id))
        .map((node) => node.id);
      return yield* store
        .commitEffect({ upserts, deletes }, { at, via: "ext.routines.ledger" }, expected)
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            error.code === "conflict" ? Effect.succeed(false) : Effect.fail(failed()),
          ),
        );
    }),
    changes: store.changes.pipe(
      Stream.map((value) => value ?? "missing"),
      Stream.mapError(failed),
    ),
  };
  return ledgerFromStorage(storage);
});
