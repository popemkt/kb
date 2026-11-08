import { elect, type Cell, type Registration } from "./cells.ts";
import { asKeyType, type AnyServiceKey, type PointKey, type RoleKey } from "./keys.ts";
import { changed, refusal, visible, type Entry, type State, type PointValue } from "./state.ts";
import type { PluginErrorReason } from "./errors.ts";

export const ROLE_KINDS = ["service", "single", "keyed"] as const;

export interface RoleProvider {
  readonly provider: string;
  readonly identity: object;
}

export interface RoleCandidate<C> extends RoleProvider {
  readonly owner: string;
  readonly value: C;
  readonly default: boolean;
}

export interface RoleState {
  readonly role: string;
  readonly kind: (typeof ROLE_KINDS)[number];
  readonly owner: string | null;
  readonly selected: string | null;
  readonly elected: string | null;
  readonly candidates: readonly {
    readonly owner: string;
    readonly provider: string;
    readonly priority: number;
    readonly default: boolean;
    readonly fault: string | null;
  }[];
}

function faultOf(state: State, role: string, candidate: Registration<unknown>): string | null {
  return state.roleSession.faultOf(role, candidate.identity);
}

export function elected<T>(state: State, cell: Cell<T>): Registration<T> | undefined {
  return elect(
    cell,
    cell.role === null ? undefined : state.roleSelections.get(cell.role),
    (candidate) =>
      visible(state, candidate.owner) &&
      (cell.role === null || candidate.default || faultOf(state, cell.role, candidate) === null),
  );
}

type HeldRole =
  | { readonly kind: "service"; readonly key: AnyServiceKey; readonly cell: Cell<unknown> }
  | { readonly kind: "point"; readonly key: PointKey<unknown>; readonly cell: Cell<PointValue> };

function heldRoles(state: State): HeldRole[] {
  return [
    ...[...state.services.values()].map(({ key, cell }) => ({
      kind: "service" as const,
      key,
      cell,
    })),
    ...[...state.points.values()].flatMap(({ key, cells }) =>
      cells.map((cell) => ({ kind: "point" as const, key, cell })),
    ),
  ].filter(({ cell }) => cell.role !== null);
}

export function roleCell(state: State, name: string): HeldRole | undefined {
  return heldRoles(state).find(({ cell }) => cell.role === name);
}

export function readRole<C>(state: State, role: RoleKey<C>): RoleCandidate<C> | undefined {
  const held = roleCell(state, role.name);
  if (held?.key !== role.key) return undefined;
  if (held.kind === "service") {
    const candidate = elected(state, held.cell);
    return candidate === undefined
      ? undefined
      : {
          default: candidate.default,
          owner: candidate.owner,
          provider: candidate.provider,
          identity: candidate.identity,
          value: asKeyType(role, candidate.value),
        };
  }
  const candidate = elected(state, held.cell);
  return candidate === undefined
    ? undefined
    : {
        default: candidate.default,
        owner: candidate.owner,
        provider: candidate.provider,
        identity: candidate.identity,
        value: asKeyType(role, candidate.value.value),
      };
}

export function roleStates(state: State): RoleState[] {
  return heldRoles(state).flatMap(({ key, cell }) => {
    const role = cell.role;
    if (role === null) return [];
    const candidates = cell.entries.filter((candidate) => visible(state, candidate.owner));
    if (candidates.length === 0) return [];
    return [
      {
        role,
        kind:
          key.kind === "service"
            ? "service"
            : key.spec.cardinality === "single"
              ? "single"
              : "keyed",
        owner: cell.default?.provider ?? null,
        selected: state.roleSelections.get(role) ?? null,
        elected: elected(state, cell)?.provider ?? null,
        candidates: candidates.map((candidate) => ({
          owner: candidate.owner,
          provider: candidate.provider,
          priority: candidate.priority,
          default: candidate.default,
          fault: faultOf(state, role, candidate),
        })),
      },
    ];
  });
}

export function configureRoles(state: State, preferences: ReadonlyMap<string, string>): void {
  if (
    preferences.size === state.roleSelections.size &&
    [...preferences].every(([role, provider]) => state.roleSelections.get(role) === provider)
  )
    return;
  state.roleSelections = new Map(preferences);
  changed(state);
}

export function faultRole(
  state: State,
  role: string,
  provider: RoleProvider,
  cause: unknown,
): boolean {
  const candidate = roleCell(state, role)?.cell.entries.find(
    (entry) =>
      entry.provider === provider.provider &&
      entry.identity === provider.identity &&
      visible(state, entry.owner),
  );
  if (candidate === undefined || candidate.default) return false;
  const causeText = String(cause instanceof Error ? cause.message || cause : cause);
  if (!state.roleSession.fault(role, candidate.identity, causeText)) return false;
  changed(state);
  return true;
}

function rootEntry(state: State, entry: Entry): Entry {
  const parent = entry.parent === null ? undefined : state.entries.get(entry.parent);
  return parent === undefined ? entry : rootEntry(state, parent);
}

export function registration<T>(
  state: State,
  entry: Entry,
  role: string | null,
  value: T,
  conflict: PluginErrorReason,
) {
  const root = rootEntry(state, entry);
  const approval = root.authority.replacements.find((claim) => claim.role === role);
  const owns = root.authority.defaults.some(
    (claim) => claim.role === role && claim.provider === root.name,
  );
  if (role !== null && approval === undefined && (root.authority.source !== "bundled" || !owns))
    throw refusal(entry.name, conflict, `role ${role} requires host-approved provider authority`);
  if (
    approval !== undefined &&
    root.authority.source === "extension" &&
    root.authority.digest === undefined
  )
    throw refusal(entry.name, conflict, `role ${role} requires authority for trusted code`);
  const priority = approval === undefined ? 100 : (approval.priority ?? 50);
  if (!Number.isFinite(priority))
    throw refusal(entry.name, conflict, `role ${role} requires a finite priority`);
  return {
    owner: entry.name,
    provider: root.name,
    identity: state.roleSession.identity(root.name, root.authority.digest ?? "bundled"),
    priority,
    default: approval === undefined,
    value,
  } satisfies Registration<T>;
}

export function canOccupy<T>(
  held: Cell<T> | undefined,
  candidate: Registration<T>,
  conflict: PluginErrorReason,
) {
  if (held === undefined) return undefined;
  const duplicateDefault =
    candidate.default &&
    (held.entries.some((entry) => entry.default) ||
      (held.default !== null && held.default.provider !== candidate.provider));
  if (
    held.role === null ||
    duplicateDefault ||
    held.entries.some((entry) => entry.provider === candidate.provider)
  ) {
    throw refusal(
      candidate.owner,
      conflict,
      `registration is already held by ${held.default?.provider ?? held.entries[0]?.provider ?? "another provider"}`,
    );
  }
  return undefined;
}
