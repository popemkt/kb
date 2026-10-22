// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim must travel with this module (see datascript.d.ts)
/// <reference path="./datascript.d.ts" />
import * as d from "datascript";
import { present, type ClockSample, type NodeId } from "@kb/model";
import type { DatascriptDb, IdMap } from "./index/datoms.ts";
import { compile, normalizeEdnQuery } from "./ir/compile.ts";
import type { FindPos, Ir, IrQuery, KbFunctionName } from "./ir/ir.ts";
import { holdsUntil, kbFunctions, readsClock } from "./ir/kb-functions.ts";
import { parseEdn } from "./ir/parse.ts";
import { outerClauses } from "./ir/scope.ts";
import { DatalogError } from "./datalog-error.ts";

function normalizeQueryInput(input: unknown): unknown {
  if (typeof input === "string") return normalizeEdnQuery(input);
  if (Array.isArray(input)) return input.map(normalizeQueryInput);
  return input;
}

function reviveValue(v: unknown, ids: IdMap): unknown {
  if (typeof v === "number" && ids.toId.has(v)) return ids.toId.get(v);
  if (Array.isArray(v)) return v.map((x) => reviveValue(x, ids));
  return v;
}

function reviveTyped(raw: unknown, find: readonly FindPos[], ids: IdMap): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((row) => reviveTypedRow(row, find, ids));
}

function reviveTypedRow(row: unknown, find: readonly FindPos[], ids: IdMap): unknown {
  if (!Array.isArray(row)) return row;
  return row.map((val, i) => {
    const pos = find[i];
    if (pos?.type === "node-ref") return reviveValue(val, ids);
    return val;
  });
}

function executeEdn(db: DatascriptDb, edn: string, ...inputs: unknown[]): unknown {
  try {
    return d.q(edn, db.db, ...inputs);
  } catch (err) {
    throw new DatalogError(err instanceof Error ? err.message : String(err));
  }
}

/** `(edn, ...inputs) => raw rows` — no revival. `runIr` supplies typed revival. */
export type EdnExecutor = (edn: string, ...inputs: unknown[]) => unknown;

export function datascriptExecutor(db: DatascriptDb): EdnExecutor {
  return (edn, ...inputs) => executeEdn(db, edn, ...inputs);
}

/**
 * Where a run's one clock sample comes from (`ClockSample`): called at most
 * once per run, and only by a run that calls a clocked kb function. A host
 * binds it to Effect's `Clock` (`clockSampler` in `@kb/model`); the query
 * layer never reads a wall clock of its own.
 */
export type ClockSampler = () => ClockSample;

/**
 * `ir`'s rows as the engine answers them, the find positions they are
 * columns of (none for `raw`), and until when they hold (`holdsUntil`).
 */
function executeIr(
  exec: EdnExecutor,
  ir: Ir,
  inputs: readonly unknown[],
  clock: ClockSampler | undefined,
): { raw: unknown; find: readonly FindPos[] | undefined; holdsUntilMs: number | null } {
  const compiled = compile(ir);
  const names = compiled.functions ?? [];
  const normalized = inputs.map(normalizeQueryInput);
  const sample = clockSample(names, clock);
  const fns = kbFunctions(sample);
  const raw = exec(
    compiled.query,
    ...withCompiledRules(ir, compiled.rules, normalized),
    ...names.map((name) => fns[name]),
  );
  return { raw, find: compiled.find, holdsUntilMs: holdsUntil(names, sample) };
}

/**
 * The one clock sample of a run that calls the kb functions `names`, taken
 * now, or none when none of them reads the clock.
 */
function clockSample(
  names: readonly KbFunctionName[],
  clock: ClockSampler | undefined,
): ClockSample | undefined {
  const clocked = names.find(readsClock);
  if (clocked === undefined) return undefined;
  if (clock === undefined) {
    throw new DatalogError(`${clocked} reads the clock, and this index was built without one`);
  }
  return clock();
}

/**
 * Seat the compiler's rules in the `%` slot. `compile` adds `%` first when the
 * query does not declare it; when the query does, the caller's rules string is
 * in that slot and the compiled rules join it.
 */
function withCompiledRules(ir: Ir, rules: string | undefined, inputs: unknown[]): unknown[] {
  if (rules === undefined) return inputs;
  const slot = ir.kind === "query" ? (ir.in ?? []).indexOf("%") : -1;
  if (slot === -1) return [rules, ...inputs];
  const own = inputs[slot];
  if (typeof own !== "string") {
    throw new DatalogError("the % input must be an EDN rules vector string");
  }
  return inputs.with(slot, `[${rulesBody(own)} ${rulesBody(rules)}]`);
}

