import { Effect, Scope, Predicate } from "effect";
import {
  asKeyType,
  namespaced,
  roleKeyAt,
  isPointKey,
  roleName,
  type PointKey,
  type PointReference,
  type PointSpec,
  type KernelHost,
} from "./keys.ts";
import {
  pointSlot,
  changed,
  refusal,
  scopeOf,
  assertActive,
  pluginFailure,
  claim,
  visible,
  type State,
  type Entry,
  type Activation,
  type PointSlot,
  type PointValue,
} from "./state.ts";
import { elected, registration, canOccupy, roleCell } from "./roles.ts";
import {
  registrationCell,
  addCandidate,
  removeCandidate,
  type Cell,
  type Registration,
} from "./cells.ts";
import { checkPointSpec } from "./specs.ts";
import type { Contribution, ContributionEntry } from "./kernel.ts";

const contributionValue = Effect.fnUntraced(function* (
  owner: string,
  host: KernelHost,
  point: PointKey<unknown>,
  input: unknown,
) {
  if (!isPointKey(point))
    return yield* refusal(
      owner,
      "invalid-point",
      "point keys must come from the host or ctx.declare",
    );
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- installed JavaScript may use a pre-PointSpec SDK
  if (point.spec === undefined) {
    return yield* refusal(owner, "invalid-point", `${point.name} requires a PointSpec`);
  }
  yield* checkPointSpec(owner, point.spec, host);
  return point.spec.contract === undefined
    ? input
    : yield* decodeContribution(owner, point.spec.contract, input);
});

function memberAt(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (Predicate.isObject(current) ? current[key] : undefined),
      value,
    );
}

export function pointValue(
  cell: Cell<PointValue>,
  candidate: Registration<PointValue>,
): Contribution<unknown> {
  const address = cell.role === null ? candidate : (cell.default ?? candidate);
  return {
    id: address.value.id,
    aliases: address.value.aliases,
    owner: candidate.owner,
    value: candidate.value.value,
  };
}

function pointRole(
  entry: Entry,
  point: PointKey<unknown>,
  item: ContributionEntry<unknown>,
  id: string,
) {
  if (point.spec.replaceable !== true) {
    if (item.replaces !== undefined)
      throw refusal(
        entry.name,
        "contribution-conflict",
        `${point.name} does not allow replacement`,
      );
    return null;
  }
  const role = roleName(point, point.spec.cardinality === "single" ? null : id);
  if (item.replaces === undefined) return role;
  const prefix = `${point.spec.rolePrefix ?? point.name}:`;
  if (point.spec.cardinality !== "keyed" || !item.replaces.startsWith(prefix))
    throw refusal(entry.name, "invalid-point", `replacement must name a cell of ${point.name}`);
  return item.replaces;
}

function pointCell(
  slot: PointSlot,
  role: string | null,
  value: PointValue,
): Cell<PointValue> | undefined {
  if (role !== null) return slot.cells.find((cell) => cell.role === role);
  if (slot.key.spec.cardinality === "single") return slot.cells[0];
  if (slot.key.spec.cardinality === "keyed" && slot.key.spec.keyBy !== undefined) {
    const path = slot.key.spec.keyBy;
    const key = memberAt(value.value, path);
    return slot.cells.find((cell) =>
      cell.entries.some((candidate) => Object.is(memberAt(candidate.value.value, path), key)),
    );
  }
  return slot.byId.get(value.id);
}

function checkPointIds(
  entry: Entry,
  slot: PointSlot,
  held: Cell<PointValue> | undefined,
  value: PointValue,
) {
  const clash = [value.id, ...value.aliases].find(
    (id) => slot.byId.has(id) && slot.byId.get(id) !== held,
  );
  if (clash !== undefined)
    throw refusal(entry.name, "contribution-conflict", `${slot.key.name} already has ${clash}`);
  const path = slot.key.spec.keyBy;
  if (slot.key.spec.cardinality === "keyed" && path !== undefined) {
    const key = memberAt(value.value, path);
    const changedKey =
      held?.default !== null &&
      held?.default !== undefined &&
      !Object.is(memberAt(held.default.value.value, path), key);
    const clashKey =
      changedKey ||
      key === undefined ||
      slot.cells.some(
        (cell) =>
          cell !== held &&
          cell.entries.some((candidate) => Object.is(memberAt(candidate.value.value, path), key)),
      );
    if (clashKey)
      throw refusal(
        entry.name,
        "contribution-conflict",
        `${slot.key.name} requires a unique ${path}`,
      );
  }
  return undefined;
}

function pointIds(value: PointValue): readonly string[] {
  return [value.id, ...value.aliases];
}

