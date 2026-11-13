import type { Contribution, ContributionEntry } from "@kb/plugin";
import type { SeedOption } from "@kb/model";

/**
 * A contribution its family names by a key (a backdrop, a design system, a
 * graph theme): it answers to the key's id, `<family>.<local id>`, so it is
 * contributed under the local id and the family's namespace restores the
 * rest, as a view answers to its key. A key of its kind's own owner (core's,
 * in the root namespace; the graph's own themes) has no family part and is
 * contributed as it is. One helper for every keyed point, a family's own
 * included.
 */
interface Keyed {
  readonly key: SeedOption;
}

export function provideDeclared<T extends Keyed>(value: T): ContributionEntry<T> {
  return { id: declaredLocalId(value.key.id), value };
}

/**
 * The id a family contributes a thing it declares as `id` under: its local
 * id, so in the family's namespace the contribution answers to the declared
 * id (`<name>.<local id>`), as a view answers to its key.
 */
export function declaredLocalId(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

/**
 * The contribution `id` names among `contributed`; the first contributed
 * for null, or for an id nobody contributes now. Null only when nothing is
 * contributed. One reading for every keyed point, so a stale choice falls
 * through the same way for a backdrop and a design system.
 */
export function chosenDeclared<T extends Keyed>(
  contributed: readonly Contribution<T>[],
  id: string | null,
): Contribution<T> | null {
  return contributed.find(({ value }) => value.key.id === id) ?? contributed[0] ?? null;
}