function rulesBody(rules: string): string {
  const trimmed = rules.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new DatalogError(`rules must be an EDN vector: ${rules}`);
  }
  return trimmed.slice(1, -1);
}

/**
 * Compile `ir`, run it through `exec`, revive **only** `node-ref` find positions.
 * Aggregate counts that collide with live eids stay numbers — the r4 red case.
 * Inputs (a `%` rules vector included) are normalised the same way `query` does;
 * `clock` is sampled once if the query calls a clocked kb function.
 */
export function runIr(
  exec: EdnExecutor,
  ir: Ir,
  ids: IdMap,
  inputs: readonly unknown[] = [],
  clock?: ClockSampler,
): unknown {
  const { raw, find } = executeIr(exec, ir, inputs, clock);
  if (find === undefined) return reviveValue(raw, ids);
  return reviveTyped(raw, find, ids);
}

/**
 * The compiled `find` of `ir`, with a scalar variable read as a node ref where it
 * is the value of a field attr that holds refs (`DatascriptDb.refAttrs`): a
 * ref field's value is an entity, a number field's a number, though both are
 * stored as a bare number. GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]
 */
function findWithRefAttrs(
  ir: IrQuery,
  find: readonly FindPos[],
  refAttrs: ReadonlySet<string>,
): readonly FindPos[] {
  const refValued = new Set(
    outerClauses(ir.where).flatMap((clause) =>
      clause.kind === "pattern" && clause.value.t === "var" && refAttrs.has(clause.attr)
        ? [clause.value.name]
        : [],
    ),
  );
  return find.map((pos) =>
    pos.kind === "var" && pos.type === "scalar" && refValued.has(pos.name)
      ? { ...pos, type: "node-ref" }
      : pos,
  );
}

/**
 * Raw-EDN entry: `compile(parseEdn(edn))` then execute. When the subset
 * parses, only node-ref find positions are revived, so a count or a number
 * field's value stays a number (`findWithRefAttrs`); a `{ kind: "raw" }`
 * query revives every eid-shaped integer, as it cannot tell them apart.
 */
export function query(
  db: DatascriptDb,
  edn: string,
  inputs: readonly unknown[] = [],
  clock?: ClockSampler,
): unknown {
  return answerQuery(db, parseEdn(edn), inputs, clock).value;
}

/**
 * {@link query}'s value for a query already parsed (`parseEdn`), and until
 * when it holds (`holdsUntil`): null until the graph moves.
 */
export function answerQuery(
  db: DatascriptDb,
  ir: Ir,
  inputs: readonly unknown[] = [],
  clock?: ClockSampler,
): { readonly value: unknown; readonly holdsUntilMs: number | null } {
  const { raw, find, holdsUntilMs } = executeIr(datascriptExecutor(db), ir, inputs, clock);
  if (ir.kind === "raw" || find === undefined) {
    return { value: reviveValue(raw, db.ids), holdsUntilMs };
  }
  return {
    value: reviveTyped(raw, findWithRefAttrs(ir, find, db.refAttrs), db.ids),
    holdsUntilMs,
  };
}

/**
 * `:find` results as rows. `query` returns `unknown` because a datalog result
 * is whatever the query asked for; every row-shaped caller went through the
 * same cast, so the check lives here instead.
 */
export function queryRows(
  db: DatascriptDb,
  edn: string,
  inputs: readonly unknown[] = [],
  clock?: ClockSampler,
): unknown[][] {
  const raw = query(db, edn, inputs, clock);
  if (!Array.isArray(raw) || !raw.every((row) => Array.isArray(row))) {
    throw new DatalogError(`datalog query did not return rows: ${edn}`);
  }
  return raw;
}

export function pull(db: DatascriptDb, pattern: string, id: NodeId | number): unknown {
  let eidOrLookup: number | [string, string];
  if (typeof id === "number") {
    eidOrLookup = id;
  } else if (db.ids.toEid.has(id)) {
    eidOrLookup = present(db.ids.toEid.get(id), `eid for ${id}`);
  } else {
    eidOrLookup = [":node/id", id];
  }
  const pat = normalizeEdnQuery(pattern);
  const raw = d.pull(db.db, pat, eidOrLookup);
  return revivePull(raw, db.ids);
}

function revivePull(raw: unknown, ids: IdMap): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object") return reviveValue(raw, ids);
  if (Array.isArray(raw)) return raw.map((x) => revivePull(x, ids));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === ":db/id" && typeof v === "number") {
      out[k] = v;
      const nid = ids.toId.get(v);
      if (nid !== undefined) out[":node/id"] = nid;
      continue;
    }
    out[k] = revivePull(v, ids);
  }
  return out;
}