function cellIds(cell: Cell<PointValue>): readonly string[] {
  if (cell.entries.length === 0) return [];
  const entries = cell.default === null ? cell.entries : [...cell.entries, cell.default];
  return [...new Set(entries.flatMap(({ value }) => pointIds(value)))];
}

/** The id index derives from the cell, including its retained owner address. */
function indexCell(slot: PointSlot, into: Cell<PointValue>, previous: readonly string[]): void {
  for (const id of previous) if (slot.byId.get(id) === into) slot.byId.delete(id);
  for (const id of cellIds(into)) slot.byId.set(id, into);
}

function admitPoint(
  state: State,
  active: Activation,
  point: PointKey<unknown>,
  item: ContributionEntry<unknown>,
  value: unknown,
) {
  const entry = assertActive(active);
  const payload: PointValue = {
    id: namespaced(entry.namespace, item.id),
    aliases: Object.freeze([...(item.aliases ?? [])]),
    value,
  };
  const existing = state.points.get(point.name);
  if (point.declarer !== null) {
    if (existing?.key !== point)
      throw refusal(entry.name, "not-loaded", `point ${point.name} is retired`);
    if (point.declarer !== entry.name && !entry.uses.includes(point.name))
      throw refusal(entry.name, "not-used", `${point.name} must be listed in uses`);
  }
  claim(entry.name, existing?.key, point);
  const slot = existing ?? pointSlot(point);
  const role = pointRole(entry, point, item, payload.id);
  if (role !== null) {
    claim<"service" | "point">(entry.name, roleCell(state, role)?.key, point);
    if (roleKeyAt(role, point, state.host) !== true)
      throw refusal(entry.name, "invalid-point", `role ${role} needs its host definition`);
  }
  const candidate = registration(state, entry, role, payload, "contribution-conflict");
  if (item.replaces !== undefined && candidate.default)
    throw refusal(
      entry.name,
      "contribution-conflict",
      `role ${role} requires host-approved replacement authority`,
    );
  const held = pointCell(slot, role, payload);
  checkPointIds(entry, slot, held, payload);
  canOccupy(held, candidate, "contribution-conflict");
  const previous = held === undefined ? [] : cellIds(held);
  const into = held ?? registrationCell(candidate, role);
  if (held !== undefined) addCandidate(into, candidate);
  else slot.cells.push(into);
  indexCell(slot, into, previous);
  state.points.set(point.name, slot);
  return { slot, into, candidate };
}

export const contributeErased = Effect.fnUntraced(function* (
  state: State,
  active: Activation,
  point: PointKey<unknown>,
  item: ContributionEntry<unknown>,
) {
  const scope = yield* scopeOf(active);
  const { entry } = active;
  const value = yield* contributionValue(entry.name, state.host, point, item.value);
  const held = yield* Scope.provide(scope)(
    Effect.acquireRelease(
      Effect.try({
        try: () => admitPoint(state, active, point, item, value),
        catch: (cause) => pluginFailure(entry.name, cause),
      }),
      ({ slot, into, candidate }) =>
        Effect.sync(() => {
          const previous = cellIds(into);
          removeCandidate(into, candidate);
          if (into.entries.length === 0) slot.cells.splice(slot.cells.indexOf(into), 1);
          indexCell(slot, into, previous);
          changed(state);
        }),
    ),
  );
  changed(state);
  return pointValue(held.into, held.candidate);
});

export function matchesPoint<C>(slot: PointSlot | undefined, point: PointReference<C>): boolean {
  return (
    slot !== undefined &&
    (point.kind === "point-name" ? slot.key.declarer !== null : slot.key === point)
  );
}
export function contributionsAt<C>(
  state: State,
  point: PointReference<C>,
): readonly Contribution<C>[] {
  const slot = state.points.get(point.name);
  if (!matchesPoint(slot, point) || slot === undefined) return [];
  return slot.cells.flatMap((cell) => {
    const candidate = elected(state, cell);
    if (candidate === undefined || !visible(state, candidate.owner)) return [];
    const item = pointValue(cell, candidate);
    return [{ ...item, value: asKeyType(point, item.value) }];
  });
}

const decodeContribution = Effect.fn("plugin.decodeContribution")(function* (
  owner: string,
  contract: NonNullable<PointSpec["contract"]>,
  value: unknown,
) {
  const invalid = (cause: unknown) => refusal(owner, "invalid-contribution", String(cause));
  const decode = yield* Effect.try({
    try: () => {
      const checked = contract["~standard"].validate(value);
      return Predicate.isPromise(checked)
        ? Effect.tryPromise({ try: () => checked, catch: invalid })
        : Effect.succeed(checked);
    },
    catch: invalid,
  });
  const result = yield* decode;
  if (result.issues !== undefined)
    return yield* invalid(result.issues.map((issue) => issue.message).join("; "));
  return result.value;
});
